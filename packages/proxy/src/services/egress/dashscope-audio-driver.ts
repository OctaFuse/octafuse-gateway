/**
 * DashScope 原生文件 ASR adapter：
 * - 同步 Qwen-ASR：多模态接口，上传文件编码为 Data URL；
 * - 同步 Fun-ASR-Realtime：同一多模态端点，但请求参数与响应结构独立；
 * - 异步 Qwen-Audio-3.0-ASR-Flash-Filetrans/Fun-ASR：提交公网 file_urls，轮询 task，再读取结果 JSON。
 */
import { resolveUpstreamEndpoint } from '@octafuse/core';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import {
	AUDIO_TRANSCRIPTION_TIMEOUT_MS,
	buildAudioTranscriptionClientResponse,
	extensionFromAudioMime,
	reshapeTranscriptionForClient,
	type AudioUpload,
	type NormalizedAudioTranscriptionRequest,
} from './openai-audio-driver';
import { resolveAudioBillingDuration, type AudioDurationSource } from './audio-duration';
import { extractUpstreamRequestId, normalizeUpstreamId } from './upstream-request-id';

/** 官方同步接口的 Base64 Data URL 请求上限为 10MB。 */
export const DASHSCOPE_SYNC_ASR_MAX_DATA_URL_BYTES = 10 * 1024 * 1024;
export const DASHSCOPE_ASYNC_POLL_INTERVAL_MS = 1_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type DashScopeAsrDispatchOptions = {
	fetchImpl?: FetchLike;
	pollIntervalMs?: number;
	timeoutMs?: number;
};

type DashScopeAudioDispatchResult = {
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	meta: {
		parsedBody: unknown;
		audioDurationSeconds: number | null;
		audioDurationSource: AudioDurationSource | null;
		audioFileBytes: number;
		audioTokenUsage: null;
	};
};

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asFiniteNonNegativeNumber(value: unknown): number | null {
	const number = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Worker 与 Node 共用的无 Buffer Base64 编码。 */
export function audioUploadToDataUrl(file: AudioUpload): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < file.bytes.byteLength; offset += chunkSize) {
		const chunk = file.bytes.subarray(offset, Math.min(offset + chunkSize, file.bytes.byteLength));
		binary += String.fromCharCode(...chunk);
	}
	const dataUrl = `data:${file.mimeType || 'application/octet-stream'};base64,${btoa(binary)}`;
	if (dataUrl.length > DASHSCOPE_SYNC_ASR_MAX_DATA_URL_BYTES) {
		throw new Error(
			`DashScope synchronous ASR Data URL must be at most ${DASHSCOPE_SYNC_ASR_MAX_DATA_URL_BYTES} bytes`,
		);
	}
	return dataUrl;
}

function normalizedAsrOptions(route: RouteResult, req: NormalizedAudioTranscriptionRequest): Record<string, unknown> {
	const configured = route.customParams?.asr_options;
	if (configured != null && asObject(configured) == null) {
		throw new Error('DashScope route custom_params.asr_options must be an object');
	}
	return {
		...(asObject(configured) ?? {}),
		...(req.language ? { language: req.language } : {}),
	};
}

/** 构造 Qwen-ASR DashScope 同步多模态请求。 */
export function buildDashScopeSyncAsrBody(
	route: RouteResult,
	req: NormalizedAudioTranscriptionRequest,
): Record<string, unknown> {
	if (!req.file) throw new Error('DashScope synchronous ASR requires a multipart file');
	const messages: Array<Record<string, unknown>> = [];
	if (req.prompt) {
		messages.push({ role: 'system', content: [{ text: req.prompt }] });
	}
	messages.push({
		role: 'user',
		content: [{ audio: audioUploadToDataUrl(req.file) }],
	});
	return {
		model: route.providerModelName,
		input: { messages },
		parameters: {
			...(route.customParams ?? {}),
			asr_options: normalizedAsrOptions(route, req),
		},
	};
}

const FUN_ASR_FILE_FORMATS = new Set([
	'aac',
	'amr',
	'avi',
	'flac',
	'flv',
	'm4a',
	'mkv',
	'mov',
	'mp3',
	'mp4',
	'mpeg',
	'ogg',
	'opus',
	'wav',
	'webm',
	'wma',
	'wmv',
]);

