/**
 * Gemini 原生 `embedContent` / `batchEmbedContents` 出站：单次 JSON，不走 SSE。
 * 用量取 `usageMetadata.promptTokenCount`；向量模型没有输出 token。
 */
import {
	applyRouteExtraHeaders,
	GEMINI_EMBED_OPERATION,
	prepareGeminiUpstreamFetch,
	resolveGeminiAuthForUpstreamSecret,
	resolveProviderUpstreamSecret,
	resolveUpstreamEndpoint,
	type GeminiEmbedAction,
} from '@octafuse/core';
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { buildRouteRequestBody } from '../route-default-params';
import { sanitizeRewrappedHeaders } from './response-headers';
import { extractUpstreamRequestId } from './upstream-request-id';

export type { GeminiEmbedAction };

const EMPTY_USAGE_LOCAL: UsageFromStream = {
	input_tokens: 0,
	output_tokens: 0,
	cache_read_tokens: 0,
	cache_write_tokens: 0,
	reasoning_tokens: 0,
	total_tokens: 0,
	raw_usage: null,
};

type JsonObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is JsonObject {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finiteCount(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 把请求体里的 `model` 统一改写为 `models/{providerModelName}`。
 * - `batchEmbedContents`：Developer API 要求每个 `requests[].model` 都与 URL 一致，缺失时补上。
 * - `embedContent`：模型在 URL 里，客户端若在 body 里带了 `model` 才改写，不主动添加。
 */
export function rewriteGeminiEmbedModel(
	body: JsonObject,
	action: GeminiEmbedAction,
	providerModelName: string
): JsonObject {
	const wireModel = `models/${providerModelName}`;
	if (action === 'batchEmbedContents') {
		const requests = Array.isArray(body.requests)
			? body.requests.map((item) => (isPlainObject(item) ? { ...item, model: wireModel } : item))
			: body.requests;
		return { ...body, requests };
	}
	if (typeof body.model === 'string') {
		return { ...body, model: wireModel };
	}
	return body;
}

/** 从上游响应体解析 `usageMetadata`；没有可用用量时返回 null（记为 incomplete）。 */
export function parseGeminiEmbedUsage(text: string): UsageFromStream | null {
	let parsed: { usageMetadata?: { promptTokenCount?: number; totalTokenCount?: number } } | null;
	try {
		parsed = JSON.parse(text) as typeof parsed;
	} catch {
		return null;
	}
	const u = parsed?.usageMetadata;
	if (!u || typeof u !== 'object') return null;
	const inputTokens = finiteCount(u.promptTokenCount) || finiteCount(u.totalTokenCount);
	if (inputTokens <= 0) return null;
	return {
		...EMPTY_USAGE_LOCAL,
		input_tokens: inputTokens,
		total_tokens: finiteCount(u.totalTokenCount) || inputTokens,
		raw_usage: JSON.stringify(u),
	};
}

/** 调用 Gemini `{base}/{model}:{embedContent|batchEmbedContents}`。 */
export async function dispatchGeminiEmbedRoute(
	route: RouteResult,
	body: JsonObject,
	action: GeminiEmbedAction,
	search: string,
	_requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream>; upstreamRequestId: string | null }> {
	const resolvedUrl = resolveUpstreamEndpoint('gemini', GEMINI_EMBED_OPERATION, route.providerEndpoints, {
		model: route.providerModelName,
		action,
		providerId: route.providerId,
	});
	const resolved = await resolveProviderUpstreamSecret(route.providerApiKey);
	const { url, headers } = prepareGeminiUpstreamFetch({
		resolvedUrl,
		modelName: route.providerModelName,
		action,
		apiKey: resolved.secret,
		search,
		auth: resolveGeminiAuthForUpstreamSecret(
			route.providerEndpoints.gemini?.auth,
			resolved.isServiceAccount
		),
	});

	const requestBody = rewriteGeminiEmbedModel(
		buildRouteRequestBody(route, body),
		action,
		route.providerModelName
	);
	const response = await fetch(url.toString(), {
		method: 'POST',
		headers: applyRouteExtraHeaders(headers, route.customParams),
		body: JSON.stringify(requestBody),
	});
	timing?.markAttemptHeaders(attempt, response.status);
	const upstreamRequestId = extractUpstreamRequestId(response.headers);

	const contentType = response.headers.get('Content-Type') ?? '';
	if (!response.ok || !contentType.includes('application/json')) {
		return { response, usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL), upstreamRequestId };
	}
	try {
		const text = await response.text();
		timing?.markStreamComplete();
		const usage = parseGeminiEmbedUsage(text) ?? EMPTY_USAGE_LOCAL;
		return {
			response: new Response(text, {
				status: response.status,
				statusText: response.statusText,
				headers: sanitizeRewrappedHeaders(response.headers),
			}),
			usagePromise: Promise.resolve(usage),
			upstreamRequestId,
		};
	} catch {
		timing?.markStreamComplete();
		return { response, usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL), upstreamRequestId };
	}
}
