/**
 * ElevenLabs 实时 WebSocket 的浏览器侧客户端（调试台与模拟器共用）：
 * - `audio.transcriptions.realtime`：Scribe 实时转写，浏览器麦克风（默认）或音频文件 → 16 kHz PCM → `input_audio_chunk`。
 * - `audio.speech.realtime`：单路 `stream-input` 语音合成，文本 → 首帧 + 文本帧 + 结束帧，音频 base64 帧解码后回调。
 *
 * 编辑器里的 body 是「参数袋」：路径参数（voice_id）与 query 参数在 `prepareElevenLabsRealtimeRequest` 拆出，
 * 调用方据此拼 URL；TTS 的其余字段进首帧（voice_settings、generation_config 等）。
 */
import { buildDashScopeRealtimeAuthProtocol } from '@octafuse/core/realtime-protocol';
import { isValidElevenLabsVoiceId } from '@octafuse/core/elevenlabs-native';
import { startMicrophonePcm16, type MicrophoneCapture } from '@/lib/browser-microphone';
import { decodeAudioFileToPcm16, encodeBase64, stopDashScopeRealtimeClient } from '@/lib/dashscope-realtime-client';

export const ELEVENLABS_REALTIME_OPERATIONS = [
	'audio.transcriptions.realtime',
	'audio.speech.realtime',
] as const;

export type ElevenLabsRealtimeOperation = (typeof ELEVENLABS_REALTIME_OPERATIONS)[number];

export function isElevenLabsRealtimeOperation(
	value: string | null | undefined,
): value is ElevenLabsRealtimeOperation {
	return (ELEVENLABS_REALTIME_OPERATIONS as readonly string[]).includes(value ?? '');
}

export function isElevenLabsRealtimeTranscription(operation: string | null | undefined): boolean {
	return operation === 'audio.transcriptions.realtime';
}

/** 实时 ASR 默认麦克风；实时 TTS 没有音频输入。 */
export function defaultAudioInputModeForElevenLabsOperation(
	operation: string | null | undefined,
): 'file' | 'microphone' {
	return isElevenLabsRealtimeTranscription(operation) ? 'microphone' : 'file';
}

/** 浏览器端固定编码成 16 kHz / 16-bit PCM，所以 `audio_format` 由客户端强制，不读编辑器。 */
export const ELEVENLABS_REALTIME_STT_AUDIO_FORMAT = 'pcm_16000';
const STT_SAMPLE_RATE = 16_000;
const DEFAULT_TTS_OUTPUT_FORMAT = 'mp3_44100_128';

/** 实时转写参数全部走 query；`vad` 让麦克风说话时自动出 committed 文本。 */
export const ELEVENLABS_REALTIME_ASR_BODY_TEMPLATE = `{
  "commit_strategy": "vad",
  "language_code": "",
  "include_timestamps": false
}`;

/** TTS：voice_id 进路径，output_format 等进 query，text 是要朗读的内容，其余字段进首帧。 */
export const ELEVENLABS_REALTIME_TTS_BODY_TEMPLATE = `{
  "voice_id": "JBFqnCBsd6RMkjVDRZzb",
  "output_format": "mp3_44100_128",
  "text": "你好，欢迎使用 OctaFuse Gateway。",
  "voice_settings": {
    "stability": 0.5,
    "similarity_boost": 0.75
  }
}`;

export function buildElevenLabsRealtimeTemplate(operation: string | null | undefined): string {
	return isElevenLabsRealtimeTranscription(operation)
		? ELEVENLABS_REALTIME_ASR_BODY_TEMPLATE
		: ELEVENLABS_REALTIME_TTS_BODY_TEMPLATE;
}

/** 这些 key 在 TTS 的 query 里生效，其余留在首帧。 */
const TTS_QUERY_KEYS = new Set([
	'output_format',
	'language_code',
	'enable_logging',
	'enable_ssml_parsing',
	'inactivity_timeout',
	'sync_alignment',
	'auto_mode',
	'apply_text_normalization',
	'seed',
]);

/** 模型由路由 / `model_id` query 决定，编辑器里的同名字段一律忽略。 */
const IGNORED_BODY_KEYS = new Set(['model', 'model_id', 'variant']);

