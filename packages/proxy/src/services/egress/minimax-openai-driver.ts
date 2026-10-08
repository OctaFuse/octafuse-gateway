/**
 * OpenAI 入口 → MiniMax 官方端点。
 * `minimax-tts`：`POST /v1/audio/speech` → `POST {base}/t2a_v2`。
 * `minimax-image`：`POST /v1/images/generations` → `POST {base}/image_generation`。
 * 非流式语音把 hex 解码成音频字节；`stream_format=sse` 转成 OpenAI speech SSE。
 * 生图改写成 `{ data: [{ url | b64_json }] }`。计费仍读 usage_characters / 成功张数。
 */
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret, resolveUpstreamEndpoint } from '@octafuse/core';
import {
	MiniMaxOpenAiClientError,
	buildMiniMaxImageBodyFromOpenAi,
	buildMiniMaxT2aBodyFromOpenAi,
	fillMiniMaxSpeechDefaults,
	miniMaxImageResponseToOpenAi,
} from '@octafuse/core/minimax-openai';
import {
	applyUpstreamExtraFields,
	detachUpstreamExtraFields,
	protectedUpstreamPathsForRoute,
	type ApplyUpstreamExtraFieldsResult,
} from '@octafuse/core/upstream-extra-fields';
import {
	decodeMiniMaxHexAudio,
	miniMaxBaseRespHttpStatus,
	readMiniMaxBaseResp,
	readMiniMaxUsageCharacters,
} from '@octafuse/core/minimax-native';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { countValidImageResults, type ImageDispatchAbortReason } from './openai-images-driver';
import { SpeechSseParser, type AudioSpeechDispatchOptions, type NormalizedAudioSpeechRequest } from './audio-speech-driver';
import { extractUpstreamRequestId } from './upstream-request-id';

const UPSTREAM_TIMEOUT_MS = 120_000;

const SPEECH_CONTENT_TYPES: Record<string, string> = {
	mp3: 'audio/mpeg',
	flac: 'audio/flac',
	wav: 'audio/wav',
	pcm: 'application/octet-stream',
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type MiniMaxOpenAiDispatchOptions = AudioSpeechDispatchOptions & {
	timeoutMs?: number;
};

type SpeechEvent = {
	hex: string;
	characters: number | null;
	terminal: boolean;
	traceId: string | null;
	error: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function voiceId(voice: NormalizedAudioSpeechRequest['voice']): string {
	return typeof voice === 'string' ? voice : voice.id;
}

function errorResult(status: number, message: string, code?: string) {
	return {
		response: new Response(
			JSON.stringify({
				error: {
					message,
					type: status >= 500 ? 'upstream_error' : 'invalid_request_error',
					...(code ? { code } : {}),
				},
			}),
			{ status, headers: { 'Content-Type': 'application/json' } },
		),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: null,
	};
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.byteLength)));
	}
	return btoa(binary);
}

