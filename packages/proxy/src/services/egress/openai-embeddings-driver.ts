/**
 * OpenAI 兼容 `POST …/embeddings` 出站：单次 JSON，不走 SSE。
 * 用量取 `usage.prompt_tokens`（缺失时回退 `total_tokens`）；向量模型没有输出 token。
 */
import {
	applyRouteExtraHeaders,
	applyVertexOpenAiModelPrefix,
	resolveProviderUpstreamSecret,
	resolveUpstreamEndpoint,
} from '@octafuse/core';
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { buildRouteRequestBody } from '../route-default-params';
import { sanitizeRewrappedHeaders } from './response-headers';
import { extractUpstreamRequestId } from './upstream-request-id';

const EMPTY_USAGE_LOCAL: UsageFromStream = {
	input_tokens: 0,
	output_tokens: 0,
	cache_read_tokens: 0,
	cache_write_tokens: 0,
	reasoning_tokens: 0,
	total_tokens: 0,
	raw_usage: null,
};

type EmbeddingsUsage = {
	prompt_tokens?: number;
	input_tokens?: number;
	total_tokens?: number;
};

function finiteCount(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 从上游响应体解析 usage；没有可用 usage 时返回 null（记为 incomplete）。 */
export function parseOpenAiEmbeddingsUsage(text: string): UsageFromStream | null {
	let parsed: { usage?: EmbeddingsUsage } | null;
	try {
		parsed = JSON.parse(text) as { usage?: EmbeddingsUsage };
	} catch {
		return null;
	}
	const u = parsed?.usage;
	if (!u || typeof u !== 'object') return null;
	const inputTokens = finiteCount(u.prompt_tokens) || finiteCount(u.input_tokens) || finiteCount(u.total_tokens);
	if (inputTokens <= 0) return null;
	return {
		...EMPTY_USAGE_LOCAL,
		input_tokens: inputTokens,
		total_tokens: finiteCount(u.total_tokens) || inputTokens,
		raw_usage: JSON.stringify(u),
	};
}

/** 向供应商发起 `{base}/embeddings`：合并路由默认参数，`model` 换为上游名。 */
export async function dispatchOpenAiEmbeddingsRoute(
	route: RouteResult,
	body: Record<string, unknown>,
	_requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream>; upstreamRequestId: string | null }> {
	const url = resolveUpstreamEndpoint('openai', 'embeddings', route.providerEndpoints, {
		providerId: route.providerId,
	});
	const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
	const requestBody = {
		...buildRouteRequestBody(route, body),
		model: applyVertexOpenAiModelPrefix(url, route.providerModelName),
	};

	const response = await fetch(url, {
		method: 'POST',
		headers: applyRouteExtraHeaders(
			{
				'Content-Type': 'application/json',
				Authorization: `Bearer ${secret}`,
			},
			route.customParams
		),
		body: JSON.stringify(requestBody),
	});
	timing?.markAttemptHeaders(attempt, response.status);
	const upstreamRequestId = extractUpstreamRequestId(response.headers);

	if (!response.ok) {
		return { response, usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL), upstreamRequestId };
	}

	const contentType = response.headers.get('Content-Type') ?? '';
	if (!contentType.includes('application/json')) {
		return { response, usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL), upstreamRequestId };
	}
	try {
		const text = await response.text();
		timing?.markStreamComplete();
		const usage = parseOpenAiEmbeddingsUsage(text) ?? EMPTY_USAGE_LOCAL;
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