export type ElevenLabsRealtimeRequest = {
	operation: ElevenLabsRealtimeOperation;
	/** 不含 `model_id`；调用方负责加。 */
	query: Record<string, string>;
	/** 仅 TTS：路径参数。 */
	voiceId?: string;
	/** 仅 TTS：连接建立后的首帧（`text` 固定为 `" "`）。 */
	initFrame?: Record<string, unknown>;
	/** 仅 TTS：要朗读的文本。 */
	text?: string;
};

function scalarToQuery(value: unknown): string | null {
	if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value === 'boolean') return String(value);
	return null;
}

/** 把编辑器 body 拆成 URL 参数与帧内容；缺 voice_id / text 等必填项直接抛错。 */
export function prepareElevenLabsRealtimeRequest(
	operation: ElevenLabsRealtimeOperation,
	body: Record<string, unknown>,
): ElevenLabsRealtimeRequest {
	if (isElevenLabsRealtimeTranscription(operation)) {
		const query: Record<string, string> = {};
		for (const [key, value] of Object.entries(body)) {
			if (IGNORED_BODY_KEYS.has(key) || key === 'audio_format' || key === 'voice_id') continue;
			const text = scalarToQuery(value);
			if (text != null) query[key] = text;
		}
		query.audio_format = ELEVENLABS_REALTIME_STT_AUDIO_FORMAT;
		return { operation, query };
	}

	const voiceId = typeof body.voice_id === 'string' ? body.voice_id.trim() : '';
	if (!isValidElevenLabsVoiceId(voiceId)) {
		throw new Error('ElevenLabs 实时语音合成需要 body.voice_id');
	}
	const text = typeof body.text === 'string' ? body.text : '';
	if (!text.trim()) throw new Error('ElevenLabs 实时语音合成需要非空的 body.text');
	const query: Record<string, string> = {};
	const initFrame: Record<string, unknown> = { text: ' ' };
	for (const [key, value] of Object.entries(body)) {
		if (IGNORED_BODY_KEYS.has(key) || key === 'voice_id' || key === 'text') continue;
		if (TTS_QUERY_KEYS.has(key)) {
			const asQuery = scalarToQuery(value);
			if (asQuery != null) query[key] = asQuery;
			continue;
		}
		initFrame[key] = value;
	}
	return { operation, voiceId, query, initFrame, text };
}

/** 播放用的输出格式（TTS）；缺省与模板一致。 */
export function elevenLabsRealtimeOutputFormat(request: Pick<ElevenLabsRealtimeRequest, 'query'>): string {
	return request.query.output_format?.trim() || DEFAULT_TTS_OUTPUT_FORMAT;
}

