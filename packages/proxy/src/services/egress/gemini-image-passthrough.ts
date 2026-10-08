/**
 * Gemini 原生图片模型透传。
 * `POST {gemini.base}/models/{model}:{generateContent|streamGenerateContent}`。
 * 请求体原样转发（再合并路由 custom_params）；响应原样返回。
 * 非流式读 `usageMetadata` 与非 thought 的 inlineData；流式边转发边累计。
 */
import {
	applyRouteExtraHeaders,
	GEMINI_GENERATE_OPERATION,
	parseGeminiImageUsage,
	prepareGeminiUpstreamFetch,
	resolveGeminiAuthForUpstreamSecret,
	resolveProviderUpstreamSecret,
	resolveUpstreamEndpoint,
} from '@octafuse/core';
import {
	countGeminiOutputImages,
	scanGeminiGenerateContentSse,
} from '@octafuse/core/gemini-image-native';
import type { ImageTokenUsage } from '@octafuse/core';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import type { ProxyDispatchMeta, ProxyDispatchResult } from '../failover-dispatch';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { buildRouteRequestBody } from '../route-default-params';
import { extractUpstreamRequestId } from './upstream-request-id';
import { IMAGE_GENERATION_TIMEOUT_MS } from './openai-images-driver';

export type GeminiImageAction = 'generateContent' | 'streamGenerateContent';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type GeminiImagePassthroughOptions = {
	fetchImpl?: FetchLike;
	timeoutMs?: number;
};

type ImageAbortReason = 'none' | 'gateway_timeout' | 'client_abort';

const STREAM_HEADER_BLOCKLIST = new Set([
	'content-length',
	'content-encoding',
	'transfer-encoding',
	'connection',
]);

function streamResponseHeaders(source: Headers): Headers {
	const headers = new Headers();
	source.forEach((value, key) => {
		if (STREAM_HEADER_BLOCKLIST.has(key.toLowerCase())) return;
		headers.append(key, value);
	});
	return headers;
}

function jsonResponse(status: number, text: string, contentType: string): Response {
	return new Response(text, {
		status,
		headers: { 'Content-Type': contentType || 'application/json' },
	});
}

export function withTimeoutSignal(
	requestSignal: AbortSignal | undefined,
	timeoutMs: number,
): { signal: AbortSignal; clear: () => void; getAbortReason: () => ImageAbortReason } {
	const controller = new AbortController();
	let reason: ImageAbortReason = 'none';
	const onClientAbort = () => {
		if (reason === 'none') reason = 'client_abort';
		controller.abort();
	};
	requestSignal?.addEventListener('abort', onClientAbort, { once: true });
	const timer = setTimeout(() => {
		if (reason === 'none') reason = 'gateway_timeout';
		controller.abort();
	}, timeoutMs);
	return {
		signal: controller.signal,
		clear: () => {
			clearTimeout(timer);
			requestSignal?.removeEventListener('abort', onClientAbort);
		},
		getAbortReason: () => reason,
	};
}

function errorResult(
	status: number,
	message: string,
	meta: ProxyDispatchMeta,
	abortReason?: 'client_abort' | 'gateway_timeout',
): ProxyDispatchResult {
	if (abortReason) meta.imageAbortReason = abortReason;
	meta.imageCount = 0;
	meta.imageUsage = null;
	const payload = { error: { message } };
	return {
		response: jsonResponse(status, JSON.stringify(payload), 'application/json'),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: null,
		meta,
	};
}

function applyImageMeta(
	meta: ProxyDispatchMeta,
	imageCount: number,
	usageMetadata: unknown | null,
): ImageTokenUsage | null {
	const imageUsage = usageMetadata ? parseGeminiImageUsage(usageMetadata) : null;
	meta.imageCount = imageCount;
	meta.imageUsage = imageUsage;
	return imageUsage;
}