function sseFrame(payload: unknown): Uint8Array {
	return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export function parseMiniMaxOpenAiSpeechEvent(value: unknown): SpeechEvent {
	const base = readMiniMaxBaseResp(value);
	const root = asObject(value);
	const data = asObject(root?.data);
	const status = data?.status;
	return {
		hex: typeof data?.audio === 'string' ? data.audio.trim() : '',
		characters: readMiniMaxUsageCharacters(value),
		terminal: status === 2 || status === '2',
		traceId: typeof root?.trace_id === 'string' && root.trace_id.trim() ? root.trace_id.trim() : null,
		error:
			base && base.statusCode !== 0
				? (base.statusMsg ?? `MiniMax status ${base.statusCode}`)
				: null,
	};
}

function withTimeout(
	requestSignal: AbortSignal | undefined,
	timeoutMs: number,
): { signal: AbortSignal; clear: () => void; timedOut: () => boolean } {
	const controller = new AbortController();
	let timeout = false;
	const timer = setTimeout(() => {
		timeout = true;
		controller.abort();
	}, timeoutMs);
	const onClientAbort = () => controller.abort();
	requestSignal?.addEventListener('abort', onClientAbort, { once: true });
	return {
		signal: controller.signal,
		clear: () => {
			clearTimeout(timer);
			requestSignal?.removeEventListener('abort', onClientAbort);
		},
		timedOut: () => timeout,
	};
}

async function postMiniMax(
	route: RouteResult,
	capability: 'audio.speech' | 'images.generations',
	body: Record<string, unknown>,
	requestSignal: AbortSignal | undefined,
	timing: RequestTimingCollector | null | undefined,
	attempt: RequestTimingAttempt | undefined,
	options: MiniMaxOpenAiDispatchOptions | undefined,
): Promise<{ response: Response; upstreamRequestId: string | null; clear: () => void; timedOut: () => boolean }> {
	const fetchImpl: FetchLike = options?.fetchImpl ?? fetch;
	const timeout = withTimeout(requestSignal, options?.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
	const url = resolveUpstreamEndpoint('minimax', capability, route.providerEndpoints, {
		providerId: route.providerId,
	});
	try {
		const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: applyRouteExtraHeaders(
				{
					Authorization: `Bearer ${secret}`,
					'Content-Type': 'application/json',
				},
				route.customParams,
			),
			body: JSON.stringify(body),
			signal: timeout.signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		return {
			response,
			upstreamRequestId: extractUpstreamRequestId(response.headers),
			clear: timeout.clear,
			timedOut: timeout.timedOut,
		};
	} catch (error) {
		timeout.clear();
		if (timeout.timedOut()) {
			throw new MiniMaxUpstreamTimeout();
		}
		throw error;
	}
}

class MiniMaxUpstreamTimeout extends Error {
	constructor() {
		super('MiniMax upstream timed out');
		this.name = 'MiniMaxUpstreamTimeout';
	}
}

function applySpeechUsage(usage: UsageFromStream, event: SpeechEvent): void {
	if (event.characters != null) usage.audio_characters = event.characters;
	if (event.traceId) usage.upstreamBodyRequestId = event.traceId;
}

function speechStreamResponse(options: {
	reader: ReadableStreamDefaultReader<Uint8Array>;
	parser: SpeechSseParser;
	initial: unknown[];
	timing?: RequestTimingCollector | null;
}): { response: Response; usagePromise: Promise<UsageFromStream>; upstreamRequestId: string | null } {
	const usage: UsageFromStream = { ...EMPTY_USAGE };
	let resolveUsage!: (value: UsageFromStream) => void;
	const usagePromise = new Promise<UsageFromStream>((resolve) => {
		resolveUsage = resolve;
	});
	let settled = false;
	let traceId: string | null = null;
	let emitted = false;
	const pending = [...options.initial];
	const finish = (cancelled = false, streamError?: unknown) => {
		if (settled) return;
		settled = true;
		if (cancelled) usage.cancelled = true;
		if (streamError != null && !cancelled) {
			usage.stream_error = streamError instanceof Error ? streamError.message : String(streamError);
		}
		options.timing?.markStreamComplete();
		resolveUsage({ ...usage });
	};
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				while (true) {
					if (pending.length === 0) {
						const next = await options.reader.read();
						pending.push(...options.parser.push(next.value ?? new Uint8Array(), next.done));
						if (next.done && pending.length === 0) {
							throw new Error('MiniMax speech SSE ended before a terminal event');
						}
					}
					const raw = pending.shift();
					if (raw === undefined) continue;
					const event = parseMiniMaxOpenAiSpeechEvent(raw);
					traceId ??= event.traceId;
					if (event.error) throw new Error(event.error);
					applySpeechUsage(usage, event);
					if (event.hex) {
						emitted = true;
						options.timing?.markFirstByte();
						const audio = bytesToBase64(decodeMiniMaxHexAudio(event.hex));
						controller.enqueue(sseFrame({ type: 'speech.audio.delta', audio }));
					}
					if (event.terminal) {
						if (!emitted) throw new Error('MiniMax speech completed without audio data');
						controller.enqueue(
							sseFrame({
								type: 'speech.audio.done',
								usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
							}),
						);
						controller.close();
						finish(false);
						void options.reader.cancel();
						return;
					}
					if (event.hex) return;
				}
			} catch (error) {
				finish(false, error);
				controller.error(error);
			}
		},
		async cancel() {
			finish(true);
			await options.reader.cancel();
		},
	});
	return {
		response: new Response(body, {
			status: 200,
			headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
		}),
		usagePromise,
		upstreamRequestId: traceId,
	};
}