function wavHeader(dataBytes: number, sampleRate: number): Uint8Array {
	const header = new Uint8Array(44);
	const view = new DataView(header.buffer);
	const writeText = (offset: number, text: string) => {
		for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
	};
	writeText(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	writeText(8, 'WAVE');
	writeText(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeText(36, 'data');
	view.setUint32(40, dataBytes, true);
	return header;
}

/** 把 TTS 音频分片拼成可播放的 Blob：`pcm_N` 补 WAV 头，其余按容器类型标注。 */
export function elevenLabsRealtimeAudioBlob(chunks: ArrayBuffer[], outputFormat: string): Blob {
	const format = outputFormat.trim().toLowerCase();
	const pcm = /^pcm_(\d+)$/.exec(format);
	if (pcm) {
		const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
		return new Blob([wavHeader(total, Number(pcm[1])) as BlobPart, ...chunks], { type: 'audio/wav' });
	}
	if (format.startsWith('mp3_')) return new Blob(chunks, { type: 'audio/mpeg' });
	if (format.startsWith('opus_')) return new Blob(chunks, { type: 'audio/ogg' });
	return new Blob(chunks, { type: 'audio/basic' });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	try {
		const value = JSON.parse(text) as unknown;
		return value != null && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function base64ByteLength(value: string): number {
	if (!value) return 0;
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function decodeBase64(value: string): ArrayBuffer {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes.buffer;
}

/** 响应区展示用：音频 base64 折叠成字节数，避免一条帧撑满整页。 */
export function summarizeElevenLabsRealtimeMessage(raw: string): string {
	const parsed = parseJsonObject(raw);
	if (!parsed || typeof parsed.audio !== 'string') return raw;
	return JSON.stringify({ ...parsed, audio: `[base64 ${base64ByteLength(parsed.audio)} bytes]` });
}

function isCommittedTranscript(type: string): boolean {
	return type === 'committed_transcript' || type === 'committed_transcript_with_timestamps';
}

export type ElevenLabsRealtimeClientOptions = {
	/** 完整 WebSocket URL（含 query）；模拟器直连 Proxy，调试台走管理端转发。 */
	url: string;
	operation: ElevenLabsRealtimeOperation;
	/** 模拟器连接 Proxy 时传网关 Key（走 Sec-WebSocket-Protocol）；调试台同源不传。 */
	apiKey?: string;
	/** 编辑器里的 body，用来取 TTS 的首帧与文本。 */
	body: Record<string, unknown>;
	audioInput?: 'file' | 'microphone';
	audioFile?: File | null;
	audioChunkBytes?: number;
	audioChunkIntervalMs?: number;
	onOpen?: () => void;
	/** 文本帧；TTS 的 base64 音频已折叠成字节数。 */
	onMessage?: (message: string) => void;
	/** TTS 解码后的音频分片。 */
	onAudioChunk?: (chunk: ArrayBuffer) => void;
	onError?: (error: Event | Error) => void;
	onClose?: (event: CloseEvent) => void;
};

/** 提交后等待最终转写的兜底时间，避免连接悬挂。 */
const COMMIT_FALLBACK_CLOSE_MS = 8_000;
const finishers = new WeakMap<WebSocket, () => void>();

/**
 * 停止实时输入：转写会冲刷缓冲并提交，等最终文本后关闭；合成直接关闭。
 * 返回 false 表示该连接不是 ElevenLabs 客户端建立的，调用方应改用其它客户端的停止方法。
 */
export function stopElevenLabsRealtimeClient(socket: WebSocket): boolean {
	const finish = finishers.get(socket);
	if (!finish) return false;
	finish();
	return true;
}

/** 停止调试台 / 模拟器里任意实时连接（ElevenLabs 或 DashScope）。 */
export function stopRealtimeClient(socket: WebSocket): void {
	if (!stopElevenLabsRealtimeClient(socket)) stopDashScopeRealtimeClient(socket);
}

/**
 * 从响应区累积的 NDJSON 里还原实时转写文本：已提交句子逐行列出，末尾附上尚未提交的 partial。
 * 开启 `include_timestamps` 时同一句可能先后以两种 committed 事件出现，相邻重复只保留一次。
 */
export function extractElevenLabsRealtimeTranscript(responseText: string): string {
	const committed: string[] = [];
	let partial = '';
	for (const line of responseText.split('\n')) {
		const parsed = parseJsonObject(line.trim());
		if (!parsed || typeof parsed.message_type !== 'string') continue;
		const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
		if (isCommittedTranscript(parsed.message_type)) {
			partial = '';
			if (text && committed[committed.length - 1] !== text) committed.push(text);
		} else if (parsed.message_type === 'partial_transcript') {
			partial = text;
		}
	}
	return [...committed, ...(partial ? [`${partial} …`] : [])].join('\n');
}

/** 建立浏览器侧 ElevenLabs 实时连接，并按操作类型驱动帧生命周期。 */
export function openElevenLabsRealtimeClient(options: ElevenLabsRealtimeClientOptions): WebSocket {
	const transcription = isElevenLabsRealtimeTranscription(options.operation);
	const request = prepareElevenLabsRealtimeRequest(options.operation, options.body);
	const audioInput = options.audioInput ?? 'microphone';
	const chunkBytes = options.audioChunkBytes ?? 3200;
	const chunkIntervalMs = options.audioChunkIntervalMs ?? 100;
	const protocols = options.apiKey ? [buildDashScopeRealtimeAuthProtocol(options.apiKey)] : undefined;
	const socket = new WebSocket(options.url, protocols);

	let audioTimer: number | null = null;
	let fallbackTimer: number | null = null;
	let microphone: MicrophoneCapture | null = null;
	let pending = new Uint8Array(0);
	let sessionStarted = false;
	let finishSent = false;
	let closed = false;

	const clearTimers = () => {
		if (audioTimer != null) window.clearInterval(audioTimer);
		if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
		audioTimer = null;
		fallbackTimer = null;
	};
	const stopMicrophone = () => {
		microphone?.stop();
		microphone = null;
	};
	const closeSocket = (code: number, reason: string) => {
		if (socket.readyState < WebSocket.CLOSING) socket.close(code, reason.slice(0, 123));
	};
	const sendJson = (value: Record<string, unknown>) => {
		if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
	};
	const sendAudioChunk = (pcm: Uint8Array, commit = false) => {
		sendJson({
			message_type: 'input_audio_chunk',
			audio_base_64: encodeBase64(pcm),
			sample_rate: STT_SAMPLE_RATE,
			...(commit ? { commit: true } : {}),
		});
	};
	const pushPcm = (bytes: Uint8Array) => {
		const merged = new Uint8Array(pending.length + bytes.length);
		merged.set(pending);
		merged.set(bytes, pending.length);
		pending = merged;
		while (pending.byteLength >= chunkBytes) {
			if (socket.readyState !== WebSocket.OPEN) return;
			sendAudioChunk(pending.slice(0, chunkBytes));
			pending = pending.slice(chunkBytes);
		}
	};

	/** 提交剩余音频，等 committed 文本后关闭（兜底超时也会关）。 */
	const commitAndWait = () => {
		if (finishSent) return;
		finishSent = true;
		clearTimers();
		stopMicrophone();
		if (socket.readyState !== WebSocket.OPEN) return;
		sendAudioChunk(pending, true);
		pending = new Uint8Array(0);
		fallbackTimer = window.setTimeout(() => closeSocket(1000, 'commit timeout'), COMMIT_FALLBACK_CLOSE_MS);
	};

	const startTranscription = async () => {
		if (audioInput === 'microphone') {
			microphone = await startMicrophonePcm16(pushPcm);
			return;
		}
		if (!options.audioFile) throw new Error('实时转写需要音频文件或麦克风');
		const bytes = await decodeAudioFileToPcm16(options.audioFile);
		let offset = 0;
		audioTimer = window.setInterval(() => {
			if (socket.readyState !== WebSocket.OPEN) {
				clearTimers();
				return;
			}
			if (offset >= bytes.byteLength) {
				commitAndWait();
				return;
			}
			const end = Math.min(offset + chunkBytes, bytes.byteLength);
			sendAudioChunk(bytes.slice(offset, end));
			offset = end;
		}, chunkIntervalMs);
	};

	const startSynthesis = () => {
		sendJson(request.initFrame ?? { text: ' ' });
		// 文本末尾补空格是官方推荐写法，便于服务端在词边界切分。
		sendJson({ text: `${request.text ?? ''} ` });
		sendJson({ text: '' });
	};

	const reportError = (error: Error) => {
		clearTimers();
		stopMicrophone();
		options.onError?.(error);
		closeSocket(1011, error.message);
	};

	finishers.set(socket, () => {
		if (transcription && sessionStarted) commitAndWait();
		else {
			clearTimers();
			stopMicrophone();
			closeSocket(1000, 'stopped');
		}
	});

	socket.binaryType = 'arraybuffer';
	socket.addEventListener('open', () => {
		options.onOpen?.();
		// 合成无需等服务端确认；转写要等 session_started 再送音频。
		if (!transcription) startSynthesis();
	});
	socket.addEventListener('message', (event) => {
		if (typeof event.data !== 'string') return;
		const parsed = parseJsonObject(event.data);
		if (!parsed) {
			options.onMessage?.(event.data);
			return;
		}
		options.onMessage?.(summarizeElevenLabsRealtimeMessage(event.data));
		if (typeof parsed.audio === 'string' && parsed.audio) {
			try {
				options.onAudioChunk?.(decodeBase64(parsed.audio));
			} catch {
				// 非法 base64 只丢这一帧，不拆连接。
			}
		}
		if (transcription) {
			const type = typeof parsed.message_type === 'string' ? parsed.message_type : '';
			if (type === 'session_started' && !sessionStarted) {
				sessionStarted = true;
				void startTranscription().catch((error: unknown) =>
					reportError(error instanceof Error ? error : new Error('麦克风采集失败')),
				);
			} else if (finishSent && (isCommittedTranscript(type) || type.endsWith('_error') || type === 'error')) {
				closeSocket(1000, 'realtime finished');
			}
		} else if (parsed.isFinal === true) {
			closeSocket(1000, 'realtime finished');
		}
	});
	socket.addEventListener('error', (event) => {
		clearTimers();
		stopMicrophone();
		options.onError?.(event);
	});
	socket.addEventListener('close', (event) => {
		if (closed) return;
		closed = true;
		clearTimers();
		stopMicrophone();
		finishers.delete(socket);
		options.onClose?.(event);
	});

	return socket;
}
