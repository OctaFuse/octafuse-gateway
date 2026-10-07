/**
 * 火山方舟 / BytePlus Seedream 生图透传。
 * `POST {base}/images/generations`。只替换 model。
 * 非流式 JSON 原样返回；`stream: true` 且上游是 SSE 时边转发边扫描 `generated_images`。
 */
import { countVolcengineImages, scanVolcengineImageSse, volcengineSseImageCount } from '@octafuse/core/volcengine-native';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import type { ProxyDispatchMeta, ProxyDispatchResult } from '../failover-dispatch';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { postVolcengineImages, VolcengineImagesUpstreamError, type VolcengineImagesFetch } from './volcengine-images-post';

type FetchLike = VolcengineImagesFetch;

export type VolcengineJsonPassthroughOptions = {
	fetchImpl?: FetchLike;
	timeoutMs?: number;
};

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

function usageWith(partial: Partial<UsageFromStream> = {}): UsageFromStream {
	return { ...EMPTY_USAGE, ...partial };
}

function errorResult(
	status: number,
	message: string,
	meta: ProxyDispatchMeta,
): ProxyDispatchResult {
	const payload = { error: { message } };
	meta.parsedBody = payload;
	meta.imageCount = 0;
	return {
		response: jsonResponse(status, JSON.stringify(payload), 'application/json'),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: null,
		meta,
	};
}

export async function dispatchVolcengineJsonPassthrough(
	route: RouteResult,
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: VolcengineJsonPassthroughOptions = {},
): Promise<ProxyDispatchResult> {
	if (
		route.adapter !== 'passthrough' ||
		route.upstreamProtocol !== 'volcengine' ||
		route.upstreamOperation !== 'images.generations'
	) {
		throw new Error(`Unsupported Volcengine passthrough adapter: ${route.adapter}`);
	}
	const meta: ProxyDispatchMeta = { imageCount: null, parsedBody: null };
	try {
		const posted = await postVolcengineImages({
			route,
			body: { ...body, model: route.providerModelName },
			requestSignal,
			timing,
			attempt,
			fetchImpl: options.fetchImpl,
			timeoutMs: options.timeoutMs,
		});
		const response = posted.response;
		const headerRequestId = posted.upstreamRequestId;
		const contentType = response.headers.get('content-type') ?? '';
		const stream =
			body.stream === true &&
			response.ok &&
			response.body != null &&
			contentType.toLowerCase().includes('text/event-stream');
		if (stream) {
			return streamResult(response, headerRequestId, meta, timing);
		}
		const text = await response.text();
		timing?.markStreamComplete();
		let parsed: unknown = text;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = text;
		}
		const ok = response.status >= 200 && response.status < 300;
		meta.parsedBody = parsed;
		meta.imageCount = ok ? countVolcengineImages(parsed) : 0;
		return {
			response: jsonResponse(response.status, text, contentType),
			usagePromise: Promise.resolve(usageWith()),
			upstreamRequestId: headerRequestId,
			meta,
		};
	} catch (error) {
		timing?.markStreamComplete();
		if (error instanceof VolcengineImagesUpstreamError) {
			meta.imageAbortReason = error.abortReason;
			return errorResult(error.status, error.message, meta);
		}
		throw error;
	}
}

function streamResult(
	response: Response,
	headerRequestId: string | null,
	meta: ProxyDispatchMeta,
	timing?: RequestTimingCollector | null,
): ProxyDispatchResult {
	let resolveUsage: (usage: UsageFromStream) => void = () => undefined;
	const usagePromise = new Promise<UsageFromStream>((resolve) => {
		resolveUsage = resolve;
	});
	const source = response.body;
	if (!source) {
		meta.imageCount = 0;
		resolveUsage(EMPTY_USAGE);
		return { response, usagePromise, upstreamRequestId: headerRequestId, meta };
	}
	const reader = source.getReader();
	const decoder = new TextDecoder();
	let carry = '';
	let generatedImages: number | null = null;
	let partialSucceeded = 0;
	let sawError = false;
	const finish = (extra: Partial<UsageFromStream> = {}) => {
		meta.imageCount = volcengineSseImageCount({
			generatedImages,
			partialSucceeded,
			error: sawError,
		});
		resolveUsage(usageWith(extra));
	};
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (chunk.done) {
					timing?.markStreamComplete();
					finish();
					controller.close();
					return;
				}
				const scanned = scanVolcengineImageSse(decoder.decode(chunk.value, { stream: true }), carry);
				carry = scanned.carry;
				if (scanned.generatedImages != null) generatedImages = scanned.generatedImages;
				partialSucceeded += scanned.partialSucceeded;
				if (scanned.error) sawError = true;
				controller.enqueue(chunk.value);
			} catch (error) {
				timing?.markStreamComplete();
				finish({ stream_error: error instanceof Error ? error.message : String(error) });
				controller.error(error);
			}
		},
		cancel(reason) {
			timing?.markStreamComplete();
			meta.imageAbortReason = 'client_abort';
			finish({ cancelled: true });
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
		upstreamRequestId: headerRequestId,
		meta,
	};
}
