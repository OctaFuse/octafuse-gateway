/**
 * OpenAI 兼容 Audio Transcriptions 上游驱动：`POST …/audio/transcriptions`（multipart）。
 * - whisper：上游强制 `verbose_json` 取 duration（per_second 计费）
 * - gpt-4o-*transcribe：上游用 `json` 取 `usage.type=tokens`（token 计费；客户端 text 仍裁剪回包）
 * 日志禁止写入音频二进制。
 */
import {
	applyRouteExtraHeaders,
	parseOpenAiAudioTokenUsage,
	resolveProviderUpstreamSecret,
	resolveUpstreamEndpoint,
	type AudioTokenUsage,
} from '@octafuse/core';
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import { EMPTY_USAGE } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';
import { extractUpstreamRequestId } from './upstream-request-id';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import {
	resolveAudioBillingDuration,
	type AudioDurationSource,
} from './audio-duration';

export const AUDIO_TRANSCRIPTION_TIMEOUT_MS = 120_000;
/** OpenAI Whisper 官方上限 25MB；Gateway 略收紧以保护 Worker 内存 */
export const AUDIO_MAX_BYTES_PER_FILE = 25 * 1024 * 1024;
export const AUDIO_ALLOWED_MIME = new Set([
	'audio/mpeg',
	'audio/mp3',
	'audio/mp4',
	'audio/m4a',
	'audio/wav',
	'audio/wave',
	'audio/x-wav',
	'audio/webm',
	'audio/ogg',
	'audio/flac',
	'application/octet-stream',
]);

export type AudioUpload = {
	filename: string;
	mimeType: string;
	bytes: Uint8Array;
};

/**
 * MediaRecorder 常带参数（如 `audio/webm;codecs=opus`）；校验与上游 Blob 只用主类型。
 */
export function normalizeAudioMimeType(mimeType: string): string {
	const raw = mimeType.trim().toLowerCase();
	if (!raw) {
		return '';
	}
	const base = raw.split(';')[0]?.trim() || '';
	if (base === 'audio/mp3') {
		return 'audio/mpeg';
	}
	return base;
}

/** MIME → 扩展名；缺省勿用 `.webm`（mp3 被标成 webm 时上游常报 invalid_audio）。 */
export function extensionFromAudioMime(mimeType: string): string {
	const m = normalizeAudioMimeType(mimeType) || mimeType.trim().toLowerCase();
	if (m.includes('mpeg') || m === 'audio/mp3') return 'mp3';
	if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
	if (m.includes('wav') || m.includes('wave') || m.includes('x-wav')) return 'wav';
	if (m.includes('ogg')) return 'ogg';
	if (m.includes('flac')) return 'flac';
	if (m.includes('webm')) return 'webm';
	return 'bin';
}

/**
 * 规范化 multipart 文件名：与 MIME 对齐扩展名；非 ASCII 名退回 `audio.<ext>`，
 * 避免上游 Content-Disposition 解析失败后误报 invalid_audio。
 */
export function resolveAudioUploadFilename(preferredName: string, mimeType: string): string {
	const ext = extensionFromAudioMime(mimeType);
	const raw = preferredName.trim();
	if (raw && /^[\x20-\x7E]+$/.test(raw) && /\.[A-Za-z0-9]+$/.test(raw)) {
		return raw;
	}
	if (raw && /^[\x20-\x7E]+$/.test(raw) && !raw.includes('.')) {
		return `${raw}.${ext}`;
	}
	return `audio.${ext}`;
}

export type AudioClientResponseFormat =
	| 'json'
	| 'text'
	| 'srt'
	| 'verbose_json'
	| 'vtt'
	| 'diarized_json';

