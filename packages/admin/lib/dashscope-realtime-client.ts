import { buildDashScopeRealtimeAuthProtocol } from '@octafuse/core/realtime-protocol';

export const DASHSCOPE_REALTIME_OPERATIONS = [
	'audio.transcriptions.realtime.inference',
	'audio.transcriptions.realtime.session',
	'audio.speech.realtime.inference',
] as const;

export type DashScopeRealtimeOperation = (typeof DASHSCOPE_REALTIME_OPERATIONS)[number];

export function isDashScopeRealtimeOperation(value: string): value is DashScopeRealtimeOperation {
	return (DASHSCOPE_REALTIME_OPERATIONS as readonly string[]).includes(value);
}

/** DashScope 的 Qwen-Audio-TTS 与 CosyVoice 音色集合不同，按供应商模型选择默认音色。 */
export function dashScopeTtsVoiceForModel(providerModelName?: string | null): string {
	const model = providerModelName?.trim().toLowerCase() ?? '';
	// CosyVoice 音色与模型版本严格绑定；v2 不能使用 Qwen-Audio-TTS 的音色。
	if (model === 'cosyvoice-v2') return 'longxiaochun_v2';
	if (model === 'cosyvoice-v1') return 'longxiaochun';
	// v3.5 仅支持复刻/设计音色（无系统音色）；模板仍填占位，调试前需换成已创建的 voice id。
	if (
		model === 'cosyvoice-v3-flash' ||
		model === 'cosyvoice-v3-plus' ||
		model === 'cosyvoice-v3.5-flash' ||
		model === 'cosyvoice-v3.5-plus'
	) {
		return 'longanyang';
	}
	if (model.startsWith('qwen-audio-3.0-tts-plus')) return 'longanlingxin';
	if (model.startsWith('qwen-audio-3.0-tts-flash')) return 'longanhuan_v3.6';
	return 'longanlingxi';
}

function isSessionOperation(operation: DashScopeRealtimeOperation): boolean {
	return operation.endsWith('.session');
}

function isTranscriptionOperation(operation: DashScopeRealtimeOperation): boolean {
	return operation.startsWith('audio.transcriptions.');
}

export function buildDashScopeRealtimeAsrTemplate(
	operation: DashScopeRealtimeOperation = 'audio.transcriptions.realtime.inference',
): string {
	if (isSessionOperation(operation)) {
		return JSON.stringify(
			{
				event_id: crypto.randomUUID(),
				type: 'session.update',
				session: {
					input_audio_format: 'pcm',
					sample_rate: 16000,
					input_audio_transcription: {},
					turn_detection: { type: 'server_vad' },
				},
			},
			null,
			2,
		);
	}
	const taskId = crypto.randomUUID();
	return JSON.stringify(
		{
			header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
			payload: {
				task_group: 'audio',
				task: 'asr',
				function: 'recognition',
				model: '<auto>',
				parameters: { format: 'pcm', sample_rate: 16000 },
				input: {},
			},
		},
		null,
		2,
	);
}

/**
 * DashScope 的 Qwen-Audio-TTS 与 CosyVoice 使用不同的系统音色集合。
 * 调试台按供应商模型选择默认音色，避免把 Qwen 音色发给 CosyVoice 后由上游返回 InvalidParameter。
 */
export function buildDashScopeRealtimeTtsTemplate(providerModelName?: string | null): string {
	// CosyVoice/Qwen-Audio-TTS 实时接口走 inference 任务协议；文本会在
	// task-started 后由客户端转换为 continue-task 发送，不能使用 session.update。
	const voice = dashScopeTtsVoiceForModel(providerModelName);
	return JSON.stringify(
		{
			header: {
				action: 'run-task',
				task_id: crypto.randomUUID(),
				streaming: 'duplex',
			},
			payload: {
				task_group: 'audio',
				task: 'tts',
				function: 'SpeechSynthesizer',
				model: '<auto>',
				parameters: {
					text_type: 'PlainText',
					voice,
					format: 'mp3',
					sample_rate: 22050,
					volume: 50,
					rate: 1,
					pitch: 1,
					enable_ssml: false,
				},
				// 调试台约定：这里的 text 只作为编辑器输入，发送时会移入 continue-task。
				input: { text: '你好，欢迎使用 OctaFuse Gateway。' },
			},
		},
		null,
		2,
	);
}

/** 生成 DashScope 非实时 TTS 的 OpenAI 兼容请求模板，供调试台直接填写。 */
export function buildDashScopeSpeechBodyTemplate(providerModelName?: string | null): string {
	return JSON.stringify(
		{
			model: '<auto>',
			input: '你好，欢迎使用 OctaFuse Gateway。',
			voice: dashScopeTtsVoiceForModel(providerModelName),
			response_format: 'wav',
			speed: 1,
		},
		null,
		2,
	);
}

