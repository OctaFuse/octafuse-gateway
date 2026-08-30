/**
 * OpenAI `/audio/speech` 与 DashScope TTS 的协议驱动。
 * DashScope 统一使用 SSE 上游，以便边转发音频边读取最终真实 usage；不会用输入长度伪造最终用量。
 */
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret, resolveUpstreamEndpoint } from '@octafuse/core';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { extractUpstreamRequestId } from './upstream-request-id';

export type AudioSpeechResponseFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
export type AudioSpeechStreamFormat = 'audio' | 'sse';
export type AudioSpeechVoice = string | { id: string };

export type NormalizedAudioSpeechRequest = {
	input: string;
	voice: AudioSpeechVoice;
	responseFormat: AudioSpeechResponseFormat;
	speed: number;
	streamFormat: AudioSpeechStreamFormat;
	instructions?: string;
};

type SpeechDispatchResult = {
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
};

export type AudioSpeechDispatchOptions = {
	fetchImpl?: typeof fetch;
};

type DashScopeTtsKind = 'speech' | 'qwen' | 'minimax';

type ParsedTtsEvent = {
	audioBase64: string | null;
	characters: number | null;
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	terminal: boolean;
	requestId: string | null;
	rawUsage: unknown;
	error: string | null;
};

const AUDIO_CONTENT_TYPES: Record<AudioSpeechResponseFormat, string> = {
	mp3: 'audio/mpeg',
	opus: 'audio/ogg',
	aac: 'audio/aac',
	flac: 'audio/flac',
	wav: 'audio/wav',
	pcm: 'application/octet-stream',
};

function isObject(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function finiteInteger(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function voiceId(voice: AudioSpeechVoice): string {
	return typeof voice === 'string' ? voice : voice.id;
}

function copyResponseHeaders(headers: Headers): Headers {
	const copied = new Headers(headers);
	copied.delete('content-length');
	copied.delete('content-encoding');
	return copied;
}

/** SSE 帧只读取 `data:`；DashScope 与 OpenAI speech 均以 JSON data 帧传输。 */
export class SpeechSseParser {
	private buffer = '';
	private readonly decoder = new TextDecoder();

	push(chunk: Uint8Array, final = false): unknown[] {
		this.buffer += this.decoder.decode(chunk, { stream: !final });
		const normalized = this.buffer.replace(/\r\n/g, '\n');
		const parts = normalized.split('\n\n');
		this.buffer = parts.pop() ?? '';
		if (final && this.buffer.trim() !== '') {
			parts.push(this.buffer);
			this.buffer = '';
		}

		const events: unknown[] = [];
		for (const frame of parts) {
			const data = frame
				.split('\n')
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trimStart())
				.join('\n');
			if (!data || data === '[DONE]') continue;
			events.push(JSON.parse(data));
		}
		return events;
	}
}

function hexToBase64(hex: string): string {
	if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
		throw new Error('DashScope MiniMax returned invalid hex audio data');
	}
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i += 1) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function parseDashScopeTtsEvent(value: unknown, kind: DashScopeTtsKind): ParsedTtsEvent {
	if (!isObject(value)) {
		throw new Error('DashScope TTS returned a non-object SSE event');
	}
	const output = isObject(value.output) ? value.output : {};
	const usage = isObject(value.usage) ? value.usage : null;
	const requestId = typeof value.request_id === 'string' ? value.request_id : null;

	let error: string | null = null;
	if (typeof value.code === 'string' && value.code.trim() !== '') {
		error = `${value.code}: ${typeof value.message === 'string' ? value.message : 'DashScope TTS failed'}`;
	}
	if (typeof value.status_code === 'number' && value.status_code >= 400) {
		error = typeof value.message === 'string' ? value.message : `DashScope status ${value.status_code}`;
	}

	let audioBase64: string | null = null;
	let terminal = false;
	if (kind === 'minimax') {
		const baseResponse = isObject(output.base_resp) ? output.base_resp : null;
		const statusCode = baseResponse ? finiteInteger(baseResponse.status_code) : null;
		if (statusCode != null && statusCode !== 0) {
			error = typeof baseResponse?.status_msg === 'string'
				? baseResponse.status_msg
				: `MiniMax status ${statusCode}`;
		}
		const data = isObject(output.data) ? output.data : null;
		const hex = data && typeof data.audio === 'string' ? data.audio : '';
		if (hex) audioBase64 = hexToBase64(hex);
		terminal = data?.status === 2;
	} else {
		const audio = isObject(output.audio) ? output.audio : null;
		const data = audio && typeof audio.data === 'string' ? audio.data : '';
		if (data) audioBase64 = data;
		terminal = output.finish_reason === 'stop';
	}

	return {
		audioBase64,
		characters: usage ? finiteInteger(usage.characters) : null,
		inputTokens: usage ? finiteInteger(usage.input_tokens) : null,
		outputTokens: usage ? finiteInteger(usage.output_tokens) : null,
		totalTokens: usage ? finiteInteger(usage.total_tokens) : null,
		terminal,
		requestId,
		rawUsage: usage,
		error,
	};
}