export async function dispatchGeminiImagePassthrough(
	route: RouteResult,
	action: GeminiImageAction,
	body: Record<string, unknown>,
	search: string,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: GeminiImagePassthroughOptions = {},
): Promise<ProxyDispatchResult> {
	if (
		route.adapter !== 'passthrough' ||
		route.upstreamProtocol !== 'gemini' ||
		route.upstreamOperation !== GEMINI_GENERATE_OPERATION
	) {
		throw new Error(`Unsupported Gemini image passthrough adapter: ${route.adapter}`);
	}
	const meta: ProxyDispatchMeta = { imageCount: null, imageUsage: null, parsedBody: null };
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? IMAGE_GENERATION_TIMEOUT_MS;
	const timeout = withTimeoutSignal(requestSignal, timeoutMs);
	try {
		const resolvedUrl = resolveUpstreamEndpoint('gemini', GEMINI_GENERATE_OPERATION, route.providerEndpoints, {
			model: route.providerModelName,
			action,
			providerId: route.providerId,
		});
		const resolved = await resolveProviderUpstreamSecret(route.providerApiKey);
		const prepared = prepareGeminiUpstreamFetch({
			resolvedUrl,
			modelName: route.providerModelName,
			action,
			apiKey: resolved.secret,
			search,
			auth: resolveGeminiAuthForUpstreamSecret(route.providerEndpoints.gemini?.auth, resolved.isServiceAccount),
		});
		const requestBody = buildRouteRequestBody(route, body);
		const response = await fetchImpl(prepared.url.toString(), {
			method: 'POST',
			headers: applyRouteExtraHeaders(prepared.headers, route.customParams),
			body: JSON.stringify(requestBody),
			signal: timeout.signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const upstreamRequestId = extractUpstreamRequestId(response.headers);
		const contentType = response.headers.get('content-type') ?? '';
		const lowerType = contentType.toLowerCase();
		const sse =
			response.ok &&
			response.body != null &&
			(lowerType.includes('text/event-stream') ||
				(action === 'streamGenerateContent' && !lowerType.includes('application/json')));
		if (sse && response.body) {
			return streamResult(response, upstreamRequestId, meta, timeout, timing);
		}
		const text = await response.text();
		timeout.clear();
		timing?.markStreamComplete();
		let parsed: unknown = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = null;
		}
		const ok = response.status >= 200 && response.status < 300;
		const usageMetadata =
			parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
				? ((parsed as Record<string, unknown>).usageMetadata ??
					(parsed as Record<string, unknown>).usage_metadata ??
					null)
				: null;
		applyImageMeta(meta, ok ? countGeminiOutputImages(parsed) : 0, ok ? usageMetadata : null);
		return {
			response: jsonResponse(response.status, text, contentType),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId,
			meta,
		};
	} catch (error) {
		timeout.clear();
		timing?.markStreamComplete();
		const abort = timeout.getAbortReason();
		const clientAborted = abort === 'client_abort' || requestSignal?.aborted === true;
		const timedOut = abort === 'gateway_timeout';
		const message = timedOut
			? `Gemini image generation timed out after ${timeoutMs}ms`
			: clientAborted
				? 'Gemini image generation was cancelled by the client'
				: `Gemini image generation failed: ${error instanceof Error ? error.message : String(error)}`;
		return errorResult(
			timedOut ? 504 : clientAborted ? 499 : 502,
			message,
			meta,
			clientAborted ? 'client_abort' : timedOut ? 'gateway_timeout' : undefined,
		);
	}
}

function streamResult(
	response: Response,
	upstreamRequestId: string | null,
	meta: ProxyDispatchMeta,
	timeout: { signal: AbortSignal; clear: () => void; getAbortReason: () => ImageAbortReason },
	timing?: RequestTimingCollector | null,
): ProxyDispatchResult {
	let resolveUsage: (usage: UsageFromStream) => void = () => undefined;
	const usagePromise = new Promise<UsageFromStream>((resolve) => {
		resolveUsage = resolve;
	});
	const source = response.body;
	if (!source) {
		timeout.clear();
		applyImageMeta(meta, 0, null);
		resolveUsage(EMPTY_USAGE);
		return { response, usagePromise, upstreamRequestId, meta };
	}
	const reader = source.getReader();
	const decoder = new TextDecoder();
	let carry = '';
	let imageCount = 0;
	let usageMetadata: unknown | null = null;
	let finished = false;
	const finish = () => {
		if (finished) return;
		finished = true;
		timeout.clear();
		const tail = scanGeminiGenerateContentSse('\n\n', carry);
		carry = '';
		imageCount += tail.imageCount;
		if (tail.usageMetadata) usageMetadata = tail.usageMetadata;
		const abort = timeout.getAbortReason();
		if (abort === 'client_abort' || abort === 'gateway_timeout') {
			meta.imageAbortReason = abort;
		}
		applyImageMeta(meta, meta.imageAbortReason ? 0 : imageCount, meta.imageAbortReason ? null : usageMetadata);
		resolveUsage(EMPTY_USAGE);
	};
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				if (timeout.signal.aborted) {
					timing?.markStreamComplete();
					finish();
					controller.error(timeout.signal.reason ?? new DOMException('aborted', 'AbortError'));
					return;
				}
				const chunk = await reader.read();
				if (chunk.done) {
					timing?.markStreamComplete();
					finish();
					controller.close();
					return;
				}
				const scanned = scanGeminiGenerateContentSse(decoder.decode(chunk.value, { stream: true }), carry);
				carry = scanned.carry;
				imageCount += scanned.imageCount;
				if (scanned.usageMetadata) usageMetadata = scanned.usageMetadata;
				controller.enqueue(chunk.value);
			} catch (error) {
				timing?.markStreamComplete();
				finish();
				controller.error(error);
			}
		},
		cancel(reason) {
			timing?.markStreamComplete();
			if (timeout.getAbortReason() === 'none') {
				meta.imageAbortReason = 'client_abort';
			}
			finish();
			return reader.cancel(reason);
		},
	});
	return {
		response: new Response(stream, {
			status: response.status,
			statusText: response.statusText,
			headers: streamResponseHeaders(response.headers),
		}),
		usagePromise,
		upstreamRequestId,
		meta,
	};
}