/** Fun-ASR-Realtime 的 HTTP 文件接口强制要求与音频内容一致的 format。 */
export function resolveDashScopeFunAsrFormat(file: AudioUpload): string {
	const mimeFormat = extensionFromAudioMime(file.mimeType);
	if (FUN_ASR_FILE_FORMATS.has(mimeFormat)) return mimeFormat;
	const filenameFormat = file.filename.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? '';
	if (FUN_ASR_FILE_FORMATS.has(filenameFormat)) return filenameFormat;
	throw new Error(
		`DashScope Fun-ASR file format cannot be derived from MIME ${JSON.stringify(
			file.mimeType,
		)} and filename ${JSON.stringify(file.filename)}`,
	);
}

/** 构造 Fun-ASR-Realtime 非实时 Base64 请求；禁止悄悄丢弃 OpenAI 可选字段。 */
export function buildDashScopeFunAsrBody(
	route: RouteResult,
	req: NormalizedAudioTranscriptionRequest,
): Record<string, unknown> {
	if (!req.file) throw new Error('DashScope synchronous ASR requires a multipart file');
	if (req.language) {
		throw new Error('DashScope Fun-ASR file API does not support the OpenAI language field');
	}
	if (req.prompt) {
		throw new Error('DashScope Fun-ASR file API does not support the OpenAI prompt field');
	}
	return {
		model: route.providerModelName,
		input: {
			messages: [
				{
					role: 'user',
					content: [{ audio: audioUploadToDataUrl(req.file) }],
				},
			],
		},
		parameters: {
			...(route.customParams ?? {}),
			format: resolveDashScopeFunAsrFormat(req.file),
		},
		resources: [],
	};
}

/** 构造 DashScope 异步文件识别提交请求。 */
export function buildDashScopeAsyncAsrBody(
	route: RouteResult,
	fileUrl: string,
	req: NormalizedAudioTranscriptionRequest,
): Record<string, unknown> {
	const parameters = { ...(route.customParams ?? {}) };
	delete parameters.asr_options;
	return {
		model: route.providerModelName,
		input: {
			file_urls: [fileUrl],
			...(req.prompt
				? {
						context: [
							{
								role: 'user',
								content: [{ type: 'input_text', text: req.prompt }],
							},
						],
				  }
				: {}),
		},
		parameters: {
			...parameters,
			...(req.language ? { language_hints: [req.language] } : {}),
		},
	};
}

function firstArrayObject(value: unknown): Record<string, unknown> | null {
	return Array.isArray(value) ? asObject(value[0]) : null;
}

/** DashScope 同步结果 → OpenAI transcription 中间形状。 */
export function normalizeDashScopeSyncAsrResult(body: unknown): Record<string, unknown> {
	const root = asObject(body);
	const output = asObject(root?.output);
	const choice = firstArrayObject(output?.choices);
	const message = asObject(choice?.message);
	const content = firstArrayObject(message?.content);
	const text = typeof content?.text === 'string' ? content.text : '';
	const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
	const annotation = asObject(annotations[0]);
	const seconds = asFiniteNonNegativeNumber(asObject(root?.usage)?.seconds);
	return {
		text,
		...(seconds != null ? { duration: seconds } : {}),
		...(typeof annotation?.language === 'string' ? { language: annotation.language } : {}),
		...(typeof annotation?.emotion === 'string' ? { emotion: annotation.emotion } : {}),
		usage: seconds == null ? root?.usage ?? null : { type: 'duration', seconds },
		dashscope: body,
	};
}

/** Fun-ASR-Realtime 非实时结果 → OpenAI transcription 中间形状。 */
export function normalizeDashScopeFunAsrResult(body: unknown): Record<string, unknown> {
	const root = asObject(body);
	const output = asObject(root?.output);
	const sentence = asObject(output?.sentence);
	const text = typeof output?.text === 'string' ? output.text : typeof sentence?.text === 'string' ? sentence.text : '';
	const seconds = asFiniteNonNegativeNumber(asObject(root?.usage)?.duration);
	const beginMs = asFiniteNonNegativeNumber(sentence?.begin_time);
	const endMs = asFiniteNonNegativeNumber(sentence?.end_time);
	const segments = sentence
		? [
				{
					id: sentence.sentence_id ?? 0,
					start: (beginMs ?? 0) / 1_000,
					end: (endMs ?? beginMs ?? 0) / 1_000,
					text: typeof sentence.text === 'string' ? sentence.text : text,
					channel: sentence.channel_id ?? 0,
					...(Array.isArray(sentence.words) ? { words: sentence.words } : {}),
				},
		  ]
		: [];
	return {
		text,
		...(seconds != null ? { duration: seconds } : {}),
		segments,
		usage: seconds == null ? root?.usage ?? null : { type: 'duration', seconds },
		dashscope: body,
	};
}