export type NormalizedAudioTranscriptionRequest = {
	/** 同步/兼容 OpenAI 路由需要文件；DashScope 异步路由可只使用 fileSourceUrl。 */
	file: AudioUpload | null;
	/** DashScope 异步文件识别扩展：公网可访问的 HTTP(S)/OSS 音频地址。 */
	fileSourceUrl?: string;
	/** 客户端请求的 format；上游按模型能力选择（whisper 强制 verbose_json 取 duration） */
	clientResponseFormat: AudioClientResponseFormat;
	language?: string;
	prompt?: string;
	temperature?: number;
	/**
	 * 客户端测量的录音墙钟秒数（如 MediaRecorder elapsed）。
	 * Gateway 在无上游/容器时长时用于计费；不会转发给 OpenAI。
	 */
	clientDurationSeconds?: number;
	/** 透传额外表单字段（不含 file/model/response_format/duration_seconds） */
	extra?: Record<string, string>;
};

/**
 * 按上游模型能力选择 response_format。
 * - whisper-1：强制 verbose_json（含 duration，per_second 计费）
 * - gpt-4o-*：上游始终 json/diarized_json（需 usage.tokens；勿用 text，否则丢计费）
 */
export function resolveUpstreamAudioResponseFormat(
	providerModelName: string,
	clientFormat: AudioClientResponseFormat
): string {
	const m = providerModelName.trim().toLowerCase();
	if (m === 'whisper-1' || (m.includes('whisper') && !m.includes('realtime'))) {
		return 'verbose_json';
	}
	if (m.includes('diarize')) {
		if (clientFormat === 'diarized_json') {
			return 'diarized_json';
		}
		// text/json 客户端：上游仍要 json 以拿到 token usage
		return 'json';
	}
	// gpt-4o-transcribe / gpt-4o-mini-transcribe（及日期快照）
	return 'json';
}

export type AudioTranscriptionResult = {
	text: string;
	/** 上游 verbose_json 的 duration（秒）；缺失则为 null */
	durationSeconds: number | null;
	/** 完整上游 body（verbose_json 解析后） */
	upstreamBody: unknown;
	/** 按客户端 format 裁剪后的 body（用于回包） */
	clientBody: unknown;
};

type AudioAbortReason = 'none' | 'client_abort' | 'gateway_timeout';

function withTimeoutSignal(
	requestSignal: AbortSignal | undefined,
	timeoutMs: number
): { signal: AbortSignal; clear: () => void; getAbortReason: () => AudioAbortReason } {
	const controller = new AbortController();
	let reason: AudioAbortReason = 'none';
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

export function validateAudioUpload(file: AudioUpload): string | null {
	if (!file.bytes || file.bytes.byteLength === 0) {
		return 'audio file is empty';
	}
	if (file.bytes.byteLength > AUDIO_MAX_BYTES_PER_FILE) {
		return `audio file must be at most ${AUDIO_MAX_BYTES_PER_FILE} bytes`;
	}
	const mime = normalizeAudioMimeType(file.mimeType || '');
	if (mime && !AUDIO_ALLOWED_MIME.has(mime)) {
		return `unsupported audio mime type: ${mime}`;
	}
	return null;
}

/**
 * 粗估语音时长（秒）：按 ~16kbps 语音压缩启发式。
 * 仅作预算预检 / 上游未返回 duration 时的回退。
 */
export function estimateAudioDurationFromBytes(byteLength: number): number {
	if (!Number.isFinite(byteLength) || byteLength <= 0) {
		return 1;
	}
	return Math.max(1, byteLength / 2000);
}

export function parseDurationFromVerboseJson(body: unknown): number | null {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return null;
	}
	const d = (body as Record<string, unknown>).duration;
	if (typeof d === 'number' && Number.isFinite(d) && d >= 0) {
		return d;
	}
	if (typeof d === 'string' && d.trim() !== '') {
		const n = Number(d);
		if (Number.isFinite(n) && n >= 0) {
			return n;
		}
	}
	return null;
}

