/**
 * MiniMax 原生 JSON / SSE 透传。
 * `audio.speech` → `POST {base}/t2a_v2`（非流式与 `stream: true` 共用）。
 * `images.generations` → `POST {base}/image_generation`。
 * 只替换 model。HTTP 200 但 `base_resp.status_code != 0` 时 body 原样返回，状态码按业务码改写。
 */
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret, resolveUpstreamEndpoint } from '@octafuse/core';
import {
	countMiniMaxImages,
	miniMaxBaseRespHttpStatus,
	readMiniMaxBaseResp,
	readMiniMaxUsageCharacters,
} from '@octafuse/core/minimax-native';
import type { ProviderEndpointCapability } from '@octafuse/core/provider-endpoints';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import type { ProxyDispatchResult } from '../failover-dispatch';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { extractUpstreamRequestId } from './upstream-request-id';

const JSON_TIMEOUT_MS = 120_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type MiniMaxJsonPassthroughOperation = 'audio.speech' | 'images.generations';

export type MiniMaxJsonPassthroughOptions = {
	fetchImpl?: FetchLike;
	timeoutMs?: number;
};

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function billingPayload(parsed: unknown): unknown {
	if (Array.isArray(parsed) && parsed.length > 0) return parsed[parsed.length - 1];
	return parsed;
}

function traceIdOf(parsed: unknown): string | null {
	const traceId = asObject(billingPayload(parsed))?.trace_id;
	return typeof traceId === 'string' && traceId.trim() ? traceId.trim() : null;
}

function usageWith(partial: Partial<UsageFromStream>): UsageFromStream {
	return { ...EMPTY_USAGE, ...partial };
}

const STREAM_HEADER_BLOCKLIST = new Set([
	'content-length',
	'content-encoding',
	'transfer-encoding',
	'connection',
]);

/** 重新封装的 SSE 不能沿用上游的长度和压缩头，否则浏览器会把明文流当成 gzip 或提前断开。 */
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

export async function dispatchMiniMaxJsonPassthrough(
	route: RouteResult,
	operation: MiniMaxJsonPassthroughOperation,
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: MiniMaxJsonPassthroughOptions = {},
): Promise<ProxyDispatchResult> {
	if (
		route.adapter !== 'passthrough' ||
		route.upstreamProtocol !== 'minimax' ||
		route.upstreamOperation !== operation
	) {
		throw new Error(`Unsupported MiniMax passthrough adapter: ${route.adapter}`);
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
	const url = resolveUpstreamEndpoint('minimax', operation as ProviderEndpointCapability, route.providerEndpoints, {
		providerId: route.providerId,
	});
	const timeoutController = new AbortController();
	const timer = setTimeout(() => timeoutController.abort(), options.timeoutMs ?? JSON_TIMEOUT_MS);
	const onClientAbort = () => timeoutController.abort();
	requestSignal?.addEventListener('abort', onClientAbort, { once: true });
	try {
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: applyRouteExtraHeaders(
				{
					Authorization: `Bearer ${secret}`,
					'Content-Type': 'application/json',
				},
				route.customParams,
			),
			body: JSON.stringify({ ...body, model: route.providerModelName }),
			signal: timeoutController.signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const headerRequestId = extractUpstreamRequestId(response.headers);
		const contentType = response.headers.get('content-type') ?? '';
		const stream =
			operation === 'audio.speech' &&
			response.ok &&
			response.body != null &&
			contentType.includes('text/event-stream');
		if (stream) {
			return streamResult(response, headerRequestId, timing);
		}
		const text = await response.text();
		timing?.markStreamComplete();
		let parsed: unknown = text;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = text;
		}
		const payload = billingPayload(parsed);
		const baseResp = readMiniMaxBaseResp(payload);
		const status =
			response.ok && baseResp && baseResp.statusCode !== 0
				? miniMaxBaseRespHttpStatus(baseResp.statusCode)
				: response.status;
		const ok = status >= 200 && status < 300;
		const characters = operation === 'audio.speech' && ok ? readMiniMaxUsageCharacters(payload) : null;
		const imageCount = operation === 'images.generations' && ok ? countMiniMaxImages(payload) : null;
		return {
			response: jsonResponse(status, text, contentType),
			usagePromise: Promise.resolve(
				usageWith({
					audio_characters: characters ?? undefined,
					raw_usage: characters != null ? JSON.stringify({ usage_characters: characters }) : null,
				}),
			),
			upstreamRequestId: headerRequestId ?? traceIdOf(parsed),
			meta: {
				parsedBody: parsed,
				audioCharacters: characters,
				imageCount,
			},
		};
	} catch (error) {
		timing?.markStreamComplete();
		const timedOut = timeoutController.signal.aborted && !requestSignal?.aborted;
		const message = timedOut
			? 'MiniMax passthrough timed out'
			: requestSignal?.aborted
				? 'MiniMax passthrough was cancelled by the client'
				: `MiniMax passthrough failed: ${error instanceof Error ? error.message : String(error)}`;
		const payload = { error: { message } };
		return {
			response: jsonResponse(timedOut ? 504 : requestSignal?.aborted ? 499 : 502, JSON.stringify(payload), 'application/json'),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			meta: { parsedBody: payload, audioCharacters: null, imageCount: null },
		};
	} finally {
		clearTimeout(timer);
		requestSignal?.removeEventListener('abort', onClientAbort);
	}
}

