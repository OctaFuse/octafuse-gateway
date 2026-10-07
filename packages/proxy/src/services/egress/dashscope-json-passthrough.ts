/**
 * DashScope 原生 JSON / SSE 透传。
 * 只替换 model，原样返回上游 body。转换适配器不走这里。
 */
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret, resolveUpstreamEndpoint } from '@octafuse/core';
import type { ProviderEndpointCapability } from '@octafuse/core/provider-endpoints';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import type { ProxyDispatchResult } from '../failover-dispatch';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { resolveAudioBillingDuration } from './audio-duration';
import { extractUpstreamRequestId } from './upstream-request-id';

const JSON_TIMEOUT_MS = 120_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type DashScopeJsonPassthroughOptions = {
	fetchImpl?: FetchLike;
	timeoutMs?: number;
	/** 客户端带来的 `X-DashScope-SSE`。`audio.speech.stream` 在缺省时补 enable。 */
	sse?: string | null;
	/** 客户端带来的 `X-DashScope-Async`。异步提交在缺省时补 enable。 */
	asyncHeader?: string | null;
	taskId?: string | null;
};

export type DashScopePassthroughSurface =
	| 'audio.speech'
	| 'audio.speech.stream'
	| 'audio.speech.multimodal'
	| 'images.generations.multimodal'
	| 'audio.transcriptions.async';

function capabilityFor(surface: DashScopePassthroughSurface, taskId: string | null): ProviderEndpointCapability {
	if (surface === 'audio.transcriptions.async') {
		return taskId ? 'audio.transcriptions.tasks' : 'audio.transcriptions';
	}
	if (surface === 'audio.speech' || surface === 'audio.speech.stream') return 'audio.speech';
	return surface;
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asNonNegative(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	return Number.isFinite(n) && n >= 0 ? n : null;
}

function charactersFromPayload(payload: unknown): number | null {
	return asNonNegative(asObject(asObject(payload)?.usage)?.characters);
}

function durationSecondsFromPayload(payload: unknown): number | null {
	const usage = asObject(asObject(payload)?.usage);
	return asNonNegative(usage?.duration) ?? asNonNegative(usage?.seconds);
}

export function countDashScopeImages(payload: unknown): number {
	const choices = asObject(asObject(payload)?.output)?.choices;
	if (!Array.isArray(choices)) return 0;
	let count = 0;
	for (const choice of choices) {
		const content = asObject(asObject(choice)?.message)?.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			const image = asObject(part)?.image;
			if (typeof image === 'string' && image.trim()) count += 1;
		}
	}
	return count;
}

function taskStatus(payload: unknown): string {
	const output = asObject(asObject(payload)?.output);
	return typeof output?.task_status === 'string' ? output.task_status : '';
}

function transcriptionUrl(payload: unknown): string | null {
	const results = asObject(asObject(payload)?.output)?.results;
	const first = Array.isArray(results) ? asObject(results[0]) : null;
	return typeof first?.transcription_url === 'string' && first.transcription_url.trim()
		? first.transcription_url
		: null;
}

function scanCharacters(text: string, carry: string): { characters: number | null; carry: string } {
	const window = carry + text;
	const matches = window.match(/"characters"\s*:\s*(\d+(?:\.\d+)?)/g);
	let characters: number | null = null;
	if (matches) {
		const last = matches[matches.length - 1]?.match(/(\d+(?:\.\d+)?)/);
		characters = last ? asNonNegative(last[1]) : null;
	}
	return { characters, carry: window.slice(-32) };
}

function jsonResponse(status: number, payload: unknown, statusText = ''): Response {
	return new Response(JSON.stringify(payload), {
		status,
		statusText,
		headers: { 'Content-Type': 'application/json' },
	});
}

function usageWith(partial: Partial<UsageFromStream>): UsageFromStream {
	return { ...EMPTY_USAGE, ...partial };
}

