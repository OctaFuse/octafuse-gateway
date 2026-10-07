/**
 * MiniMax 文件转写。
 * `minimax-asr-file`：OpenAI `POST /v1/audio/transcriptions` → `POST {minimax.base}/speech_to_text`，并改写 srt/vtt。
 * passthrough：公开 `POST /v1/minimax/speech_to_text` 原样转发，只替换 model，响应不改写。
 * language 放请求头。
 */
import {
	applyRouteExtraHeaders,
	resolveProviderUpstreamSecret,
	resolveUpstreamEndpoint,
} from '@octafuse/core';
import {
	buildMiniMaxAsrHeaders,
	MINIMAX_ASR_DROPPED_FORM_KEYS,
	readMiniMaxAsrSegments,
	renderSegmentsAsSrt,
	renderSegmentsAsVtt,
	resolveMiniMaxAsrUpstreamFormat,
	type MiniMaxAsrClientShape,
	type MiniMaxAsrSegment,
} from '@octafuse/core/minimax-asr';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { resolveAudioBillingDuration } from './audio-duration';
import { extractUpstreamRequestId } from './upstream-request-id';
import {
	AUDIO_TRANSCRIPTION_TIMEOUT_MS,
	buildAudioTranscriptionClientResponse,
	extractTranscriptionText,
	parseAudioDurationFromUpstreamBody,
	resolveAudioUploadFilename,
	validateAudioUpload,
	withTimeoutSignal,
	type NormalizedAudioTranscriptionRequest,
} from './openai-audio-driver';

const FORM_SKIP_KEYS = new Set<string>([
	'model',
	'file',
	'response_format',
	'duration_seconds',
	...MINIMAX_ASR_DROPPED_FORM_KEYS,
]);

function subtitleCues(body: unknown): MiniMaxAsrSegment[] {
	const segments = readMiniMaxAsrSegments(body);
	if (segments.length > 0) return segments;
	const text = extractTranscriptionText(body).trim();
	if (!text) return [];
	const duration = parseAudioDurationFromUpstreamBody(body) ?? 0;
	return [{ start: 0, end: duration, text }];
}

function clientBodyForShape(body: unknown, shape: MiniMaxAsrClientShape): unknown {
	if (shape === 'verbose_json') return body;
	const text = extractTranscriptionText(body);
	if (shape === 'text') return text;
	if (shape === 'json') return { text };
	const cues = subtitleCues(body);
	return shape === 'srt' ? renderSegmentsAsSrt(cues) : renderSegmentsAsVtt(cues);
}

