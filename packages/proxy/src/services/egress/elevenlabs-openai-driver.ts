/**
 * OpenAI 入口 → ElevenLabs 官方端点。
 * `elevenlabs-tts`：`POST /v1/audio/speech` → `POST {base}/text-to-speech/{voice_id}[/stream]`。
 *   `stream_format=sse` 走上游 `/stream`，把音频块重新封装成 OpenAI speech SSE。
 * `elevenlabs-asr-file`：`POST /v1/audio/transcriptions` → `POST {base}/speech-to-text`，
 *   固定请求词级时间戳，网关本地生成 segments、srt / vtt 和 diarized_json。
 * TTS 计费字符先看上游 `x-character-count`，缺失时用输入文本长度。
 */
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret, resolveUpstreamEndpoint } from '@octafuse/core';
import {
	ELEVENLABS_ASR_DROPPED_FORM_KEYS,
	ElevenLabsOpenAiClientError,
	assertElevenLabsAsrNotWebhook,
	buildElevenLabsTtsRequestFromOpenAi,
	elevenLabsTranscriptToClient,
	resolveElevenLabsAsrMapping,
	splitElevenLabsTtsQuery,
} from '@octafuse/core/elevenlabs-openai';
import { readElevenLabsCharacterCount } from '@octafuse/core/elevenlabs-native';
import {
	applyUpstreamExtraFields,
	formExtraFieldText,
	protectedUpstreamPathsForRoute,
} from '@octafuse/core/upstream-extra-fields';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import type { ProxyDispatchResult } from '../failover-dispatch';
import { buildRouteRequestBody } from '../route-default-params';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import type { AudioSpeechDispatchOptions, NormalizedAudioSpeechRequest } from './audio-speech-driver';
import {
	AUDIO_TRANSCRIPTION_TIMEOUT_MS,
	buildAudioTranscriptionClientResponse,
	validateAudioUpload,
	withTimeoutSignal,
	type NormalizedAudioTranscriptionRequest,
} from './openai-audio-driver';
import {
	ELEVENLABS_JSON_TIMEOUT_MS,
	buildElevenLabsSttForm,
	elevenLabsJsonError,
	elevenLabsTrackedStream,
	elevenLabsTransportError,
	elevenLabsUpstreamErrorResult,
	resolveElevenLabsSttBilling,
	resolveElevenLabsTtsUrl,
	type FetchLike,
} from './elevenlabs-passthrough';
import { extractUpstreamRequestId } from './upstream-request-id';

export type ElevenLabsOpenAiDispatchOptions = AudioSpeechDispatchOptions & {
	timeoutMs?: number;
};

function voiceId(voice: NormalizedAudioSpeechRequest['voice']): string {
	return typeof voice === 'string' ? voice : voice.id;
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

/** 上游 `/stream` 的音频块 → OpenAI speech SSE（`speech.audio.delta` + `speech.audio.done`）。 */
function speechSseResponse(
	response: Response,
	options: {
		characters: number;
		upstreamRequestId: string | null;
		timing?: RequestTimingCollector | null;
	},
): ProxyDispatchResult {
	let resolveUsage: (usage: UsageFromStream) => void = () => undefined;
	const usagePromise = new Promise<UsageFromStream>((resolve) => {
		resolveUsage = resolve;
	});
	const source = response.body;
	if (!source) {
		options.timing?.markStreamComplete();
		resolveUsage(EMPTY_USAGE);
		return {
			...elevenLabsJsonError(502, 'ElevenLabs speech stream returned no body'),
			upstreamRequestId: options.upstreamRequestId,
		};
	}
	const reader = source.getReader();
	let settled = false;
	let emitted = false;
	const finish = (extra: Partial<UsageFromStream> = {}) => {
		if (settled) return;
		settled = true;
		options.timing?.markStreamComplete();
		const failed = extra.cancelled || extra.stream_error;
		resolveUsage({
			...EMPTY_USAGE,
			audio_characters: failed ? undefined : options.characters,
			...extra,
		});
	};
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				while (true) {
					const next = await reader.read();
					if (next.done) {
						if (!emitted) throw new Error('ElevenLabs speech completed without audio data');
						controller.enqueue(
							sseFrame({
								type: 'speech.audio.done',
								usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
							}),
						);
						controller.close();
						finish();
						return;
					}
					if (!next.value || next.value.byteLength === 0) continue;
					if (!emitted) options.timing?.markFirstByte();
					emitted = true;
					controller.enqueue(sseFrame({ type: 'speech.audio.delta', audio: bytesToBase64(next.value) }));
					return;
				}
			} catch (error) {
				finish({ stream_error: error instanceof Error ? error.message : String(error) });
				controller.error(error);
			}
		},
		cancel(reason) {
			finish({ cancelled: true });
			return reader.cancel(reason);
		},
	});
	return {
		response: new Response(body, {
			status: 200,
			headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
		}),
		usagePromise,
		upstreamRequestId: options.upstreamRequestId,
		meta: { audioCharacters: options.characters },
	};
}

