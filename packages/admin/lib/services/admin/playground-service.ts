/**
 * Playground：按单条 `model_routes` 直连上游，不经过 Proxy、不鉴 API Key、不写 `api_key_request_logs`、不计费、无 failover。
 */
import type { GatewayRepositories, ProviderEndpointsMap } from '@octafuse/core';
import { isImageGenerationModel } from '@octafuse/core/db/model-modalities';
import {
	type GeminiContentAction,
	prepareGeminiUpstreamFetch,
} from '@octafuse/core/gemini-upstream-url';
import {
	parseProviderEndpoints,
	resolveUpstreamEndpoint,
} from '@octafuse/core/provider-endpoints';
import type { UpstreamProtocol } from '@octafuse/core/upstream-protocol';
import { normalizeUpstreamProtocol } from '@octafuse/core/upstream-protocol';
import { AdminServiceError, badRequest, notFound } from './errors';
import { resolvePlaygroundProviderKey } from './provider-api-keys-service';

/** 与 Proxy `RouteResult` 对齐的最小子集，供合并默认参数与拼 URL。 */
export type PlaygroundResolvedRoute = {
	upstreamProtocol: UpstreamProtocol;
	providerEndpoints: ProviderEndpointsMap;
	providerId: string;
	providerApiKey: string;
	providerModelName: string;
	customParams: Record<string, unknown> | null;
	providerKeyId: string;
	providerKeyLabel: string;
	/** Catalog model is image-generation (`output_modalities` includes image). */
	isImageModel: boolean;
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

	const providerEndpoints = parseProviderEndpoints(provider);

	const customParams = parseJsonObject(row.custom_params);
	if (row.custom_params && !customParams) {
		throw badRequest('Invalid custom_params JSON on route');
	}

	const resolvedKey = await resolvePlaygroundProviderKey(repos, provider.id, providerKeyId);

	const model = await repos.models.getModelDetailWithRouteCounts(row.model_id);
	const isImageModel = model
		? isImageGenerationModel({
				output_modalities: model.output_modalities as string | null | undefined,
				pricing_profile: model.pricing_profile as string | null | undefined,
			})
		: false;

	return {
		upstreamProtocol: protocol,
		providerEndpoints,
		providerId: provider.id,
		providerApiKey: resolvedKey.api_key,
		providerModelName: row.provider_model_name,
		customParams,
		providerKeyId: resolvedKey.id,
		providerKeyLabel: resolvedKey.label,
		isImageModel,
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

/** Playground Gemini 分支：按 endpoints 解析 URL 与 headers（与 Proxy 一致）。 */
export function buildPlaygroundGeminiUpstreamRequest(
	route: PlaygroundResolvedRoute,
	action: GeminiContentAction
): { url: string; headers: Record<string, string> } {
	const resolvedUrl = resolveUpstreamEndpoint('gemini', action, route.providerEndpoints, {
		model: route.providerModelName,
		action,
		providerId: route.providerId,
	});
	const { url, headers } = prepareGeminiUpstreamFetch({
		resolvedUrl,
		modelName: route.providerModelName,
		action,
		apiKey: route.providerApiKey,
		authBaseHint: route.providerEndpoints.gemini?.base,
	});
	return { url: url.toString(), headers };
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

	if (route.isImageModel && route.upstreamProtocol !== 'openai') {
		throw badRequest(
			'Image-generation models require upstream_protocol=openai (Playground Images only calls /images/generations).'
		);
	}

	switch (route.upstreamProtocol) {
		case 'openai': {
			try {
				url = resolveUpstreamEndpoint(
					'openai',
					route.isImageModel ? 'images.generations' : 'chat',
					route.providerEndpoints,
					{ providerId: route.providerId }
				);
			} catch (e) {
				throw badRequest(e instanceof Error ? e.message : 'Failed to resolve OpenAI upstream URL');
			}
			headers = {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${route.providerApiKey}`,
			};
			requestBody = { ...merged, model: route.providerModelName };
			break;
		}
		case 'anthropic': {
			try {
				url = resolveUpstreamEndpoint('anthropic', 'messages', route.providerEndpoints, {
					providerId: route.providerId,
				});
			} catch (e) {
				throw badRequest(e instanceof Error ? e.message : 'Failed to resolve Anthropic upstream URL');
			}
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
			let geminiRequest: { url: string; headers: Record<string, string> };
			try {
				geminiRequest = buildPlaygroundGeminiUpstreamRequest(route, action);
			} catch (e) {
				throw badRequest(e instanceof Error ? e.message : 'Failed to resolve Gemini upstream URL');
			}
			url = geminiRequest.url;
			headers = geminiRequest.headers;
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