/** DashScope 异步结果文件 → OpenAI verbose transcription 中间形状。 */
export function normalizeDashScopeAsyncAsrResult(resultFile: unknown, taskBody: unknown): Record<string, unknown> {
	const result = asObject(resultFile);
	const transcripts = Array.isArray(result?.transcripts) ? result.transcripts : [];
	const texts: string[] = [];
	const segments: Array<Record<string, unknown>> = [];
	let language: string | null = null;
	for (const transcriptRaw of transcripts) {
		const transcript = asObject(transcriptRaw);
		if (!transcript) continue;
		if (typeof transcript.text === 'string' && transcript.text.trim()) {
			texts.push(transcript.text.trim());
		}
		const sentences = Array.isArray(transcript.sentences) ? transcript.sentences : [];
		for (const sentenceRaw of sentences) {
			const sentence = asObject(sentenceRaw);
			if (!sentence) continue;
			if (!language && typeof sentence.language === 'string') language = sentence.language;
			segments.push({
				id: sentence.sentence_id ?? segments.length,
				start: (asFiniteNonNegativeNumber(sentence.begin_time) ?? 0) / 1_000,
				end: (asFiniteNonNegativeNumber(sentence.end_time) ?? 0) / 1_000,
				text: typeof sentence.text === 'string' ? sentence.text : '',
				channel: transcript.channel_id ?? 0,
				...(typeof sentence.emotion === 'string' ? { emotion: sentence.emotion } : {}),
			});
		}
	}
	const task = asObject(taskBody);
	const seconds = asFiniteNonNegativeNumber(asObject(task?.usage)?.seconds);
	return {
		text: texts.join('\n'),
		...(seconds != null ? { duration: seconds } : {}),
		...(language ? { language } : {}),
		segments,
		usage: seconds == null ? null : { type: 'duration', seconds },
		dashscope: { task: taskBody, result: resultFile },
	};
}

async function parseJsonResponse(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return {
			error: { message: text.slice(0, 500) || 'Invalid upstream JSON' },
		};
	}
}

function bodyRequestId(body: unknown): string | null {
	return normalizeUpstreamId(asObject(body)?.request_id);
}

function clientResult(
	req: NormalizedAudioTranscriptionRequest,
	upstreamResponse: Response,
	parsedBody: unknown,
	fileBytes: number,
	duration: { seconds: number; source: AudioDurationSource } | null,
	requestId: string | null,
): DashScopeAudioDispatchResult {
	const clientBody = upstreamResponse.ok
		? reshapeTranscriptionForClient(parsedBody, req.clientResponseFormat)
		: parsedBody;
	return {
		response: buildAudioTranscriptionClientResponse(
			req.clientResponseFormat,
			clientBody,
			upstreamResponse.status,
			upstreamResponse.statusText,
		),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: requestId,
		meta: {
			parsedBody,
			audioDurationSeconds: duration?.seconds ?? null,
			audioDurationSource: duration?.source ?? null,
			audioFileBytes: fileBytes,
			audioTokenUsage: null,
		},
	};
}

function resolveDashScopeDuration(
	req: NormalizedAudioTranscriptionRequest,
	upstreamSeconds: number | null,
): { seconds: number; source: AudioDurationSource } {
	return resolveAudioBillingDuration({
		upstreamSeconds,
		fileBytes: req.file?.bytes.byteLength ?? 0,
		mimeType: req.file?.mimeType ?? 'application/octet-stream',
		fileBytesForParse: req.file?.bytes,
		clientSeconds: req.clientDurationSeconds,
	});
}

function withTimeout(
	requestSignal: AbortSignal | undefined,
	timeoutMs: number,
): { signal: AbortSignal; clear: () => void; timedOut: () => boolean } {
	const controller = new AbortController();
	let timeoutReached = false;
	const onAbort = () => controller.abort();
	requestSignal?.addEventListener('abort', onAbort, { once: true });
	const timer = setTimeout(() => {
		timeoutReached = true;
		controller.abort();
	}, timeoutMs);
	return {
		signal: controller.signal,
		clear: () => {
			clearTimeout(timer);
			requestSignal?.removeEventListener('abort', onAbort);
		},
		timedOut: () => timeoutReached,
	};
}