function speechDoneEvent(usage: UsageFromStream): Uint8Array {
	return new TextEncoder().encode(
		`data: ${JSON.stringify({
			type: 'speech.audio.done',
			usage: {
				input_tokens: usage.input_tokens,
				output_tokens: usage.output_tokens,
				total_tokens: usage.total_tokens,
			},
		})}\n\n`
	);
}

function speechDeltaEvent(audioBase64: string): Uint8Array {
	return new TextEncoder().encode(
		`data: ${JSON.stringify({ type: 'speech.audio.delta', audio: audioBase64 })}\n\n`
	);
}

function updateUsageFromTtsEvent(usage: UsageFromStream, event: ParsedTtsEvent): void {
	if (event.characters != null) usage.audio_characters = event.characters;
	if (event.inputTokens != null) usage.input_tokens = event.inputTokens;
	if (event.outputTokens != null) usage.output_tokens = event.outputTokens;
	if (event.totalTokens != null) usage.total_tokens = event.totalTokens;
	if (event.rawUsage != null) usage.raw_usage = JSON.stringify(event.rawUsage);
	if (event.requestId) usage.upstreamBodyRequestId = event.requestId;
}

function dashScopeStreamResponse(options: {
	reader: ReadableStreamDefaultReader<Uint8Array>;
	parser: SpeechSseParser;
	initialEvents: unknown[];
	kind: DashScopeTtsKind;
	request: NormalizedAudioSpeechRequest;
	timing?: RequestTimingCollector | null;
}): { response: Response; usagePromise: Promise<UsageFromStream> } {
	const usage: UsageFromStream = { ...EMPTY_USAGE };
	let resolveUsage!: (value: UsageFromStream) => void;
	const usagePromise = new Promise<UsageFromStream>((resolve) => {
		resolveUsage = resolve;
	});
	let settled = false;
	let terminal = false;
	let emittedAudio = false;
	const pending = [...options.initialEvents];
	const finishUsage = (cancelled = false, streamError?: unknown) => {
		if (settled) return;
		settled = true;
		if (cancelled) usage.cancelled = true;
		if (streamError != null) {
			usage.stream_error = streamError instanceof Error ? streamError.message : String(streamError);
		}
		options.timing?.markStreamComplete();
		resolveUsage({ ...usage });
	};

	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				while (!terminal) {
					if (pending.length === 0) {
						const next = await options.reader.read();
						if (next.done) {
							pending.push(...options.parser.push(new Uint8Array(), true));
							if (pending.length === 0) {
								throw new Error('DashScope TTS stream ended before a terminal event');
							}
						} else {
							pending.push(...options.parser.push(next.value));
						}
					}
					const raw = pending.shift();
					if (raw === undefined) continue;
					const event = parseDashScopeTtsEvent(raw, options.kind);
					if (event.error) throw new Error(event.error);
					updateUsageFromTtsEvent(usage, event);
					if (event.audioBase64) {
						emittedAudio = true;
						options.timing?.markFirstByte();
						controller.enqueue(
							options.request.streamFormat === 'sse'
								? speechDeltaEvent(event.audioBase64)
								: base64ToBytes(event.audioBase64)
						);
					}
					if (event.terminal) {
						if (!emittedAudio) throw new Error('DashScope TTS completed without audio data');
						terminal = true;
						if (options.request.streamFormat === 'sse') controller.enqueue(speechDoneEvent(usage));
						controller.close();
						finishUsage(false);
						void options.reader.cancel();
						return;
					}
					if (event.audioBase64) return;
				}
			} catch (error) {
				finishUsage(false, error);
				controller.error(error);
			}
		},
		async cancel() {
			finishUsage(true);
			await options.reader.cancel();
		},
	});

	return {
		response: new Response(body, {
			headers: {
				'Content-Type':
					options.request.streamFormat === 'sse'
						? 'text/event-stream; charset=utf-8'
						: AUDIO_CONTENT_TYPES[options.request.responseFormat],
				'Cache-Control': 'no-cache',
			},
		}),
		usagePromise,
	};
}