/** 从上游回包取时长：verbose_json.duration → usage.seconds → diarized segments.max(end) */
export function parseAudioDurationFromUpstreamBody(body: unknown): number | null {
	const fromVerbose = parseDurationFromVerboseJson(body);
	if (fromVerbose != null) {
		return fromVerbose;
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return null;
	}
	const o = body as Record<string, unknown>;
	const usage = o.usage;
	if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
		const seconds = (usage as Record<string, unknown>).seconds;
		if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
			return seconds;
		}
	}
	const segments = o.segments;
	if (Array.isArray(segments)) {
		let maxEnd = 0;
		for (const seg of segments) {
			if (!seg || typeof seg !== 'object' || Array.isArray(seg)) continue;
			const end = (seg as Record<string, unknown>).end;
			if (typeof end === 'number' && Number.isFinite(end) && end > maxEnd) {
				maxEnd = end;
			}
		}
		if (maxEnd > 0) {
			return maxEnd;
		}
	}
	return null;
}

export function extractTranscriptionText(body: unknown): string {
	if (typeof body === 'string') {
		return body;
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return '';
	}
	const text = (body as Record<string, unknown>).text;
	return typeof text === 'string' ? text : '';
}

/** 按客户端 format 裁剪上游回包。 */
export function reshapeTranscriptionForClient(
	upstreamBody: unknown,
	clientFormat: AudioClientResponseFormat
): unknown {
	if (clientFormat === 'verbose_json' || clientFormat === 'diarized_json') {
		return upstreamBody;
	}
	const text = extractTranscriptionText(upstreamBody);
	if (clientFormat === 'text') {
		return text;
	}
	// json / srt / vtt：保持 OpenAI 兼容最小形状 `{ text }`（srt/vtt 完整内容需上游原生支持）
	if (
		upstreamBody &&
		typeof upstreamBody === 'object' &&
		!Array.isArray(upstreamBody) &&
		typeof (upstreamBody as Record<string, unknown>).text === 'string' &&
		clientFormat === 'json'
	) {
		return { text: (upstreamBody as Record<string, unknown>).text };
	}
	return { text };
}

