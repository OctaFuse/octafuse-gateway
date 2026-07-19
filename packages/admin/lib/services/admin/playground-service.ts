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
import {
	IMAGE_MAX_BYTES_PER_FILE,
	IMAGE_MAX_REFERENCE_COUNT,
	IMAGE_MAX_TOTAL_UPLOAD_BYTES,
	type ImageOperation,
} from '@/lib/image-generations';
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
	/**
	 * Image models: `generations` (JSON) or `edits` (multipart).
	 * Default: generations when `isImageModel`, otherwise ignored.
	 * For edits, `body.image` / `body.images` should be data URL string(s).
	 */
	imageOperation?: ImageOperation;
	/** 可选：指定 `provider_api_keys.id` 做连通性测试。 */
	providerKeyId?: string | null;
};

type DecodedEditImage = {
	filename: string;
	mimeType: string;
	bytes: Uint8Array;
};

function decodeDataUrlImage(
	raw: string,
	fallbackName: string
): DecodedEditImage | { error: string } {
	const trimmed = raw.trim();
	const m = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
	if (!m) {
		return { error: `image must be a data URL (got ${fallbackName})` };
	}
	const mimeType = m[1].trim() || 'application/octet-stream';
	const b64 = m[2].replace(/\s/g, '');
	let binary: string;
	try {
		binary = atob(b64);
	} catch {
		return { error: `invalid base64 in ${fallbackName}` };
	}
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	if (bytes.byteLength > IMAGE_MAX_BYTES_PER_FILE) {
		return { error: `each image must be at most ${IMAGE_MAX_BYTES_PER_FILE} bytes` };
	}
	const ext =
		mimeType.includes('jpeg') || mimeType.includes('jpg')
			? 'jpg'
			: mimeType.includes('webp')
				? 'webp'
				: 'png';
	return {
		filename: fallbackName.includes('.') ? fallbackName : `${fallbackName}.${ext}`,
		mimeType,
		bytes,
	};
}

function collectEditImagesFromBody(
	body: Record<string, unknown>
): { ok: true; images: DecodedEditImage[] } | { ok: false; error: string } {
	const images: DecodedEditImage[] = [];
	let total = 0;

	const push = (value: unknown, name: string): string | null => {
		if (typeof value !== 'string' || value.trim() === '') {
			return `image field ${name} must be a non-empty data URL string`;
		}
		const decoded = decodeDataUrlImage(value, name);
		if ('error' in decoded) return decoded.error;
		if (total + decoded.bytes.byteLength > IMAGE_MAX_TOTAL_UPLOAD_BYTES) {
			return `total image upload must be at most ${IMAGE_MAX_TOTAL_UPLOAD_BYTES} bytes`;
		}
		total += decoded.bytes.byteLength;
		images.push(decoded);
		return null;
	};

	const field = body.image ?? body.images;
	if (Array.isArray(field)) {
		let i = 0;
		for (const item of field) {
			const err = push(item, `image-${i++}`);
			if (err) return { ok: false, error: err };
		}
	} else if (field != null) {
		const err = push(field, 'image');
		if (err) return { ok: false, error: err };
	}

	if (images.length === 0) {
		return { ok: false, error: 'At least one reference image (data URL) is required for edits' };
	}
	if (images.length > IMAGE_MAX_REFERENCE_COUNT) {
		return {
			ok: false,
			error: `At most ${IMAGE_MAX_REFERENCE_COUNT} reference images are allowed`,
		};
	}
	return { ok: true, images };
}

function appendOptionalFormString(fd: FormData, key: string, value: unknown): void {
	if (value == null) return;
	if (typeof value === 'string') {
		const t = value.trim();
		if (t !== '') fd.append(key, t);
		return;
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		fd.append(key, String(value));
	}
}

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
	let fetchBody: BodyInit;
	let upstreamWireBodyJson: string;

	const start = Date.now();

	if (route.isImageModel && route.upstreamProtocol !== 'openai') {
		throw badRequest(
			'Image-generation models require upstream_protocol=openai (Playground Images only calls /images/generations or /images/edits).'
		);
	}

	const imageOperation: ImageOperation | null = route.isImageModel
		? input.imageOperation === 'edits'
			? 'edits'
			: 'generations'
		: null;

	switch (route.upstreamProtocol) {
		case 'openai': {
			if (imageOperation === 'edits') {
				const collected = collectEditImagesFromBody(merged);
				if (!collected.ok) throw badRequest(collected.error);
				try {
					url = resolveUpstreamEndpoint('openai', 'images.edits', route.providerEndpoints, {
						providerId: route.providerId,
					});
				} catch (e) {
					throw badRequest(e instanceof Error ? e.message : 'Failed to resolve OpenAI edits URL');
				}
				const fd = new FormData();
				fd.append('model', route.providerModelName);
				appendOptionalFormString(fd, 'prompt', merged.prompt);
				appendOptionalFormString(fd, 'n', merged.n);
				appendOptionalFormString(fd, 'size', merged.size);
				appendOptionalFormString(fd, 'quality', merged.quality);
				appendOptionalFormString(fd, 'background', merged.background);
				const fileSummaries: string[] = [];
				for (const img of collected.images) {
					const copy = img.bytes.buffer.slice(
						img.bytes.byteOffset,
						img.bytes.byteOffset + img.bytes.byteLength
					) as ArrayBuffer;
					const file = new File([copy], img.filename, { type: img.mimeType });
					fd.append('image', file, img.filename);
					fileSummaries.push(`${img.filename} (${img.bytes.byteLength} bytes, ${img.mimeType})`);
				}
				headers = {
					Authorization: `Bearer ${route.providerApiKey}`,
				};
				fetchBody = fd;
				upstreamWireBodyJson = JSON.stringify(
					{
						__playground_multipart: true,
						operation: 'images.edits',
						model: route.providerModelName,
						prompt: typeof merged.prompt === 'string' ? merged.prompt : undefined,
						n: merged.n,
						size: merged.size,
						quality: merged.quality,
						background: merged.background,
						images: fileSummaries,
					},
					null,
					2
				);
				break;
			}

			const capability = imageOperation === 'generations' ? 'images.generations' : 'chat';
			try {
				url = resolveUpstreamEndpoint('openai', capability, route.providerEndpoints, {
					providerId: route.providerId,
				});
			} catch (e) {
				throw badRequest(e instanceof Error ? e.message : 'Failed to resolve OpenAI upstream URL');
			}
			headers = {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${route.providerApiKey}`,
			};
			const requestBody: Record<string, unknown> = { ...merged, model: route.providerModelName };
			// Strip accidental data-URL image fields from generations JSON
			delete requestBody.image;
			delete requestBody.images;
			fetchBody = JSON.stringify(requestBody);
			upstreamWireBodyJson = fetchBody;
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
			const requestBody = { ...merged, model: route.providerModelName };
			fetchBody = JSON.stringify(requestBody);
			upstreamWireBodyJson = fetchBody;
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
			fetchBody = JSON.stringify(merged);
			upstreamWireBodyJson = fetchBody;
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
			body: fetchBody,
			signal: requestSignal,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Upstream fetch failed';
		throw new AdminServiceError(502, msg);
	}

	const latencyMs = Date.now() - start;
	const upstreamUrlForHeader =
		route.upstreamProtocol === 'gemini' ? stripApiKeyFromUrlForHeader(url) : url;

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