export async function dispatchElevenLabsOpenAiSpeech(
	route: RouteResult,
	request: NormalizedAudioSpeechRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: ElevenLabsOpenAiDispatchOptions,
): Promise<ProxyDispatchResult> {
	const sse = request.streamFormat === 'sse';
	let built: ReturnType<typeof buildElevenLabsTtsRequestFromOpenAi>;
	let upstreamBody: Record<string, unknown>;
	let query: Record<string, string>;
	let restoredUpstreamPaths: string[] = [];
	try {
		built = buildElevenLabsTtsRequestFromOpenAi({
			model: route.providerModelName,
			text: request.input,
			voiceId: voiceId(request.voice),
			responseFormat: request.responseFormat,
			speed: request.speed,
			stream: sse,
			instructions: request.instructions,
		});
		const applied = applyUpstreamExtraFields({
			built: built.body,
			customParams: route.customParams,
			extras: request.extraFields,
			protectedPaths: protectedUpstreamPathsForRoute(route),
		});
		const split = splitElevenLabsTtsQuery(applied.body);
		upstreamBody = { ...split.body, model_id: route.providerModelName };
		query = { ...split.query, ...built.query };
		restoredUpstreamPaths = applied.restoredPaths;
	} catch (error) {
		if (error instanceof ElevenLabsOpenAiClientError) return elevenLabsJsonError(400, error.message);
		if (error instanceof Error && error.name === 'UpstreamExtraFieldsError') {
			return elevenLabsJsonError(400, error.message);
		}
		throw error;
	}

	const fetchImpl: FetchLike = options?.fetchImpl ?? fetch;
	const timeoutMs = options?.timeoutMs ?? ELEVENLABS_JSON_TIMEOUT_MS;
	const timeoutController = new AbortController();
	const state = { timedOut: false, clientAborted: false };
	const timer = setTimeout(() => {
		state.timedOut = true;
		timeoutController.abort();
	}, timeoutMs);
	const onClientAbort = () => {
		state.clientAborted = true;
		timeoutController.abort();
	};
	requestSignal?.addEventListener('abort', onClientAbort, { once: true });
	try {
		const url = resolveElevenLabsTtsUrl(route, built.voiceId, built.pathSuffix, query);
		const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: applyRouteExtraHeaders(
				{ 'xi-api-key': secret, 'Content-Type': 'application/json' },
				route.customParams,
			),
			body: JSON.stringify(upstreamBody),
			signal: timeoutController.signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const upstreamRequestId = extractUpstreamRequestId(response.headers);
		if (!response.ok) return await elevenLabsUpstreamErrorResult(response, upstreamRequestId, timing);
		const characters =
			readElevenLabsCharacterCount(response.headers) ?? Array.from(request.input).length;
		const result = sse
			? speechSseResponse(response, { characters, upstreamRequestId, timing })
			: elevenLabsTrackedStream(response, {
					characters,
					upstreamRequestId,
					timing,
					headers: new Headers({ 'Content-Type': built.contentType }),
				});
		return { ...result, meta: { ...result.meta, restoredUpstreamPaths } };
	} catch (error) {
		timing?.markStreamComplete();
		return elevenLabsTransportError(error, state, 'ElevenLabs speech');
	} finally {
		clearTimeout(timer);
		requestSignal?.removeEventListener('abort', onClientAbort);
	}
}