export async function dispatchMiniMaxOpenAiSpeech(
	route: RouteResult,
	request: NormalizedAudioSpeechRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: MiniMaxOpenAiDispatchOptions,
): Promise<{
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	meta?: { restoredUpstreamPaths?: string[] };
}> {
	let upstreamBody: Record<string, unknown>;
	let restoredUpstreamPaths: string[] = [];
	try {
		const built = buildMiniMaxT2aBodyFromOpenAi({
			model: route.providerModelName,
			text: request.input,
			voiceId: voiceId(request.voice),
			responseFormat: request.responseFormat,
			speed: request.speed,
			stream: request.streamFormat === 'sse',
			instructions: request.instructions,
		});
		const applied = applyUpstreamExtraFields({
			built,
			customParams: route.customParams,
			extras: request.extraFields,
			protectedPaths: protectedUpstreamPathsForRoute(route),
		});
		upstreamBody = fillMiniMaxSpeechDefaults(applied.body);
		upstreamBody.model = route.providerModelName;
		restoredUpstreamPaths = applied.restoredPaths;
	} catch (error) {
		if (error instanceof MiniMaxOpenAiClientError) return errorResult(400, error.message);
		if (error instanceof Error && error.name === 'UpstreamExtraFieldsError') {
			return errorResult(400, error.message);
		}
		throw error;
	}

	let posted: Awaited<ReturnType<typeof postMiniMax>>;
	try {
		posted = await postMiniMax(route, 'audio.speech', upstreamBody, requestSignal, timing, attempt, options);
	} catch (error) {
		if (error instanceof MiniMaxUpstreamTimeout) {
			return errorResult(504, `MiniMax speech timed out after ${options?.timeoutMs ?? UPSTREAM_TIMEOUT_MS}ms`);
		}
		throw error;
	}

	const contentType = posted.response.headers.get('content-type') ?? '';
	const streaming =
		request.streamFormat === 'sse' &&
		posted.response.ok &&
		posted.response.body != null &&
		contentType.toLowerCase().includes('text/event-stream');
	if (streaming && posted.response.body) {
		posted.clear();
		const reader = posted.response.body.getReader();
		const parser = new SpeechSseParser();
		const initial: unknown[] = [];
		while (initial.length === 0) {
			const next = await reader.read();
			initial.push(...parser.push(next.value ?? new Uint8Array(), next.done));
			if (next.done) break;
		}
		const first = initial[0] == null ? null : parseMiniMaxOpenAiSpeechEvent(initial[0]);
		if (!first) {
			await reader.cancel();
			return errorResult(502, 'MiniMax speech returned no SSE event');
		}
		if (first.error) {
			await reader.cancel();
			const base = readMiniMaxBaseResp(initial[0]);
			const status = base ? miniMaxBaseRespHttpStatus(base.statusCode) : 502;
			const failed = errorResult(status, first.error, base ? String(base.statusCode) : undefined);
			return { ...failed, upstreamRequestId: first.traceId ?? posted.upstreamRequestId };
		}
		const streamed = speechStreamResponse({ reader, parser, initial, timing });
		return {
			...streamed,
			upstreamRequestId: streamed.upstreamRequestId ?? first.traceId ?? posted.upstreamRequestId,
			meta: { restoredUpstreamPaths },
		};
	}

	try {
		const text = await posted.response.text();
		timing?.markStreamComplete();
		let parsed: unknown = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = null;
		}
		const traceId = typeof asObject(parsed)?.trace_id === 'string' ? String(asObject(parsed)?.trace_id) : null;
		const upstreamRequestId = posted.upstreamRequestId ?? traceId;
		if (!posted.response.ok) {
			return { response: new Response(text, { status: posted.response.status, headers: { 'Content-Type': contentType || 'application/json' } }), usagePromise: Promise.resolve(EMPTY_USAGE), upstreamRequestId };
		}
		const base = readMiniMaxBaseResp(parsed);
		if (base && base.statusCode !== 0) {
			const failed = errorResult(
				miniMaxBaseRespHttpStatus(base.statusCode),
				base.statusMsg ?? `MiniMax status ${base.statusCode}`,
				String(base.statusCode),
			);
			return { ...failed, upstreamRequestId };
		}
		const event = parseMiniMaxOpenAiSpeechEvent(parsed);
		if (!event.hex) return { ...errorResult(502, 'MiniMax speech response has no audio'), upstreamRequestId };
		let bytes: Uint8Array;
		try {
			bytes = decodeMiniMaxHexAudio(event.hex);
		} catch (error) {
			return {
				...errorResult(502, error instanceof Error ? error.message : 'MiniMax returned invalid hex audio data'),
				upstreamRequestId,
			};
		}
		const usage: UsageFromStream = { ...EMPTY_USAGE };
		applySpeechUsage(usage, event);
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		return {
			response: new Response(copy, {
				status: 200,
				headers: { 'Content-Type': SPEECH_CONTENT_TYPES[request.responseFormat] ?? 'audio/mpeg' },
			}),
			usagePromise: Promise.resolve(usage),
			upstreamRequestId,
			meta: { restoredUpstreamPaths },
		};
	} finally {
		posted.clear();
	}
}