async function firstDashScopeEvents(
	response: Response,
	kind: DashScopeTtsKind
): Promise<{
	reader: ReadableStreamDefaultReader<Uint8Array>;
	parser: SpeechSseParser;
	events: unknown[];
	requestId: string | null;
	error: string | null;
}> {
	if (!response.body) throw new Error('DashScope TTS returned an empty response body');
	const reader = response.body.getReader();
	const parser = new SpeechSseParser();
	while (true) {
		const next = await reader.read();
		const events = parser.push(next.value ?? new Uint8Array(), next.done);
		if (events.length > 0) {
			let requestId: string | null = null;
			let error: string | null = null;
			for (const raw of events) {
				const parsed = parseDashScopeTtsEvent(raw, kind);
				requestId ??= parsed.requestId;
				error ??= parsed.error;
			}
			return { reader, parser, events, requestId, error };
		}
		if (next.done) throw new Error('DashScope TTS returned no SSE event');
	}
}

function validateDashScopeRequest(
	kind: DashScopeTtsKind,
	request: NormalizedAudioSpeechRequest
): string | null {
	if (kind === 'speech') {
		if (!['mp3', 'opus', 'wav', 'pcm'].includes(request.responseFormat)) {
			return `DashScope SpeechSynthesizer does not support response_format=${request.responseFormat}`;
		}
		if (request.speed < 0.5 || request.speed > 2) {
			return 'DashScope SpeechSynthesizer speed must be between 0.5 and 2.0';
		}
		return null;
	}
	if (kind === 'qwen') {
		if (request.responseFormat !== 'wav') return 'DashScope Qwen-TTS only returns wav audio';
		if (request.speed !== 1) return 'DashScope Qwen-TTS does not support speed';
		return null;
	}
	if (!['mp3', 'pcm', 'flac', 'wav'].includes(request.responseFormat)) {
		return `DashScope MiniMax does not support response_format=${request.responseFormat}`;
	}
	if (request.instructions) return 'DashScope MiniMax does not support OpenAI instructions';
	return null;
}

