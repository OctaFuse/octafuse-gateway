/**
 * Playground：按单条 `model_routes` 直连上游，不经过 Proxy、不鉴 API Key、不写 `api_key_request_logs`、不计费、无 failover。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	applyGeminiStreamQueryParams,
	buildGeminiUpstreamActionUrl,
	type GeminiContentAction,
} from '@octafuse/core/gemini-upstream-url';
import type { UpstreamProtocol } from '@octafuse/core/upstream-protocol';
import {
	normalizeUpstreamProtocol,
	resolveEffectiveBaseUrl,
} from '@octafuse/core/upstream-protocol';
import { AdminServiceError, badRequest, notFound } from './errors';
import { resolvePlaygroundProviderKey } from './provider-api-keys-service';

/** 与 Proxy `RouteResult` 对齐的最小子集，供合并默认参数与拼 URL。 */
export type PlaygroundResolvedRoute = {
	upstreamProtocol: UpstreamProtocol;
	baseUrl: string;
	providerApiKey: string;
	providerModelName: string;
	customParams: Record<string, unknown> | null;
	providerKeyId: string;
	providerKeyLabel: string;
};

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMergeDefaults(defaultValue: unknown, userValue: unknown): unknown {
	if (userValue !== undefined) {
		if (Array.isArray(userValue)) {
			return userValue;
		}
		if (isPlainObject(defaultValue) && isPlainObject(userValue)) {
			const merged: JsonObject = {};
			const keys = new Set([...Object.keys(defaultValue), ...Object.keys(userValue)]);
			for (const key of keys) {
				merged[key] = deepMergeDefaults(defaultValue[key], userValue[key]);
			}
			return merged;
		}
		return userValue;
	}
	return defaultValue;
}

/**
 * 路由 `custom_params` 与用户体深度合并，用户字段优先（与 Proxy `buildRouteRequestBody` 一致）。
 */
export function mergePlaygroundRequestBody(
	route: PlaygroundResolvedRoute,
	userBody: JsonObject
): JsonObject {
	const finalBody = deepMergeDefaults(route.customParams ?? {}, userBody);
	return isPlainObject(finalBody) ? finalBody : { ...userBody };
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// ignore
	}
	return null;
}

/**
 * 解析路由与供应商，得到实际上游根 URL 与密钥（Playground 专用，不落库）。
 */
export async function resolvePlaygroundRoute(
	repos: GatewayRepositories,
	routeId: string,
	providerKeyId?: string | null
): Promise<PlaygroundResolvedRoute> {
	const id = String(routeId ?? '').trim();
	if (!id) {
		throw badRequest('routeId is required');
	}

	const row = await repos.routes.getModelRouteRowById(id);
	if (!row) {
		throw notFound('Route not found');
	}

	const provider = await repos.providers.getProviderById(row.provider_id);
	if (!provider) {
		throw badRequest('Provider not found for this route');
	}

	let protocol: UpstreamProtocol;
	try {
		protocol = normalizeUpstreamProtocol(String(row.upstream_protocol ?? 'openai'));
	} catch (e) {
		throw badRequest(e instanceof Error ? e.message : 'Invalid upstream_protocol');
	}

	let baseUrl: string;
	try {
		baseUrl = resolveEffectiveBaseUrl(protocol, provider, provider.id);
	} catch (e) {
		throw badRequest(e instanceof Error ? e.message : 'Failed to resolve upstream base URL');
	}

	const customParams = parseJsonObject(row.custom_params);
	if (row.custom_params && !customParams) {
		throw badRequest('Invalid custom_params JSON on route');
	}

	const resolvedKey = await resolvePlaygroundProviderKey(repos, provider.id, providerKeyId);

	return {
		upstreamProtocol: protocol,
		baseUrl,
		providerApiKey: resolvedKey.api_key,
		providerModelName: row.provider_model_name,
		customParams,
		providerKeyId: resolvedKey.id,
		providerKeyLabel: resolvedKey.label,
	};
}

function stripApiKeyFromUrlForHeader(urlString: string): string {
	try {
		const u = new URL(urlString);
		if (u.searchParams.has('key')) {
			u.searchParams.set('key', '(redacted)');
		}
		return u.toString();
	} catch {
		return urlString.replace(/([?&])key=[^&]*/gi, '$1key=(redacted)');
	}
}

function openAiChatCompletionsUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/$/, '')}/chat/completions`;
}

function anthropicMessagesUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/$/, '')}/v1/messages`;
}

function geminiActionUrl(
	baseUrl: string,
	modelName: string,
	action: GeminiContentAction,
	apiKey: string
): string {
	const path = buildGeminiUpstreamActionUrl(baseUrl, modelName, action);
	const u = new URL(path);
	u.searchParams.set('key', apiKey);
	applyGeminiStreamQueryParams(u, action);
	return u.toString();
}

export type PlaygroundInvokeInput = {
	routeId: string;
	body: Record<string, unknown>;
	/** 仅 `upstream_protocol === gemini` 时使用；缺省为 `generateContent`。 */
	geminiAction?: GeminiContentAction;
	/** 可选：指定 `provider_api_keys.id` 做连通性测试。 */
	providerKeyId?: string | null;
};

export type PlaygroundInvokeResult = {
	response: Response;
	/** 供响应头展示（已脱敏 query 中的 key） */
	upstreamUrlForHeader: string;
	latencyMs: number;
	/** 与上游 `fetch` body 一致的 JSON 文本（合并 custom_params、写入 model 等之后） */
	upstreamWireBodyJson: string;
};

/**
 * 发起一次上游请求并透传 `Response`（含 body stream）。不计费、不写日志。
 */
export async function invokePlaygroundUpstream(
	repos: GatewayRepositories,
	input: PlaygroundInvokeInput,
	requestSignal?: AbortSignal
): Promise<PlaygroundInvokeResult> {
	const route = await resolvePlaygroundRoute(repos, input.routeId, input.providerKeyId);
	const userBody = input.body;
	if (!isPlainObject(userBody)) {
		throw badRequest('body must be a JSON object');
	}

	const merged = mergePlaygroundRequestBody(route, userBody);
	let url: string;
	let headers: Record<string, string>;
	let requestBody: Record<string, unknown>;

	const start = Date.now();

	switch (route.upstreamProtocol) {
		case 'openai': {
			url = openAiChatCompletionsUrl(route.baseUrl);
			headers = {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${route.providerApiKey}`,
			};
			requestBody = { ...merged, model: route.providerModelName };
			break;
		}
		case 'anthropic': {
			url = anthropicMessagesUrl(route.baseUrl);
			headers = {
				'Content-Type': 'application/json',
				'x-api-key': route.providerApiKey,
				'anthropic-version': '2023-06-01',
			};
			requestBody = { ...merged, model: route.providerModelName };
			break;
		}
		case 'gemini': {
			const action: GeminiContentAction =
				input.geminiAction === 'streamGenerateContent' ? 'streamGenerateContent' : 'generateContent';
			url = geminiActionUrl(route.baseUrl, route.providerModelName, action, route.providerApiKey);
			headers = { 'Content-Type': 'application/json' };
			requestBody = merged;
			break;
		}
		default: {
			const _exhaustive: never = route.upstreamProtocol;
			throw badRequest(`Unsupported protocol: ${String(_exhaustive)}`);
		}
	}

	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(requestBody),
			signal: requestSignal,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Upstream fetch failed';
		throw new AdminServiceError(502, msg);
	}

	const latencyMs = Date.now() - start;
	const upstreamUrlForHeader =
		route.upstreamProtocol === 'gemini' ? stripApiKeyFromUrlForHeader(url) : url;

	let upstreamWireBodyJson = JSON.stringify(requestBody);
	/** 响应自定义头不宜过大；超长时截断并标注（避免中间截断破坏 JSON）。 */
	const WIRE_BODY_HEADER_MAX = 6144;
	if (upstreamWireBodyJson.length > WIRE_BODY_HEADER_MAX) {
		upstreamWireBodyJson = JSON.stringify(
			{
				__playground_truncated: true,
				__original_length: upstreamWireBodyJson.length,
				__preview: upstreamWireBodyJson.slice(0, Math.min(4000, WIRE_BODY_HEADER_MAX - 200)),
			},
			null,
			2
		);
	}

	return { response, upstreamUrlForHeader, latencyMs, upstreamWireBodyJson };
}