export type DashScopeRealtimeClientOptions = {
	url: string;
	operation: DashScopeRealtimeOperation;
	/** 模拟器连接 Proxy 时传网关 Key；调试台同源管理员入口不传。 */
	apiKey?: string;
	initialMessage: string;
	/** 实时 TTS 输出的二进制音频分片。 */
	onAudioChunk?: (chunk: ArrayBuffer) => void;
	audioFile?: File | null;
	/** Fun-ASR / Qwen-Audio ASR 使用文件或浏览器麦克风作为实时输入。 */
	audioInput?: 'file' | 'microphone';
	audioChunkBytes?: number;
	audioChunkIntervalMs?: number;
	onOpen?: () => void;
	onMessage?: (message: string | ArrayBuffer) => void;
	onError?: (error: Event | Error) => void;
	onClose?: (event: CloseEvent) => void;
};

function parseJsonMessage(message: string): Record<string, unknown> | null {
	try {
		const value = JSON.parse(message) as unknown;
		return value != null && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function eventName(value: Record<string, unknown>): string {
	const header = value.header;
	if (header != null && typeof header === 'object' && !Array.isArray(header)) {
		const object = header as Record<string, unknown>;
		if (typeof object.event === 'string') return object.event;
		if (typeof object.action === 'string') return object.action;
	}
	return typeof value.type === 'string' ? value.type : '';
}

function finishTaskMessage(initialMessage: string): string | null {
	const initial = parseJsonMessage(initialMessage);
	const header = initial?.header;
	if (header == null || typeof header !== 'object' || Array.isArray(header)) return null;
	const object = header as Record<string, unknown>;
	if (object.action !== 'run-task' || typeof object.task_id !== 'string' || !object.task_id) {
		return null;
	}
	return JSON.stringify({
		header: {
			action: 'finish-task',
			task_id: object.task_id,
			streaming: typeof object.streaming === 'string' ? object.streaming : 'duplex',
		},
		payload: { input: {} },
	});
}

function finishTaskMessageForId(taskId: string, directive?: 'cancel'): string {
	return JSON.stringify({
		header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
		payload: { input: directive ? { directive } : {} },
	});
}

function prepareRealtimeTtsStart(initialMessage: string): {
	startMessage: string;
	taskId: string;
	text: string;
} {
	const initial = parseJsonMessage(initialMessage);
	const header = initial?.header;
	const payload = initial?.payload;
	const input =
		payload != null && typeof payload === 'object' && !Array.isArray(payload)
			? (payload as Record<string, unknown>).input
			: null;
	const taskId =
		header != null && typeof header === 'object' && !Array.isArray(header)
			? (header as Record<string, unknown>).task_id
			: null;
	const text =
		input != null && typeof input === 'object' && !Array.isArray(input)
			? (input as Record<string, unknown>).text
			: null;
	if (
		!header ||
		typeof header !== 'object' ||
		Array.isArray(header) ||
		(header as Record<string, unknown>).action !== 'run-task' ||
		typeof taskId !== 'string' ||
		!taskId ||
		!payload ||
		typeof payload !== 'object' ||
		Array.isArray(payload) ||
		typeof text !== 'string' ||
		!text.trim()
	) {
		throw new Error('实时语音合成需要 run-task.payload.input.text');
	}
	return {
		startMessage: JSON.stringify({
			...initial,
			payload: { ...(payload as Record<string, unknown>), input: {} },
		}),
		taskId,
		text,
	};
}

function continueTaskMessage(taskId: string, text: string): string {
	return JSON.stringify({
		header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
		payload: { input: { text } },
	});
}

/** 根据实时 TTS 的 format 选择浏览器播放类型。 */
export function dashScopeRealtimeAudioContentType(initialMessage: string): string {
	const initial = parseJsonMessage(initialMessage);
	const payload = initial?.payload;
	const parameters =
		payload != null && typeof payload === 'object' && !Array.isArray(payload)
			? (payload as Record<string, unknown>).parameters
			: null;
	const format =
		parameters != null && typeof parameters === 'object' && !Array.isArray(parameters)
			? (parameters as Record<string, unknown>).format
			: null;
	if (format === 'wav') return 'audio/wav';
	if (format === 'opus') return 'audio/ogg';
	if (format === 'pcm') return 'audio/pcm';
	return 'audio/mpeg';
}

function finishSessionMessage(): string {
	return JSON.stringify({
		event_id: crypto.randomUUID(),
		type: 'session.finish',
	});
}

/** 会话接口要求把每个 PCM 分片包装成带 Base64 音频的 JSON 事件。 */
function encodeBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

/** 将浏览器原生采样率的 Float32 音频转换为 DashScope 需要的 16-bit PCM。 */
function encodePcm16(samples: Float32Array, sourceSampleRate: number): Uint8Array {
	const targetSampleRate = 16_000;
	const ratio = sourceSampleRate / targetSampleRate;
	const targetLength = Math.floor(samples.length / ratio);
	const output = new Uint8Array(targetLength * 2);
	const view = new DataView(output.buffer);
	for (let index = 0; index < targetLength; index += 1) {
		const sourceIndex = Math.min(Math.floor(index * ratio), samples.length - 1);
		const sample = Math.max(-1, Math.min(1, samples[sourceIndex] ?? 0));
		view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
	}
	return output;
}

const realtimeFinishers = new WeakMap<WebSocket, () => void>();

/** 停止实时输入并发送对应生命周期的结束事件；由调试台和模拟器的“停止”按钮调用。 */
export function stopDashScopeRealtimeClient(socket: WebSocket): void {
	const finish = realtimeFinishers.get(socket);
	if (finish) finish();
	else socket.close(1000, 'stopped');
}

/** 建立浏览器侧实时连接，并按任务或会话生命周期发送音频。 */
export function openDashScopeRealtimeClient(options: DashScopeRealtimeClientOptions): WebSocket {
	const audioInput = options.audioInput ?? 'file';
	const sessionMode = isSessionOperation(options.operation);
	const transcriptionMode = isTranscriptionOperation(options.operation);
	if (!transcriptionMode && sessionMode) {
		throw new Error('Qwen-Audio-TTS/CosyVoice 实时合成只支持 inference 任务模式');
	}
	const ttsStart = transcriptionMode ? null : prepareRealtimeTtsStart(options.initialMessage);
	const startMessage = ttsStart?.startMessage ?? options.initialMessage;
	const finishMessage = transcriptionMode
		? sessionMode
			? finishSessionMessage()
			: audioInput === 'microphone' || options.audioFile
			? finishTaskMessage(options.initialMessage)
			: null
		: finishTaskMessageForId(ttsStart!.taskId);
	const protocols = options.apiKey ? [buildDashScopeRealtimeAuthProtocol(options.apiKey)] : undefined;
	const socket = new WebSocket(options.url, protocols);
	socket.binaryType = 'arraybuffer';
	let audioTimer: number | null = null;
	let audioStarted = false;
	let finishSent = false;
	let microphoneStream: MediaStream | null = null;
	let microphoneContext: AudioContext | null = null;
	let microphoneSource: MediaStreamAudioSourceNode | null = null;
	let microphoneProcessor: ScriptProcessorNode | null = null;
	let microphoneBuffer = new Uint8Array(0);
	let taskStarted = false;

	const clearAudioTimer = () => {
		if (audioTimer != null) {
			window.clearInterval(audioTimer);
			audioTimer = null;
		}
	};

	const cleanupMicrophone = () => {
		microphoneProcessor?.disconnect();
		microphoneSource?.disconnect();
		microphoneProcessor = null;
		microphoneSource = null;
		for (const track of microphoneStream?.getTracks() ?? []) track.stop();
		microphoneStream = null;
		if (microphoneContext && microphoneContext.state !== 'closed') {
			void microphoneContext.close();
		}
		microphoneContext = null;
		microphoneBuffer = new Uint8Array(0);
	};

	const sendPcmFrames = (bytes: Uint8Array) => {
		const merged = new Uint8Array(microphoneBuffer.length + bytes.length);
		merged.set(microphoneBuffer);
		merged.set(bytes, microphoneBuffer.length);
		microphoneBuffer = merged;
		const chunkSize = options.audioChunkBytes ?? 3200;
		while (microphoneBuffer.byteLength >= chunkSize) {
			if (socket.readyState !== WebSocket.OPEN) return;
			sendAudioFrame(microphoneBuffer.slice(0, chunkSize));
			microphoneBuffer = microphoneBuffer.slice(chunkSize);
		}
	};

	const flushPcmFrames = () => {
		if (socket.readyState === WebSocket.OPEN && microphoneBuffer.byteLength > 0) {
			sendAudioFrame(microphoneBuffer);
		}
		microphoneBuffer = new Uint8Array(0);
	};

	const sendAudioFrame = (frame: Uint8Array) => {
		if (sessionMode) {
			socket.send(
				JSON.stringify({
					event_id: crypto.randomUUID(),
					type: 'input_audio_buffer.append',
					audio: encodeBase64(frame),
				}),
			);
		} else {
			socket.send(frame);
		}
	};

	const reportError = (error: Error) => {
		clearAudioTimer();
		cleanupMicrophone();
		options.onError?.(error);
		if (socket.readyState < WebSocket.CLOSING) socket.close(1011, error.message.slice(0, 123));
	};

	const startMicrophone = async () => {
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error('当前浏览器不支持麦克风采集');
		}
		// Web Audio 输出的采样率由设备决定，这里统一重采样为 DashScope 的 16 kHz PCM。
		microphoneStream = await navigator.mediaDevices.getUserMedia({
			audio: {
				channelCount: 1,
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			},
		});
		microphoneContext = new AudioContext();
		await microphoneContext.resume();
		microphoneSource = microphoneContext.createMediaStreamSource(microphoneStream);
		microphoneProcessor = microphoneContext.createScriptProcessor(4096, 1, 1);
		microphoneProcessor.onaudioprocess = (event) => {
			const input = event.inputBuffer.getChannelData(0);
			sendPcmFrames(encodePcm16(input, microphoneContext?.sampleRate ?? 16_000));
			// ScriptProcessor 需要连接输出节点才能持续触发；输出静音，避免麦克风回放。
			event.outputBuffer.getChannelData(0).fill(0);
		};
		microphoneSource.connect(microphoneProcessor);
		microphoneProcessor.connect(microphoneContext.destination);
	};

	const finishAudio = () => {
		clearAudioTimer();
		if (!taskStarted || !finishMessage || finishSent) {
			if (socket.readyState < WebSocket.CLOSING) socket.close(1000, 'stopped');
			return;
		}
		if (!transcriptionMode) {
			finishSent = true;
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(finishTaskMessageForId(ttsStart!.taskId, 'cancel'));
			}
			return;
		}
		if (audioInput === 'microphone') {
			flushPcmFrames();
			cleanupMicrophone();
		}
		if (socket.readyState === WebSocket.OPEN) {
			finishSent = true;
			socket.send(finishMessage);
		}
	};

	const sendAudio = async () => {
		if (audioStarted) return;
		audioStarted = true;
		if (!transcriptionMode) {
			if (socket.readyState !== WebSocket.OPEN) return;
			socket.send(continueTaskMessage(ttsStart!.taskId, ttsStart!.text));
			if (!finishSent) {
				finishSent = true;
				socket.send(finishTaskMessageForId(ttsStart!.taskId));
			}
			return;
		}
		if (audioInput === 'microphone') {
			await startMicrophone();
			return;
		}
		if (!options.audioFile) return;
		const bytes = new Uint8Array(await options.audioFile.arrayBuffer());
		const chunkSize = options.audioChunkBytes ?? 3200;
		const interval = options.audioChunkIntervalMs ?? 20;
		let offset = 0;
		audioTimer = window.setInterval(() => {
			if (socket.readyState !== WebSocket.OPEN) {
				clearAudioTimer();
				return;
			}
			if (offset >= bytes.byteLength) {
				clearAudioTimer();
				if (finishMessage && !finishSent && socket.readyState === WebSocket.OPEN) {
					finishSent = true;
					socket.send(finishMessage);
				}
				return;
			}
			const end = Math.min(offset + chunkSize, bytes.byteLength);
			sendAudioFrame(bytes.slice(offset, end));
			offset = end;
		}, interval);
	};

	realtimeFinishers.set(socket, finishAudio);

	socket.addEventListener('open', () => {
		socket.send(startMessage);
		options.onOpen?.();
	});
	socket.addEventListener('message', (event) => {
		if (typeof event.data === 'string') {
			options.onMessage?.(event.data);
			const parsed = parseJsonMessage(event.data);
			if (
				parsed &&
				((sessionMode && eventName(parsed) === 'session.updated') ||
					(!sessionMode && eventName(parsed) === 'task-started'))
			) {
				taskStarted = true;
				void sendAudio().catch((error: unknown) => {
					reportError(error instanceof Error ? error : new Error('麦克风采集失败'));
				});
			}
			if (
				parsed &&
				((sessionMode && eventName(parsed) === 'session.finished') ||
					(!sessionMode && eventName(parsed) === 'task-finished'))
			) {
				clearAudioTimer();
				cleanupMicrophone();
				socket.close(1000, 'realtime finished');
			}
			return;
		}
		if (event.data instanceof ArrayBuffer) {
			options.onAudioChunk?.(event.data);
			options.onMessage?.(event.data);
		}
	});
	socket.addEventListener('error', (event) => {
		clearAudioTimer();
		cleanupMicrophone();
		options.onError?.(event);
	});
	socket.addEventListener('close', (event) => {
		clearAudioTimer();
		cleanupMicrophone();
		realtimeFinishers.delete(socket);
		options.onClose?.(event);
	});

	return socket;
}

export function dashScopeRealtimeEventName(message: string): string {
	const parsed = parseJsonMessage(message);
	return parsed ? eventName(parsed) : '';
}