export async function dispatchMiniMaxOpenAiImage(
	route: RouteResult,
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: MiniMaxOpenAiDispatchOptions,
): Promise<{
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	meta: {
		imageUsage: null;
		parsedBody: unknown;
		imageBillingSize: null;
		imageAbortReason?: ImageDispatchAbortReason;
		restoredUpstreamPaths?: string[];
	};
}> {
	const fail = (status: number, message: string, code?: string, abort?: ImageDispatchAbortReason) => {
		const result = errorResult(status, message, code);
		return {
			...result,
			meta: {
				imageUsage: null as null,
				parsedBody: null,
				imageBillingSize: null as null,
				...(abort ? { imageAbortReason: abort } : {}),
			},
		};
	};
	let upstreamBody: Record<string, unknown>;
	let restoredUpstreamPaths: string[] = [];
	try {
		const detached = detachUpstreamExtraFields(body);
		const built = buildMiniMaxImageBodyFromOpenAi(route.providerModelName, detached.body);
		const applied: ApplyUpstreamExtraFieldsResult = applyUpstreamExtraFields({
			built,
			customParams: route.customParams,
			extras: detached.extras,
			protectedPaths: protectedUpstreamPathsForRoute(route),
		});
		upstreamBody = applied.body;
		upstreamBody.model = route.providerModelName;
		restoredUpstreamPaths = applied.restoredPaths;
	} catch (error) {
		if (error instanceof MiniMaxOpenAiClientError) return fail(400, error.message);
		if (error instanceof Error && error.name === 'UpstreamExtraFieldsError') return fail(400, error.message);
		throw error;
	}
	const responseFormat = upstreamBody.response_format === 'base64' ? 'b64_json' : 'url';

	let posted: Awaited<ReturnType<typeof postMiniMax>>;
	try {
		posted = await postMiniMax(
			route,
			'images.generations',
			upstreamBody,
			requestSignal,
			timing,
			attempt,
			options,
		);
	} catch (error) {
		if (error instanceof MiniMaxUpstreamTimeout) {
			return fail(
				504,
				`MiniMax image generation timed out after ${options?.timeoutMs ?? UPSTREAM_TIMEOUT_MS}ms`,
				undefined,
				'gateway_timeout',
			);
		}
		if (requestSignal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
			return fail(504, 'Image generation was cancelled by the client', undefined, 'client_abort');
		}
		throw error;
	}

	try {
		const text = await posted.response.text();
		timing?.markStreamComplete();
		let parsed: unknown = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = null;
		}
		const traceId = typeof asObject(parsed)?.trace_id === 'string' ? String(asObject(parsed)?.trace_id) : null;
		const upstreamRequestId = posted.upstreamRequestId ?? traceId;
		if (!posted.response.ok) {
			const message =
				readMiniMaxBaseResp(parsed)?.statusMsg ??
				(typeof asObject(asObject(parsed)?.error)?.message === 'string'
					? String(asObject(asObject(parsed)?.error)?.message)
					: `HTTP ${posted.response.status}`);
			const failed = fail(posted.response.status, message);
			return { ...failed, upstreamRequestId };
		}
		const base = readMiniMaxBaseResp(parsed);
		if (base && base.statusCode !== 0) {
			const failed = fail(
				miniMaxBaseRespHttpStatus(base.statusCode),
				base.statusMsg ?? `MiniMax status ${base.statusCode}`,
				String(base.statusCode),
			);
			return { ...failed, upstreamRequestId };
		}
		const clientBody = miniMaxImageResponseToOpenAi(parsed, responseFormat);
		if (countValidImageResults(clientBody) === 0) {
			const failed = fail(502, 'MiniMax image generation returned no image');
			return { ...failed, upstreamRequestId };
		}
		return {
			response: new Response(JSON.stringify(clientBody), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId,
			meta: {
				imageUsage: null,
				parsedBody: clientBody,
				imageBillingSize: null,
				restoredUpstreamPaths,
			},
		};
	} finally {
		posted.clear();
	}
}