/** 显式 adapter 决定请求形状，避免按模型名称猜测 MiniMax 与 Qwen 协议。 */
export function buildDashScopeTtsBody(
	route: RouteResult,
	request: NormalizedAudioSpeechRequest,
	kind: DashScopeTtsKind
): Record<string, unknown> {
	const voice = voiceId(request.voice);
	if (kind === 'speech') {
		return buildRouteRequestBody(route, {
			model: route.providerModelName,
			input: {
				text: request.input,
				voice,
				format: request.responseFormat,
				rate: request.speed,
				...(request.instructions ? { instruction: request.instructions } : {}),
			},
		});
	}
	if (kind === 'qwen') {
		return buildRouteRequestBody(route, {
			model: route.providerModelName,
			input: {
				text: request.input,
				voice,
				...(request.instructions ? { instructions: request.instructions } : {}),
			},
		});
	}
	return buildRouteRequestBody(route, {
		model: route.providerModelName,
		input: {
			text: request.input,
			voice_setting: { voice_id: voice, speed: request.speed },
			audio_setting: { format: request.responseFormat },
			// MiniMax 尾帧默认重复完整 hex；关闭聚合避免客户端收到重复音频。
			stream_options: { exclude_aggregated_audio: true },
		},
	});
}

async function dispatchDashScopeTts(
	route: RouteResult,
	request: NormalizedAudioSpeechRequest,
	kind: DashScopeTtsKind,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: AudioSpeechDispatchOptions
): Promise<SpeechDispatchResult> {
	const validationError = validateDashScopeRequest(kind, request);
	if (validationError) {
		return {
			response: new Response(JSON.stringify({ error: { message: validationError } }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		};
	}
	const capability = kind === 'speech' ? 'audio.speech' : 'audio.speech.multimodal';
	const url = resolveUpstreamEndpoint('dashscope', capability, route.providerEndpoints, {
		providerId: route.providerId,
	});
	const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
	const response = await (options?.fetchImpl ?? fetch)(url, {
		method: 'POST',
		headers: applyRouteExtraHeaders(
			{
				Authorization: `Bearer ${secret}`,
				'Content-Type': 'application/json',
				'X-DashScope-SSE': 'enable',
			},
			route.customParams
		),
		body: JSON.stringify(buildDashScopeTtsBody(route, request, kind)),
		signal: requestSignal,
	});
	timing?.markAttemptHeaders(attempt, response.status);
	const headerRequestId = extractUpstreamRequestId(response.headers);
	if (!response.ok) {
		return {
			response,
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: headerRequestId,
		};
	}

	const first = await firstDashScopeEvents(response, kind);
	if (first.error) {
		await first.reader.cancel();
		return {
			response: new Response(JSON.stringify({ error: { message: first.error } }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' },
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: first.requestId ?? headerRequestId,
		};
	}
	const streamed = dashScopeStreamResponse({
		reader: first.reader,
		parser: first.parser,
		initialEvents: first.events,
		kind,
		request,
		timing,
	});
	return {
		...streamed,
		upstreamRequestId: first.requestId ?? headerRequestId,
	};
}

function parseOpenAiSpeechUsage(event: unknown, usage: UsageFromStream): boolean {
	if (!isObject(event) || event.type !== 'speech.audio.done' || !isObject(event.usage)) return false;
	usage.input_tokens = finiteInteger(event.usage.input_tokens) ?? 0;
	usage.output_tokens = finiteInteger(event.usage.output_tokens) ?? 0;
	usage.total_tokens = finiteInteger(event.usage.total_tokens) ?? 0;
	usage.raw_usage = JSON.stringify(event.usage);
	return true;
}

function wrapOpenAiSpeechBody(
	body: ReadableStream<Uint8Array>,
	streamFormat: AudioSpeechStreamFormat,
	timing?: RequestTimingCollector | null
): { body: ReadableStream<Uint8Array>; usagePromise: Promise<UsageFromStream> } {
	const reader = body.getReader();
	const parser = streamFormat === 'sse' ? new SpeechSseParser() : null;
	const usage: UsageFromStream = { ...EMPTY_USAGE };
	let resolveUsage!: (value: UsageFromStream) => void;
	const usagePromise = new Promise<UsageFromStream>((resolve) => {
		resolveUsage = resolve;
	});
	let settled = false;
	let sawTerminal = false;
	const finish = (cancelled = false, streamError?: unknown) => {
		if (settled) return;
		settled = true;
		if (cancelled) usage.cancelled = true;
		if (streamError != null) {
			usage.stream_error = streamError instanceof Error ? streamError.message : String(streamError);
		}
		timing?.markStreamComplete();
		resolveUsage({ ...usage });
	};
	return {
		body: new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					const next = await reader.read();
					if (next.done) {
						for (const event of parser?.push(new Uint8Array(), true) ?? []) {
							sawTerminal ||= parseOpenAiSpeechUsage(event, usage);
						}
						if (streamFormat === 'sse' && !sawTerminal) {
							throw new Error('OpenAI speech SSE ended before speech.audio.done');
						}
						finish(false);
						controller.close();
						return;
					}
					timing?.markFirstByte();
					for (const event of parser?.push(next.value) ?? []) {
						sawTerminal ||= parseOpenAiSpeechUsage(event, usage);
					}
					controller.enqueue(next.value);
				} catch (error) {
					finish(false, error);
					controller.error(error);
				}
			},
			async cancel() {
				finish(true);
				await reader.cancel();
			},
		}),
		usagePromise,
	};
}