/** 构造 OpenAI Audio 客户端响应；跨协议 adapter 复用相同输出契约。 */
export function buildAudioTranscriptionClientResponse(
	clientFormat: NormalizedAudioTranscriptionRequest['clientResponseFormat'],
	clientBody: unknown,
	status: number,
	statusText: string
): Response {
	if (clientFormat === 'text' || clientFormat === 'srt' || clientFormat === 'vtt') {
		const text =
			typeof clientBody === 'string'
				? clientBody
				: extractTranscriptionText(clientBody);
		return new Response(text, {
			status,
			statusText,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	}
	return new Response(JSON.stringify(clientBody), {
		status,
		statusText,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * `POST …/audio/transcriptions`（multipart）
 */
export async function dispatchOpenAiAudioTranscriptions(
	route: RouteResult,
	req: NormalizedAudioTranscriptionRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
): Promise<{
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	meta: {
		parsedBody: unknown;
		audioDurationSeconds: number | null;
		audioDurationSource: AudioDurationSource | null;
		audioFileBytes: number;
		audioTokenUsage: AudioTokenUsage | null;
	};
}> {
	const file = req.file;
	if (!file) {
		throw new Error('Audio transcription requires a multipart file for this route');
	}
	const url = resolveUpstreamEndpoint('openai', 'audio.transcriptions', route.providerEndpoints, {
		providerId: route.providerId,
	});
	console.log(
		`[Gateway Audio] upstream transcriptions POST ${url} providerModel=${route.providerModelName} providerId=${route.providerId}`
	);

	const form = new FormData();
	const mergedExtras = buildRouteRequestBody(route, {
		...(req.extra ?? {}),
		...(req.language ? { language: req.language } : {}),
		...(req.prompt ? { prompt: req.prompt } : {}),
		...(req.temperature != null ? { temperature: req.temperature } : {}),
	});
	form.append('model', route.providerModelName);
	const upstreamFormat = resolveUpstreamAudioResponseFormat(
		route.providerModelName,
		req.clientResponseFormat
	);
	form.append('response_format', upstreamFormat);
	for (const [k, v] of Object.entries(mergedExtras)) {
		if (v == null) continue;
		if (k === 'model' || k === 'file' || k === 'response_format') continue;
		if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
			form.append(k, String(v));
		}
	}
	// Copy into a fresh Uint8Array — `BlobPart` typing rejects some ArrayBufferView brands under Workers TS.
	const blob = new Blob([new Uint8Array(file.bytes)], {
		type: file.mimeType || 'application/octet-stream',
	});
	form.append(
		'file',
		blob,
		resolveAudioUploadFilename(file.filename || '', file.mimeType || '')
	);

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
		console.log(
			`[Gateway Audio] upstream transcriptions done status=${response.status} elapsedMs=${Date.now() - startedAt} url=${url}`
		);

		let audioDurationSeconds: number | null = null;
		let audioDurationSource: AudioDurationSource | null = null;
		let audioTokenUsage: AudioTokenUsage | null = null;
		if (response.ok) {
			audioTokenUsage = parseOpenAiAudioTokenUsage(upstreamBody);
			const resolved = resolveAudioBillingDuration({
				upstreamSeconds: parseAudioDurationFromUpstreamBody(upstreamBody),
				fileBytes: file.bytes.byteLength,
				mimeType: file.mimeType,
				fileBytesForParse: file.bytes,
				clientSeconds: req.clientDurationSeconds,
			});
			audioDurationSeconds = resolved.seconds;
			audioDurationSource = resolved.source;
			if (resolved.source !== 'upstream') {
				console.log(
					`[Gateway Audio] duration source=${resolved.source} seconds=${resolved.seconds} fileBytes=${file.bytes.byteLength}`
				);
			}
			if (audioTokenUsage) {
				console.log(
					`[Gateway Audio] token usage in=${audioTokenUsage.input_tokens} out=${audioTokenUsage.output_tokens} audio=${audioTokenUsage.audio_tokens}`
				);
			}
		}

		const clientBody = response.ok
			? reshapeTranscriptionForClient(upstreamBody, req.clientResponseFormat)
			: upstreamBody;
			const clientResponse = buildAudioTranscriptionClientResponse(
			req.clientResponseFormat,
			clientBody,
			response.status,
			response.statusText
		);

		return {
			response: clientResponse,
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId,
			meta: {
				parsedBody: upstreamBody,
				audioDurationSeconds,
				audioDurationSource,
				audioFileBytes: file.bytes.byteLength,
				audioTokenUsage,
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
		console.error(
			`[Gateway Audio] upstream transcriptions failed abortReason=${abortReason} elapsedMs=${Date.now() - startedAt} url=${url} err=${
				err instanceof Error ? err.message : String(err)
			}`
		);
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

/** 日志用：仅 metadata，不落音频。 */
export function redactAudioRequestForLog(input: {
	model: string;
	filename: string;
	mimeType: string;
	byteLength: number;
	language?: string;
	responseFormat: string;
	clientDurationSeconds?: number;
	fileSourceUrl?: string;
}): Record<string, unknown> {
	let fileSourceOrigin: string | null = null;
	if (input.fileSourceUrl) {
		const url = new URL(input.fileSourceUrl);
		fileSourceOrigin = url.protocol === 'oss:' ? 'oss:' : url.origin;
	}
	return {
		operation: 'transcriptions',
		model: input.model,
		filename: input.filename,
		mime_type: input.mimeType,
		byte_length: input.byteLength,
		language: input.language ?? null,
		response_format: input.responseFormat,
		client_duration_seconds: input.clientDurationSeconds ?? null,
		file_source_origin: fileSourceOrigin,
	};
}