export async function dispatchMiniMaxAudioTranscriptions(
	route: RouteResult,
	req: NormalizedAudioTranscriptionRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
): Promise<{
	response: Response;
	usagePromise: Promise<typeof EMPTY_USAGE>;
	upstreamRequestId: string | null;
	meta: {
		parsedBody: unknown;
		audioDurationSeconds: number | null;
		audioDurationSource: ReturnType<typeof resolveAudioBillingDuration>['source'] | null;
		audioFileBytes: number;
		audioTokenUsage: null;
	};
}> {
	const file = req.file;
	if (!file) {
		throw new Error('Audio transcription requires a multipart file for this route');
	}
	const uploadError = validateAudioUpload(file);
	if (uploadError) {
		throw new Error(uploadError);
	}
	const url = resolveUpstreamEndpoint('minimax', 'audio.transcriptions', route.providerEndpoints, {
		providerId: route.providerId,
	});
	const mapped = resolveMiniMaxAsrUpstreamFormat(req.clientResponseFormat);
	const mergedExtras = buildRouteRequestBody(route, { ...(req.extra ?? {}) });
	const languageFromRoute =
		typeof mergedExtras.language === 'string' ? mergedExtras.language : undefined;

	const form = new FormData();
	form.append('model', route.providerModelName);
	form.append('response_format', mapped.upstreamFormat);
	for (const [key, value] of Object.entries(mergedExtras)) {
		if (value == null || FORM_SKIP_KEYS.has(key)) continue;
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			form.append(key, String(value));
		}
	}
	const blob = new Blob([new Uint8Array(file.bytes)], {
		type: file.mimeType || 'application/octet-stream',
	});
	form.append('file', blob, resolveAudioUploadFilename(file.filename || '', file.mimeType || ''));

	const startedAt = Date.now();
	const { signal, clear, getAbortReason } = withTimeoutSignal(
		requestSignal,
		AUDIO_TRANSCRIPTION_TIMEOUT_MS
	);
	try {
		const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
		const response = await fetch(url, {
			method: 'POST',
			headers: applyRouteExtraHeaders(
				{
					Authorization: `Bearer ${secret}`,
					...buildMiniMaxAsrHeaders({ language: req.language ?? languageFromRoute }),
				},
				route.customParams
			),
			body: form,
			signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const upstreamRequestId = extractUpstreamRequestId(response.headers);
		const text = await response.text();
		timing?.markStreamComplete();
		let upstreamBody: unknown = null;
		try {
			upstreamBody = text ? JSON.parse(text) : null;
		} catch {
			upstreamBody = { error: { message: text.slice(0, 500) || 'Invalid upstream JSON' } };
		}

		let audioDurationSeconds: number | null = null;
		let audioDurationSource: ReturnType<typeof resolveAudioBillingDuration>['source'] | null = null;
		if (response.ok) {
			const resolved = resolveAudioBillingDuration({
				upstreamSeconds: parseAudioDurationFromUpstreamBody(upstreamBody),
				fileBytes: file.bytes.byteLength,
				mimeType: file.mimeType,
				fileBytesForParse: file.bytes,
				clientSeconds: req.clientDurationSeconds,
			});
			audioDurationSeconds = resolved.seconds;
			audioDurationSource = resolved.source;
		}

		const clientResponse = response.ok
			? buildAudioTranscriptionClientResponse(
					req.clientResponseFormat,
					clientBodyForShape(upstreamBody, mapped.clientShape),
					response.status,
					response.statusText
				)
			: new Response(text || JSON.stringify(upstreamBody), {
					status: response.status,
					statusText: response.statusText,
					headers: {
						'Content-Type': response.headers.get('content-type') || 'application/json',
					},
				});

		return {
			response: clientResponse,
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId,
			meta: {
				parsedBody: upstreamBody,
				audioDurationSeconds,
				audioDurationSource,
				audioFileBytes: file.bytes.byteLength,
				audioTokenUsage: null,
			},
		};
	} catch (err) {
		timing?.markStreamComplete();
		const abortReason = getAbortReason();
		const aborted =
			abortReason !== 'none' ||
			requestSignal?.aborted ||
			(err instanceof Error && err.name === 'AbortError');
		const resolvedAbort =
			abortReason === 'none' && requestSignal?.aborted ? 'client_abort' : abortReason;
		const message = aborted
			? resolvedAbort === 'gateway_timeout'
				? `Audio transcription timed out waiting for upstream after ${AUDIO_TRANSCRIPTION_TIMEOUT_MS}ms`
				: 'Audio transcription was cancelled by the client'
			: 'Audio transcription upstream failed';
		const errorBody = {
			error: {
				message,
				upstream_url: url,
				detail: aborted ? undefined : err instanceof Error ? err.message : String(err),
			},
		};
		return {
			response: new Response(JSON.stringify(errorBody), {
				status: aborted && resolvedAbort === 'gateway_timeout' ? 504 : aborted ? 499 : 502,
				headers: { 'Content-Type': 'application/json' },
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			meta: {
				parsedBody: errorBody,
				audioDurationSeconds: null,
				audioDurationSource: null,
				audioFileBytes: file.bytes.byteLength,
				audioTokenUsage: null,
			},
		};
	} finally {
		clear();
	}
}

export type MiniMaxAsrPassthroughRequest = {
	file: {
		filename: string;
		mimeType: string;
		bytes: Uint8Array;
	};
	/** 除 model / file 以外的文本字段。`language` 会提升到请求头，不进表单。 */
	fields: Record<string, string>;
	languageHeader?: string;
};

const PASSTHROUGH_FORM_SKIP_KEYS = new Set<string>(['model', 'file', 'language']);

/** 原生 MiniMax ASR 透传：替换 model，其余表单字段与响应体保持原样。 */
export async function dispatchMiniMaxAsrPassthrough(
	route: RouteResult,
	req: MiniMaxAsrPassthroughRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
): Promise<{
	response: Response;
	usagePromise: Promise<typeof EMPTY_USAGE>;
	upstreamRequestId: string | null;
	meta: {
		parsedBody: unknown;
		audioDurationSeconds: number | null;
		audioDurationSource: ReturnType<typeof resolveAudioBillingDuration>['source'] | null;
		audioFileBytes: number;
		audioTokenUsage: null;
	};
}> {
	if (
		route.adapter !== 'passthrough' ||
		route.upstreamProtocol !== 'minimax' ||
		route.upstreamOperation !== 'audio.transcriptions'
	) {
		throw new Error(`Unsupported MiniMax ASR passthrough adapter: ${route.adapter}`);
	}
	const file = req.file;
	const uploadError = validateAudioUpload(file);
	if (uploadError) {
		throw new Error(uploadError);
	}
	const url = resolveUpstreamEndpoint('minimax', 'audio.transcriptions', route.providerEndpoints, {
		providerId: route.providerId,
	});
	const merged = buildRouteRequestBody(route, { ...req.fields });
	const languageFromBody = typeof merged.language === 'string' ? merged.language : undefined;
	const language = req.languageHeader?.trim() || languageFromBody;

	const form = new FormData();
	form.append('model', route.providerModelName);
	for (const [key, value] of Object.entries(merged)) {
		if (value == null || PASSTHROUGH_FORM_SKIP_KEYS.has(key)) continue;
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			const text = String(value).trim();
			if (text === '') continue;
			form.append(key, text);
		}
	}
	const blob = new Blob([new Uint8Array(file.bytes)], {
		type: file.mimeType || 'application/octet-stream',
	});
	form.append('file', blob, resolveAudioUploadFilename(file.filename || '', file.mimeType || ''));

	const { signal, clear, getAbortReason } = withTimeoutSignal(
		requestSignal,
		AUDIO_TRANSCRIPTION_TIMEOUT_MS
	);
	try {
		const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
		const response = await fetch(url, {
			method: 'POST',
			headers: applyRouteExtraHeaders(
				{
					Authorization: `Bearer ${secret}`,
					...buildMiniMaxAsrHeaders({ language }),
				},
				route.customParams
			),
			body: form,
			signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const upstreamRequestId = extractUpstreamRequestId(response.headers);
		const text = await response.text();
		timing?.markStreamComplete();
		let upstreamBody: unknown = text;
		try {
			upstreamBody = text ? JSON.parse(text) : null;
		} catch {
			upstreamBody = text;
		}

		let audioDurationSeconds: number | null = null;
		let audioDurationSource: ReturnType<typeof resolveAudioBillingDuration>['source'] | null = null;
		if (response.ok) {
			const resolved = resolveAudioBillingDuration({
				upstreamSeconds: parseAudioDurationFromUpstreamBody(upstreamBody),
				fileBytes: file.bytes.byteLength,
				mimeType: file.mimeType,
				fileBytesForParse: file.bytes,
			});
			audioDurationSeconds = resolved.seconds;
			audioDurationSource = resolved.source;
		}

		return {
			response: new Response(text, {
				status: response.status,
				statusText: response.statusText,
				headers: {
					'Content-Type': response.headers.get('content-type') || 'application/json',
				},
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId,
			meta: {
				parsedBody: upstreamBody,
				audioDurationSeconds,
				audioDurationSource,
				audioFileBytes: file.bytes.byteLength,
				audioTokenUsage: null,
			},
		};
	} catch (err) {
		timing?.markStreamComplete();
		const abortReason = getAbortReason();
		const aborted =
			abortReason !== 'none' ||
			requestSignal?.aborted ||
			(err instanceof Error && err.name === 'AbortError');
		const resolvedAbort =
			abortReason === 'none' && requestSignal?.aborted ? 'client_abort' : abortReason;
		const message = aborted
			? resolvedAbort === 'gateway_timeout'
				? `Audio transcription timed out waiting for upstream after ${AUDIO_TRANSCRIPTION_TIMEOUT_MS}ms`
				: 'Audio transcription was cancelled by the client'
			: 'Audio transcription upstream failed';
		const errorBody = {
			error: {
				message,
				upstream_url: url,
				detail: aborted ? undefined : err instanceof Error ? err.message : String(err),
			},
		};
		return {
			response: new Response(JSON.stringify(errorBody), {
				status: aborted && resolvedAbort === 'gateway_timeout' ? 504 : aborted ? 499 : 502,
				headers: { 'Content-Type': 'application/json' },
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			meta: {
				parsedBody: errorBody,
				audioDurationSeconds: null,
				audioDurationSource: null,
				audioFileBytes: file.bytes.byteLength,
				audioTokenUsage: null,
			},
		};
	} finally {
		clear();
	}
}