export async function dispatchOpenAiAudioSpeech(
	route: RouteResult,
	request: NormalizedAudioSpeechRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: AudioSpeechDispatchOptions
): Promise<SpeechDispatchResult> {
	const url = resolveUpstreamEndpoint('openai', 'audio.speech', route.providerEndpoints, {
		providerId: route.providerId,
	});
	const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
	const response = await (options?.fetchImpl ?? fetch)(url, {
		method: 'POST',
		headers: applyRouteExtraHeaders(
			{
				Authorization: `Bearer ${secret}`,
				'Content-Type': 'application/json',
			},
			route.customParams
		),
		body: JSON.stringify(
			buildRouteRequestBody(route, {
				model: route.providerModelName,
				input: request.input,
				voice: request.voice,
				response_format: request.responseFormat,
				speed: request.speed,
				stream_format: request.streamFormat,
				...(request.instructions ? { instructions: request.instructions } : {}),
			})
		),
		signal: requestSignal,
	});
	timing?.markAttemptHeaders(attempt, response.status);
	const upstreamRequestId = extractUpstreamRequestId(response.headers);
	if (!response.ok || !response.body) {
		return { response, usagePromise: Promise.resolve(EMPTY_USAGE), upstreamRequestId };
	}
	const wrapped = wrapOpenAiSpeechBody(response.body, request.streamFormat, timing);
	return {
		response: new Response(wrapped.body, {
			status: response.status,
			statusText: response.statusText,
			headers: copyResponseHeaders(response.headers),
		}),
		usagePromise: wrapped.usagePromise,
		upstreamRequestId,
	};
}

export function dispatchDashScopeSpeechSynthesizer(
	route: RouteResult,
	request: NormalizedAudioSpeechRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: AudioSpeechDispatchOptions
): Promise<SpeechDispatchResult> {
	return dispatchDashScopeTts(route, request, 'speech', requestSignal, timing, attempt, options);
}

export function dispatchDashScopeQwenTts(
	route: RouteResult,
	request: NormalizedAudioSpeechRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: AudioSpeechDispatchOptions
): Promise<SpeechDispatchResult> {
	return dispatchDashScopeTts(route, request, 'qwen', requestSignal, timing, attempt, options);
}

export function dispatchDashScopeMiniMaxTts(
	route: RouteResult,
	request: NormalizedAudioSpeechRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: AudioSpeechDispatchOptions
): Promise<SpeechDispatchResult> {
	return dispatchDashScopeTts(route, request, 'minimax', requestSignal, timing, attempt, options);
}

export function redactAudioSpeechRequestForLog(
	model: string,
	request: NormalizedAudioSpeechRequest
): Record<string, unknown> {
	return {
		model,
		input_characters: Array.from(request.input).length,
		voice: voiceId(request.voice),
		response_format: request.responseFormat,
		speed: request.speed,
		stream_format: request.streamFormat,
		has_instructions: Boolean(request.instructions),
	};
}