export async function dispatchDashScopeJsonPassthrough(
	route: RouteResult,
	surface: DashScopePassthroughSurface,
	body: Record<string, unknown> | null,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: DashScopeJsonPassthroughOptions = {},
): Promise<ProxyDispatchResult> {
	if (route.adapter !== 'passthrough' || route.upstreamProtocol !== 'dashscope') {
		throw new Error(`Unsupported DashScope passthrough adapter: ${route.adapter}`);
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const taskId = options.taskId?.trim() || null;
	const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
	const url = resolveUpstreamEndpoint('dashscope', capabilityFor(surface, taskId), route.providerEndpoints, {
		providerId: route.providerId,
		...(taskId ? { taskId } : {}),
	});
	const method = taskId ? 'GET' : 'POST';
	const headers: Record<string, string> = {
		Authorization: `Bearer ${secret}`,
	};
	if (method === 'POST') headers['Content-Type'] = 'application/json';
	if (surface === 'audio.speech.stream' || options.sse === 'enable') headers['X-DashScope-SSE'] = 'enable';
	if (surface === 'audio.transcriptions.async' && !taskId) {
		headers['X-DashScope-Async'] = options.asyncHeader?.trim() || 'enable';
	}
	const timeoutController = new AbortController();
	const timer = setTimeout(() => timeoutController.abort(), options.timeoutMs ?? JSON_TIMEOUT_MS);
	const onClientAbort = () => timeoutController.abort();
	requestSignal?.addEventListener('abort', onClientAbort, { once: true });
	try {
		const response = await fetchImpl(url, {
			method,
			headers: applyRouteExtraHeaders(headers, route.customParams),
			body: method === 'POST' ? JSON.stringify({ ...(body ?? {}), model: route.providerModelName }) : undefined,
			signal: timeoutController.signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const headerRequestId = extractUpstreamRequestId(response.headers);
		const contentType = response.headers.get('content-type') ?? '';
		const stream = surface === 'audio.speech.stream' || options.sse === 'enable';
		if (response.ok && stream && response.body && contentType.includes('text/event-stream')) {
			return streamResult(response, headerRequestId, timing);
		}
		if (!contentType.includes('json') && !contentType.includes('text')) {
			timing?.markStreamComplete();
			return {
				response,
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: headerRequestId,
				meta: { audioCharacters: null, imageCount: null },
			};
		}
		const text = await response.text();
		timing?.markStreamComplete();
		let parsed: unknown = text;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = text;
		}
		const requestId =
			headerRequestId ??
			(typeof asObject(parsed)?.request_id === 'string' ? (asObject(parsed)?.request_id as string) : null);
		const billed = await billParsed(surface, taskId, response.ok, parsed, fetchImpl, timeoutController.signal);
		return {
			response: jsonResponse(response.status, parsed, response.statusText),
			usagePromise: Promise.resolve(
				usageWith({
					audio_characters: billed.characters ?? undefined,
					audio_duration_seconds: billed.durationSeconds ?? undefined,
					raw_usage: billed.rawUsage,
				}),
			),
			upstreamRequestId: requestId,
			meta: {
				parsedBody: parsed,
				audioCharacters: billed.characters,
				audioDurationSeconds: billed.durationSeconds,
				audioDurationSource: billed.durationSource,
				imageCount: billed.imageCount,
			},
		};
	} catch (error) {
		timing?.markStreamComplete();
		const timedOut = timeoutController.signal.aborted && !requestSignal?.aborted;
		const message = timedOut
			? 'DashScope passthrough timed out'
			: requestSignal?.aborted
				? 'DashScope passthrough was cancelled by the client'
				: `DashScope passthrough failed: ${error instanceof Error ? error.message : String(error)}`;
		const payload = { error: { message } };
		return {
			response: jsonResponse(timedOut ? 504 : requestSignal?.aborted ? 499 : 502, payload),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			meta: { parsedBody: payload, audioCharacters: null, imageCount: null },
		};
	} finally {
		clearTimeout(timer);
		requestSignal?.removeEventListener('abort', onClientAbort);
	}
}

async function billParsed(
	surface: DashScopePassthroughSurface,
	taskId: string | null,
	ok: boolean,
	parsed: unknown,
	fetchImpl: FetchLike,
	signal: AbortSignal,
): Promise<{
	characters: number | null;
	durationSeconds: number | null;
	durationSource: 'upstream' | null;
	imageCount: number | null;
	rawUsage: string | null;
}> {
	const usage = asObject(asObject(parsed)?.usage);
	const rawUsage = usage ? JSON.stringify(usage) : null;
	if (!ok) {
		return { characters: null, durationSeconds: null, durationSource: null, imageCount: null, rawUsage };
	}
	if (surface === 'images.generations.multimodal') {
		return {
			characters: null,
			durationSeconds: null,
			durationSource: null,
			imageCount: countDashScopeImages(parsed),
			rawUsage,
		};
	}
	if (surface === 'audio.speech' || surface === 'audio.speech.multimodal' || surface === 'audio.speech.stream') {
		return {
			characters: charactersFromPayload(parsed),
			durationSeconds: null,
			durationSource: null,
			imageCount: null,
			rawUsage,
		};
	}
	if (surface === 'audio.transcriptions.async' && taskId && taskStatus(parsed) === 'SUCCEEDED') {
		const url = transcriptionUrl(parsed);
		if (!url) {
			return { characters: null, durationSeconds: null, durationSource: null, imageCount: null, rawUsage };
		}
		const result = await fetchImpl(url, { signal });
		const resultText = await result.text();
		let resultBody: unknown = null;
		try {
			resultBody = resultText ? JSON.parse(resultText) : null;
		} catch {
			resultBody = null;
		}
		const seconds = result.ok ? durationSecondsFromPayload(resultBody) : null;
		const duration =
			seconds == null
				? null
				: resolveAudioBillingDuration({
						upstreamSeconds: seconds,
						fileBytes: 0,
						mimeType: 'application/octet-stream',
						clientSeconds: null,
					});
		return {
			characters: null,
			durationSeconds: duration?.seconds ?? null,
			durationSource: duration?.source === 'upstream' ? 'upstream' : null,
			imageCount: null,
			rawUsage: rawUsage ?? (asObject(resultBody)?.usage ? JSON.stringify(asObject(resultBody)?.usage) : null),
		};
	}
	return { characters: null, durationSeconds: null, durationSource: null, imageCount: null, rawUsage };
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
		return { response, usagePromise, upstreamRequestId: headerRequestId };
	}
	const reader = source.getReader();
	const decoder = new TextDecoder();
	let carry = '';
	let characters: number | null = null;
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (chunk.done) {
					timing?.markStreamComplete();
					resolveUsage(usageWith({ audio_characters: characters ?? undefined }));
					controller.close();
					return;
				}
				const scanned = scanCharacters(decoder.decode(chunk.value, { stream: true }), carry);
				carry = scanned.carry;
				if (scanned.characters != null) characters = scanned.characters;
				controller.enqueue(chunk.value);
			} catch (error) {
				timing?.markStreamComplete();
				resolveUsage({
					...EMPTY_USAGE,
					audio_characters: characters ?? undefined,
					stream_error: error instanceof Error ? error.message : String(error),
				});
				controller.error(error);
			}
		},
		cancel(reason) {
			timing?.markStreamComplete();
			resolveUsage({ ...EMPTY_USAGE, audio_characters: characters ?? undefined, cancelled: true });
			return reader.cancel(reason);
		},
	});
	const headers = new Headers(response.headers);
	return {
		response: new Response(stream, { status: response.status, statusText: response.statusText, headers }),
		usagePromise,
		upstreamRequestId: headerRequestId,
		meta: { audioCharacters: null },
	};
}