/** 这些键由网关固定或转换，不从额外表单字段原样转发。 */
const ASR_FORM_SKIP_KEYS = new Set<string>([
	'model_id',
	'file',
	'duration_seconds',
	'webhook',
	'timestamps_granularity',
	'language_code',
	...ELEVENLABS_ASR_DROPPED_FORM_KEYS,
]);

export async function dispatchElevenLabsAudioTranscriptions(
	route: RouteResult,
	req: NormalizedAudioTranscriptionRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: ElevenLabsOpenAiDispatchOptions,
): Promise<ProxyDispatchResult> {
	const file = req.file;
	if (!file) {
		throw new Error('Audio transcription requires a multipart file for this route');
	}
	const uploadError = validateAudioUpload(file);
	if (uploadError) {
		throw new Error(uploadError);
	}
	const mapped = resolveElevenLabsAsrMapping(req.clientResponseFormat);
	const merged = buildRouteRequestBody(route, { ...(req.extra ?? {}) });
	try {
		assertElevenLabsAsrNotWebhook(merged.webhook);
	} catch (error) {
		if (error instanceof ElevenLabsOpenAiClientError) return elevenLabsJsonError(400, error.message);
		throw error;
	}
	const languageFromRoute =
		typeof merged.language_code === 'string'
			? merged.language_code
			: typeof merged.language === 'string'
				? merged.language
				: undefined;
	const language = (req.language ?? languageFromRoute)?.trim();
	const fields: Array<[string, string]> = [];
	for (const [key, value] of Object.entries(merged)) {
		if (value == null || ASR_FORM_SKIP_KEYS.has(key)) continue;
		const text = formExtraFieldText(value);
		if (text != null) fields.push([key, text]);
	}
	const forced: Record<string, string> = { timestamps_granularity: mapped.timestampsGranularity };
	if (language) forced.language_code = language;
	if (mapped.diarize) forced.diarize = 'true';

	const url = resolveUpstreamEndpoint('elevenlabs', 'audio.transcriptions', route.providerEndpoints, {
		providerId: route.providerId,
	});
	const fetchImpl: FetchLike = options?.fetchImpl ?? fetch;
	const form = buildElevenLabsSttForm(route.providerModelName, file, fields, forced);
	const { signal, clear, getAbortReason } = withTimeoutSignal(
		requestSignal,
		options?.timeoutMs ?? AUDIO_TRANSCRIPTION_TIMEOUT_MS,
	);
	try {
		const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: applyRouteExtraHeaders({ 'xi-api-key': secret }, route.customParams),
			body: form,
			signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const upstreamRequestId = extractUpstreamRequestId(response.headers);
		if (!response.ok) return await elevenLabsUpstreamErrorResult(response, upstreamRequestId, timing);
		const text = await response.text();
		timing?.markStreamComplete();
		let upstreamBody: unknown = null;
		try {
			upstreamBody = text ? JSON.parse(text) : null;
		} catch {
			return { ...elevenLabsJsonError(502, 'ElevenLabs transcription returned invalid JSON'), upstreamRequestId };
		}
		const resolved = resolveElevenLabsSttBilling(upstreamBody, file, req.clientDurationSeconds);
		return {
			response: buildAudioTranscriptionClientResponse(
				req.clientResponseFormat,
				elevenLabsTranscriptToClient(upstreamBody, mapped.clientShape),
				response.status,
				response.statusText,
			),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId,
			meta: {
				parsedBody: upstreamBody,
				audioDurationSeconds: resolved.seconds,
				audioDurationSource: resolved.source,
				audioFileBytes: file.bytes.byteLength,
				audioTokenUsage: null,
			},
		};
	} catch (error) {
		timing?.markStreamComplete();
		const reason = getAbortReason();
		return elevenLabsTransportError(
			error,
			{
				timedOut: reason === 'gateway_timeout',
				clientAborted: reason === 'client_abort' || requestSignal?.aborted === true,
			},
			'ElevenLabs transcription',
		);
	} finally {
		clear();
	}
}