function errorDispatchResult(
	req: NormalizedAudioTranscriptionRequest,
	status: number,
	message: string,
): DashScopeAudioDispatchResult {
	const body = { error: { message } };
	return clientResult(req, new Response(null, { status }), body, req.file?.bytes.byteLength ?? 0, null, null);
}

/** 按显式 adapter 分发 Qwen-ASR 或 Fun-ASR-Realtime 的同步文件调用。 */
export async function dispatchDashScopeSyncAsr(
	route: RouteResult,
	req: NormalizedAudioTranscriptionRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: DashScopeAsrDispatchOptions = {},
): Promise<DashScopeAudioDispatchResult> {
	if (!req.file) throw new Error('DashScope synchronous ASR requires a multipart file');
	const isQwen = route.adapter === 'dashscope-asr-qwen-file';
	const isFun = route.adapter === 'dashscope-asr-fun-file';
	if (!isQwen && !isFun) {
		throw new Error(`Unsupported DashScope synchronous ASR adapter: ${route.adapter}`);
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const url = resolveUpstreamEndpoint('dashscope', 'audio.transcriptions.multimodal', route.providerEndpoints, {
		providerId: route.providerId,
	});
	const timeout = withTimeout(requestSignal, options.timeoutMs ?? AUDIO_TRANSCRIPTION_TIMEOUT_MS);
	try {
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${route.providerApiKey}`,
				'Content-Type': 'application/json',
				...(isFun ? { 'X-DashScope-SSE': 'disable' } : {}),
			},
			body: JSON.stringify(isFun ? buildDashScopeFunAsrBody(route, req) : buildDashScopeSyncAsrBody(route, req)),
			signal: timeout.signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const headerRequestId = extractUpstreamRequestId(response.headers);
		const upstreamBody = await parseJsonResponse(response);
		timing?.markStreamComplete();
		if (!response.ok) {
			return clientResult(
				req,
				response,
				upstreamBody,
				req.file.bytes.byteLength,
				null,
				headerRequestId ?? bodyRequestId(upstreamBody),
			);
		}
		const normalized = isFun
			? normalizeDashScopeFunAsrResult(upstreamBody)
			: normalizeDashScopeSyncAsrResult(upstreamBody);
		const seconds = asFiniteNonNegativeNumber(asObject(normalized.usage)?.seconds);
		return clientResult(
			req,
			response,
			normalized,
			req.file.bytes.byteLength,
			resolveDashScopeDuration(req, seconds),
			headerRequestId ?? bodyRequestId(upstreamBody),
		);
	} catch (error) {
		timing?.markStreamComplete();
		const aborted = timeout.signal.aborted;
		return errorDispatchResult(
			req,
			aborted ? (timeout.timedOut() ? 504 : 499) : 502,
			aborted
				? timeout.timedOut()
					? 'DashScope synchronous ASR timed out'
					: 'DashScope synchronous ASR was cancelled by the client'
				: `DashScope synchronous ASR failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		timeout.clear();
	}
}

function taskOutput(body: unknown): Record<string, unknown> | null {
	return asObject(asObject(body)?.output);
}

async function waitForPoll(signal: AbortSignal, ms: number): Promise<void> {
	if (ms <= 0) return;
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

/** DashScope 异步文件任务：提交、轮询、下载结果后一次性返回 OpenAI transcription。 */
export async function dispatchDashScopeAsyncAsr(
	route: RouteResult,
	req: NormalizedAudioTranscriptionRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: DashScopeAsrDispatchOptions = {},
): Promise<DashScopeAudioDispatchResult> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeout = withTimeout(requestSignal, options.timeoutMs ?? AUDIO_TRANSCRIPTION_TIMEOUT_MS);
	try {
		const fileUrl = req.fileSourceUrl;
		if (!fileUrl) {
			throw new Error('DashScope asynchronous ASR requires a client-provided file_url');
		}
		const submitUrl = resolveUpstreamEndpoint('dashscope', 'audio.transcriptions', route.providerEndpoints, {
			providerId: route.providerId,
		});
		const submitResponse = await fetchImpl(submitUrl, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${route.providerApiKey}`,
				'Content-Type': 'application/json',
				'X-DashScope-Async': 'enable',
			},
			body: JSON.stringify(buildDashScopeAsyncAsrBody(route, fileUrl, req)),
			signal: timeout.signal,
		});
		timing?.markAttemptHeaders(attempt, submitResponse.status);
		const submitBody = await parseJsonResponse(submitResponse);
		const submitRequestId = extractUpstreamRequestId(submitResponse.headers) ?? bodyRequestId(submitBody);
		if (!submitResponse.ok) {
			timing?.markStreamComplete();
			return clientResult(req, submitResponse, submitBody, req.file?.bytes.byteLength ?? 0, null, submitRequestId);
		}
		const taskId = taskOutput(submitBody)?.task_id;
		if (typeof taskId !== 'string' || !taskId.trim()) {
			throw new Error('DashScope asynchronous ASR response has no task_id');
		}
		const queryUrl = resolveUpstreamEndpoint('dashscope', 'audio.transcriptions.tasks', route.providerEndpoints, {
			providerId: route.providerId,
			taskId,
		});
		for (;;) {
			await waitForPoll(timeout.signal, options.pollIntervalMs ?? DASHSCOPE_ASYNC_POLL_INTERVAL_MS);
			const queryResponse = await fetchImpl(queryUrl, {
				method: 'GET',
				headers: { Authorization: `Bearer ${route.providerApiKey}` },
				signal: timeout.signal,
			});
			const queryBody = await parseJsonResponse(queryResponse);
			const requestId = extractUpstreamRequestId(queryResponse.headers) ?? bodyRequestId(queryBody) ?? submitRequestId;
			if (!queryResponse.ok) {
				timing?.markStreamComplete();
				return clientResult(req, queryResponse, queryBody, req.file?.bytes.byteLength ?? 0, null, requestId);
			}
			const output = taskOutput(queryBody);
			if (!output) {
				throw new Error('DashScope asynchronous ASR task response has no output');
			}
			const status = typeof output.task_status === 'string' ? output.task_status : '';
			if (status === 'PENDING' || status === 'RUNNING') continue;
			if (status !== 'SUCCEEDED') {
				timing?.markStreamComplete();
				return clientResult(
					req,
					new Response(null, { status: 502 }),
					{
						error: {
							message:
								typeof output.message === 'string'
									? output.message
									: `DashScope asynchronous ASR task ended with status ${status || 'UNKNOWN'}`,
							code: output.code ?? null,
						},
						dashscope: queryBody,
					},
					req.file?.bytes.byteLength ?? 0,
					null,
					requestId,
				);
			}
			const results = output.results;
			const result = Array.isArray(results) ? asObject(results[0]) : null;
			if (!result) {
				throw new Error('DashScope asynchronous ASR task response has no results');
			}
			const subtaskStatus = typeof result.subtask_status === 'string' ? result.subtask_status : '';
			if (subtaskStatus && subtaskStatus !== 'SUCCEEDED') {
				timing?.markStreamComplete();
				return clientResult(
					req,
					new Response(null, { status: 502 }),
					{
						error: {
							message:
								typeof result.message === 'string'
									? result.message
									: `DashScope asynchronous ASR subtask ended with status ${subtaskStatus}`,
							code: result.code ?? null,
						},
						dashscope: queryBody,
					},
					req.file?.bytes.byteLength ?? 0,
					null,
					requestId,
				);
			}
			const transcriptionUrl = result.transcription_url;
			if (typeof transcriptionUrl !== 'string' || !transcriptionUrl) {
				throw new Error('DashScope asynchronous ASR result has no transcription_url');
			}
			const resultResponse = await fetchImpl(transcriptionUrl, {
				signal: timeout.signal,
			});
			const resultBody = await parseJsonResponse(resultResponse);
			if (!resultResponse.ok) {
				timing?.markStreamComplete();
				return clientResult(req, resultResponse, resultBody, req.file?.bytes.byteLength ?? 0, null, requestId);
			}
			const normalized = normalizeDashScopeAsyncAsrResult(resultBody, queryBody);
			const seconds = asFiniteNonNegativeNumber(asObject(normalized.usage)?.seconds);
			timing?.markStreamComplete();
			return clientResult(
				req,
				queryResponse,
				normalized,
				req.file?.bytes.byteLength ?? 0,
				resolveDashScopeDuration(req, seconds),
				requestId,
			);
		}
	} catch (error) {
		timing?.markStreamComplete();
		const aborted = timeout.signal.aborted;
		return errorDispatchResult(
			req,
			aborted ? (timeout.timedOut() ? 504 : 499) : 502,
			aborted
				? timeout.timedOut()
					? 'DashScope asynchronous ASR timed out'
					: 'DashScope asynchronous ASR was cancelled by the client'
				: `DashScope asynchronous ASR failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		timeout.clear();
	}
}