function scanStream(text: string, carry: string): {
	characters: number | null;
	errorCode: number | null;
	carry: string;
} {
	const window = carry + text;
	const charMatches = window.match(/"usage_characters"\s*:\s*(\d+)/g);
	let characters: number | null = null;
	if (charMatches) {
		const last = charMatches[charMatches.length - 1]?.match(/(\d+)/);
		characters = last ? Number(last[1]) : null;
	}
	const codeMatches = window.match(/"status_code"\s*:\s*(\d+)/g);
	let errorCode: number | null = null;
	if (codeMatches) {
		for (const match of codeMatches) {
			const code = Number(match.match(/(\d+)/)?.[1]);
			if (Number.isFinite(code) && code !== 0) errorCode = code;
		}
	}
	return { characters, errorCode, carry: window.slice(-80) };
}

function streamResult(
	response: Response,
	headerRequestId: string | null,
	timing?: RequestTimingCollector | null,
): ProxyDispatchResult {
	let resolveUsage: (usage: UsageFromStream) => void = () => undefined;
	const usagePromise = new Promise<UsageFromStream>((resolve) => {
		resolveUsage = resolve;
	});
	const source = response.body;
	if (!source) {
		resolveUsage(EMPTY_USAGE);
		return { response, usagePromise, upstreamRequestId: headerRequestId, meta: { audioCharacters: null } };
	}
	const reader = source.getReader();
	const decoder = new TextDecoder();
	let carry = '';
	let characters: number | null = null;
	let errorCode: number | null = null;
	const finish = (extra: Partial<UsageFromStream> = {}) => {
		const businessError = errorCode == null ? null : `MiniMax status ${errorCode}`;
		resolveUsage(
			usageWith({
				audio_characters: businessError || extra.stream_error || extra.cancelled ? undefined : (characters ?? undefined),
				cancelled: extra.cancelled,
				stream_error: extra.cancelled ? undefined : (businessError ?? extra.stream_error),
			}),
		);
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
				const scanned = scanStream(decoder.decode(chunk.value, { stream: true }), carry);
				carry = scanned.carry;
				if (scanned.characters != null) characters = scanned.characters;
				if (scanned.errorCode != null) errorCode = scanned.errorCode;
				controller.enqueue(chunk.value);
			} catch (error) {
				timing?.markStreamComplete();
				finish({ stream_error: error instanceof Error ? error.message : String(error) });
				controller.error(error);
			}
		},
		cancel(reason) {
			timing?.markStreamComplete();
			finish({ cancelled: true, stream_error: undefined });
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
		meta: { audioCharacters: null },
	};
}
