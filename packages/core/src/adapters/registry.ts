/**
 * Adapter Registry：配置层稳定 ID + 多模态元数据的单一来源。
 * `adapter` 是 route target 上的配置 ID；运行时实现叫 driver，一个 driver 可服务多个 adapter。
 */
import type { UpstreamProtocol } from '../upstream-protocol';

export const PASSTHROUGH_ROUTE_ADAPTER = 'passthrough';

export const DASHSCOPE_MULTIMODAL_GENERATION_PATH =
	'/v1/dashscope/services/aigc/multimodal-generation/generation';

/** DashScope SpeechSynthesizer 透传：非流式与 SSE 共用这条路径，用 `X-DashScope-SSE` 区分。 */
export const DASHSCOPE_SPEECH_SYNTHESIZER_PATH =
	'/v1/dashscope/services/audio/tts/SpeechSynthesizer';

/** DashScope 异步文件转写提交。任务查询是 `GET /v1/dashscope/tasks/:taskId`。 */
export const DASHSCOPE_FILE_TRANSCRIPTION_PATH =
	'/v1/dashscope/services/audio/asr/transcription';

export const DASHSCOPE_TASKS_PATH = '/v1/dashscope/tasks';

/** MiniMax 原生文件转写透传：`POST /v1/minimax/speech_to_text`。 */
export const MINIMAX_SPEECH_TO_TEXT_PATH = '/v1/minimax/speech_to_text';

/** MiniMax 同步语音合成透传：`POST /v1/minimax/t2a_v2`。非流式与 SSE 共用这条路径。 */
export const MINIMAX_T2A_PATH = '/v1/minimax/t2a_v2';

/** MiniMax 文生图 / 图生图透传：`POST /v1/minimax/image_generation`。 */
export const MINIMAX_IMAGE_GENERATION_PATH = '/v1/minimax/image_generation';

export const SURFACE_PATH_MODEL_PLACEHOLDER = '{model}';

export type AdapterModality = 'text' | 'image' | 'audio' | 'video' | 'embedding';
export type AdapterModelKind = 'llm' | 'image' | 'audio.transcription' | 'audio.speech';
export type AdapterExchange = 'unary' | 'sse' | 'websocket' | 'job';
export type AdapterBilling = 'tokens' | 'per_image' | 'per_second' | 'per_character' | 'per_call';
export type AdapterRequestPayload = 'json' | 'multipart';
export type AdapterResponsePayload = 'json' | 'sse' | 'binary' | 'websocket';
export type AdapterSurfaceRole = 'request' | 'upstream';

export type AdapterUpstreamModels = {
	include: readonly string[];
	exclude?: readonly string[];
};

/** Admin 下拉用：`match` 命中规则，`mismatch` 排除，`generic` 不按模型名过滤。 */
export type AdapterModelMatch = 'match' | 'mismatch' | 'generic';

export type AdapterPresetIntent =
	| 'dashscope-asr-flash-convert'
	| 'dashscope-asr-flash-passthrough'
	| 'dashscope-asr-filetrans'
	| 'dashscope-tts-nonrealtime'
	| 'dashscope-tts-realtime'
	| 'dashscope-image-qwen'
	| 'dashscope-image-wan';

export interface AdapterDescriptor {
	/** 写入 `model_routes.adapter` 的稳定 ID；语义变化时发新 ID，永不复用。 */
	id: string;
	/** Admin 选项唯一键。转换 adapter 等于 id；passthrough 变体为 `passthrough:{protocol}:{operation}`。 */
	optionKey: string;
	request: { protocol: UpstreamProtocol; operation: string };
	upstream: { protocol: UpstreamProtocol; operations: readonly string[] };
	modality: AdapterModality;
	modelKind: AdapterModelKind;
	exchange: AdapterExchange;
	billing: AdapterBilling;
	requestPayload: AdapterRequestPayload;
	responsePayload: AdapterResponsePayload;
	requiredUpstreamCapabilities: readonly string[];
	/** 客户端调用路径模板，`{model}` / `{operation}` 可替换。 */
	publicPath: string;
	/** 参与 Admin 的 request / upstream operation 下拉推导。 */
	roles: readonly AdapterSurfaceRole[];
	presetIntent?: AdapterPresetIntent;
	lossyFeatures?: readonly string[];
	/**
	 * 适用的供应商模型名。大小写不敏感，`*` 通配。
	 * 不填表示通用，Admin 下拉不按模型名隐藏。
	 */
	upstreamModels?: AdapterUpstreamModels;
}

/**
 * 供应商模型名规则是 Admin 适配器下拉的唯一来源。
 * 新增模型家族时在这里补 pattern，不要在 Admin 里再写一份。
 */
const QWEN3_ASR_SYNC_MODELS = ['qwen3-asr-flash', 'qwen3-asr-flash-2*'] as const;
const QWEN_AUDIO_ASR_SYNC_MODELS = ['qwen-audio-3.0-asr-flash', 'qwen-audio-3.0-asr-flash-2*'] as const;
const FUN_ASR_SYNC_MODELS = ['fun-asr-realtime*'] as const;
const DASHSCOPE_SYNC_ASR_MODELS = [
	...QWEN3_ASR_SYNC_MODELS,
	...QWEN_AUDIO_ASR_SYNC_MODELS,
	...FUN_ASR_SYNC_MODELS,
] as const;
const DASHSCOPE_ASYNC_ASR_MODELS = ['*-filetrans*', 'fun-asr', 'fun-asr-2*', 'paraformer-v*'] as const;
const DASHSCOPE_ASR_SESSION_MODELS = ['qwen3-asr-flash-realtime*'] as const;
const DASHSCOPE_ASR_INFERENCE_MODELS = [
	'fun-asr-realtime*',
	'paraformer-realtime*',
	'qwen-audio-3.0-asr-flash-streaming*',
] as const;
const COSYVOICE_AND_QWEN_AUDIO_TTS_MODELS = ['cosyvoice-*', 'qwen-audio-3.0-tts-*'] as const;
const QWEN_TTS_HTTP_MODELS = {
	include: ['qwen3-tts-*', 'qwen-tts*'],
	exclude: ['*realtime*'],
} as const;
const MINIMAX_TTS_MODELS = ['minimax/speech-*'] as const;
const MINIMAX_NATIVE_TTS_MODELS = ['speech-*'] as const;
const MINIMAX_IMAGE_MODELS = ['image-01*'] as const;
const QWEN_TTS_REALTIME_SESSION_MODELS = ['qwen3-tts-*realtime*', 'qwen-tts-realtime*'] as const;
const COSYVOICE_REALTIME_MODELS = ['cosyvoice-*'] as const;
const QWEN_IMAGE_MODELS = ['qwen-image*'] as const;
const WAN_IMAGE_MODELS = ['wan*'] as const;

function matchesUpstreamModelPattern(pattern: string, modelName: string): boolean {
	const source = pattern.trim().toLowerCase();
	const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
	return new RegExp(`^${escaped}$`).test(modelName);
}

/** 供应商模型名是否适用该适配器。空名称与未声明规则都视为通用。 */
export function matchAdapterUpstreamModel(
	descriptor: Pick<AdapterDescriptor, 'upstreamModels'>,
	providerModelName: string,
): AdapterModelMatch {
	const rule = descriptor.upstreamModels;
	if (!rule || rule.include.length === 0) return 'generic';
	const name = providerModelName.trim().toLowerCase();
	if (!name) return 'generic';
	if (rule.exclude?.some((pattern) => matchesUpstreamModelPattern(pattern, name))) return 'mismatch';
	if (rule.include.some((pattern) => matchesUpstreamModelPattern(pattern, name))) return 'match';
	return 'mismatch';
}

const CONVERSION_ADAPTERS = [
	{
		id: 'dashscope-asr-qwen-file',
		optionKey: 'dashscope-asr-qwen-file',
		upstreamModels: { include: QWEN3_ASR_SYNC_MODELS },
		request: { protocol: 'openai', operation: 'audio.transcriptions' },
		upstream: { protocol: 'dashscope', operations: ['audio.transcriptions.multimodal'] },
		modality: 'audio',
		modelKind: 'audio.transcription',
		exchange: 'unary',
		billing: 'per_second',
		requestPayload: 'multipart',
		responsePayload: 'json',
		requiredUpstreamCapabilities: ['audio.transcriptions.multimodal'],
		publicPath: '/v1/audio/transcriptions',
		roles: [],
		lossyFeatures: ['timestamp_granularities', 'diarization'],
	},
	{
		id: 'dashscope-asr-qwen-audio-file',
		optionKey: 'dashscope-asr-qwen-audio-file',
		upstreamModels: { include: QWEN_AUDIO_ASR_SYNC_MODELS },
		request: { protocol: 'openai', operation: 'audio.transcriptions' },
		upstream: { protocol: 'dashscope', operations: ['audio.transcriptions.multimodal'] },
		modality: 'audio',
		modelKind: 'audio.transcription',
		exchange: 'unary',
		billing: 'per_second',
		requestPayload: 'multipart',
		responsePayload: 'json',
		requiredUpstreamCapabilities: ['audio.transcriptions.multimodal'],
		publicPath: '/v1/audio/transcriptions',
		roles: [],
		presetIntent: 'dashscope-asr-flash-convert',
		lossyFeatures: ['timestamp_granularities', 'diarization'],
	},
	{
		id: 'dashscope-asr-fun-file',
		optionKey: 'dashscope-asr-fun-file',
		upstreamModels: { include: FUN_ASR_SYNC_MODELS },
		request: { protocol: 'openai', operation: 'audio.transcriptions' },
		upstream: { protocol: 'dashscope', operations: ['audio.transcriptions.multimodal'] },
		modality: 'audio',
		modelKind: 'audio.transcription',
		exchange: 'unary',
		billing: 'per_second',
		requestPayload: 'multipart',
		responsePayload: 'json',
		requiredUpstreamCapabilities: ['audio.transcriptions.multimodal'],
		publicPath: '/v1/audio/transcriptions',
		roles: [],
		lossyFeatures: ['timestamp_granularities'],
	},
	{
		id: 'dashscope-asr-file-async',
		optionKey: 'dashscope-asr-file-async',
		upstreamModels: { include: DASHSCOPE_ASYNC_ASR_MODELS },
		request: { protocol: 'openai', operation: 'audio.transcriptions' },
		upstream: { protocol: 'dashscope', operations: ['audio.transcriptions.async'] },
		modality: 'audio',
		modelKind: 'audio.transcription',
		exchange: 'job',
		billing: 'per_second',
		requestPayload: 'multipart',
		responsePayload: 'json',
		requiredUpstreamCapabilities: ['audio.transcriptions', 'audio.transcriptions.tasks'],
		publicPath: '/v1/audio/transcriptions',
		roles: ['upstream'],
		presetIntent: 'dashscope-asr-filetrans',
		lossyFeatures: ['inline_file_upload'],
	},
	{
		id: 'dashscope-tts-speech',
		optionKey: 'dashscope-tts-speech',
		upstreamModels: { include: COSYVOICE_AND_QWEN_AUDIO_TTS_MODELS },
		request: { protocol: 'openai', operation: 'audio.speech' },
		upstream: { protocol: 'dashscope', operations: ['audio.speech'] },
		modality: 'audio',
		modelKind: 'audio.speech',
		exchange: 'unary',
		billing: 'per_character',
		requestPayload: 'json',
		responsePayload: 'binary',
		requiredUpstreamCapabilities: ['audio.speech'],
		publicPath: '/v1/audio/speech',
		roles: ['upstream'],
		presetIntent: 'dashscope-tts-nonrealtime',
	},
	{
		id: 'dashscope-tts-qwen',
		optionKey: 'dashscope-tts-qwen',
		upstreamModels: QWEN_TTS_HTTP_MODELS,
		request: { protocol: 'openai', operation: 'audio.speech' },
		upstream: { protocol: 'dashscope', operations: ['audio.speech.multimodal'] },
		modality: 'audio',
		modelKind: 'audio.speech',
		exchange: 'unary',
		billing: 'per_character',
		requestPayload: 'json',
		responsePayload: 'binary',
		requiredUpstreamCapabilities: ['audio.speech.multimodal'],
		publicPath: '/v1/audio/speech',
		roles: [],
		lossyFeatures: ['voice_instructions'],
	},
	{
		id: 'dashscope-tts-minimax',
		optionKey: 'dashscope-tts-minimax',
		upstreamModels: { include: MINIMAX_TTS_MODELS },
		request: { protocol: 'openai', operation: 'audio.speech' },
		upstream: { protocol: 'dashscope', operations: ['audio.speech.multimodal'] },
		modality: 'audio',
		modelKind: 'audio.speech',
		exchange: 'unary',
		billing: 'per_character',
		requestPayload: 'json',
		responsePayload: 'binary',
		requiredUpstreamCapabilities: ['audio.speech.multimodal'],
		publicPath: '/v1/audio/speech',
		roles: [],
		lossyFeatures: ['voice_instructions'],
	},
	{
		id: 'dashscope-image-qwen',
		optionKey: 'dashscope-image-qwen',
		upstreamModels: { include: QWEN_IMAGE_MODELS },
		request: { protocol: 'openai', operation: 'images.generations' },
		upstream: { protocol: 'dashscope', operations: ['images.generations.multimodal'] },
		modality: 'image',
		modelKind: 'image',
		exchange: 'unary',
		billing: 'per_image',
		requestPayload: 'json',
		responsePayload: 'json',
		requiredUpstreamCapabilities: ['images.generations.multimodal'],
		publicPath: '/v1/images/generations',
		roles: ['upstream'],
		presetIntent: 'dashscope-image-qwen',
		lossyFeatures: ['size_abbreviation', 'background'],
	},
	{
		id: 'dashscope-image-wan',
		optionKey: 'dashscope-image-wan',
		upstreamModels: { include: WAN_IMAGE_MODELS },
		request: { protocol: 'openai', operation: 'images.generations' },
		upstream: { protocol: 'dashscope', operations: ['images.generations.multimodal'] },
		modality: 'image',
		modelKind: 'image',
		exchange: 'unary',
		billing: 'per_image',
		requestPayload: 'json',
		responsePayload: 'json',
		requiredUpstreamCapabilities: ['images.generations.multimodal'],
		publicPath: '/v1/images/generations',
		roles: ['upstream'],
		presetIntent: 'dashscope-image-wan',
		lossyFeatures: ['background'],
	},
	{
		id: 'minimax-asr-file',
		optionKey: 'minimax-asr-file',
		request: { protocol: 'openai', operation: 'audio.transcriptions' },
		upstream: { protocol: 'minimax', operations: ['audio.transcriptions'] },
		modality: 'audio',
		modelKind: 'audio.transcription',
		exchange: 'unary',
		billing: 'per_second',
		requestPayload: 'multipart',
		responsePayload: 'json',
		requiredUpstreamCapabilities: ['audio.transcriptions'],
		publicPath: '/v1/audio/transcriptions',
		roles: ['upstream'],
		lossyFeatures: ['prompt', 'temperature'],
	},
	{
		id: 'minimax-tts',
		optionKey: 'minimax-tts',
		upstreamModels: { include: MINIMAX_NATIVE_TTS_MODELS },
		request: { protocol: 'openai', operation: 'audio.speech' },
		upstream: { protocol: 'minimax', operations: ['audio.speech'] },
		modality: 'audio',
		modelKind: 'audio.speech',
		exchange: 'unary',
		billing: 'per_character',
		requestPayload: 'json',
		responsePayload: 'binary',
		requiredUpstreamCapabilities: ['audio.speech'],
		publicPath: '/v1/audio/speech',
		roles: ['upstream'],
		lossyFeatures: ['voice_instructions', 'response_format_opus_aac', 'openai_speed_range'],
	},
	{
		id: 'minimax-image',
		optionKey: 'minimax-image',
		upstreamModels: { include: MINIMAX_IMAGE_MODELS },
		request: { protocol: 'openai', operation: 'images.generations' },
		upstream: { protocol: 'minimax', operations: ['images.generations'] },
		modality: 'image',
		modelKind: 'image',
		exchange: 'unary',
		billing: 'per_image',
		requestPayload: 'json',
		responsePayload: 'json',
		requiredUpstreamCapabilities: ['images.generations'],
		publicPath: '/v1/images/generations',
		roles: ['upstream'],
		lossyFeatures: ['background', 'quality'],
	},
] as const satisfies readonly AdapterDescriptor[];

function passthroughDescriptor(input: {
	protocol: UpstreamProtocol;
	operation: string;
	modelKind: AdapterModelKind;
	modality: AdapterModality;
	exchange?: AdapterExchange;
	billing: AdapterBilling;
	requestPayload?: AdapterRequestPayload;
	responsePayload?: AdapterResponsePayload;
	requiredUpstreamCapabilities: readonly string[];
	publicPath: string;
	roles?: readonly AdapterSurfaceRole[];
	presetIntent?: AdapterPresetIntent;
	upstreamModels?: AdapterUpstreamModels;
}): AdapterDescriptor {
	return {
		id: PASSTHROUGH_ROUTE_ADAPTER,
		optionKey: `${PASSTHROUGH_ROUTE_ADAPTER}:${input.protocol}:${input.operation}`,
		request: { protocol: input.protocol, operation: input.operation },
		upstream: { protocol: input.protocol, operations: [input.operation] },
		modality: input.modality,
		modelKind: input.modelKind,
		exchange: input.exchange ?? 'unary',
		billing: input.billing,
		requestPayload: input.requestPayload ?? 'json',
		responsePayload: input.responsePayload ?? 'json',
		requiredUpstreamCapabilities: input.requiredUpstreamCapabilities,
		publicPath: input.publicPath,
		roles: input.roles ?? ['request', 'upstream'],
		presetIntent: input.presetIntent,
		...(input.upstreamModels ? { upstreamModels: input.upstreamModels } : {}),
	};
}

const PASSTHROUGH_ADAPTERS: readonly AdapterDescriptor[] = [
	passthroughDescriptor({
		protocol: 'openai',
		operation: 'chat',
		modelKind: 'llm',
		modality: 'text',
		exchange: 'sse',
		billing: 'tokens',
		requiredUpstreamCapabilities: ['chat'],
		publicPath: '/v1/chat/completions',
	}),
	passthroughDescriptor({
		protocol: 'openai',
		operation: 'responses',
		modelKind: 'llm',
		modality: 'text',
		exchange: 'sse',
		billing: 'tokens',
		requiredUpstreamCapabilities: ['responses'],
		publicPath: '/v1/responses',
	}),
	passthroughDescriptor({
		protocol: 'anthropic',
		operation: 'messages',
		modelKind: 'llm',
		modality: 'text',
		exchange: 'sse',
		billing: 'tokens',
		requiredUpstreamCapabilities: ['messages'],
		publicPath: '/v1/messages',
	}),
	passthroughDescriptor({
		protocol: 'gemini',
		operation: 'models.generate',
		modelKind: 'llm',
		modality: 'text',
		exchange: 'sse',
		billing: 'tokens',
		requiredUpstreamCapabilities: ['models.generate'],
		publicPath: `/v1beta/models/${SURFACE_PATH_MODEL_PLACEHOLDER}:{generateContent|streamGenerateContent}`,
	}),
	passthroughDescriptor({
		protocol: 'openai',
		operation: 'images.generations',
		modelKind: 'image',
		modality: 'image',
		billing: 'per_image',
		requiredUpstreamCapabilities: ['images.generations'],
		publicPath: '/v1/images/generations',
	}),
	passthroughDescriptor({
		protocol: 'openai',
		operation: 'images.edits',
		modelKind: 'image',
		modality: 'image',
		billing: 'per_image',
		requestPayload: 'multipart',
		requiredUpstreamCapabilities: ['images.edits'],
		publicPath: '/v1/images/edits',
	}),
	passthroughDescriptor({
		protocol: 'openai',
		operation: 'audio.transcriptions',
		modelKind: 'audio.transcription',
		modality: 'audio',
		billing: 'per_second',
		requestPayload: 'multipart',
		requiredUpstreamCapabilities: ['audio.transcriptions'],
		publicPath: '/v1/audio/transcriptions',
	}),
	passthroughDescriptor({
		protocol: 'openai',
		operation: 'audio.speech',
		modelKind: 'audio.speech',
		modality: 'audio',
		billing: 'per_character',
		responsePayload: 'binary',
		requiredUpstreamCapabilities: ['audio.speech'],
		publicPath: '/v1/audio/speech',
	}),
	passthroughDescriptor({
		protocol: 'minimax',
		operation: 'audio.transcriptions',
		modelKind: 'audio.transcription',
		modality: 'audio',
		billing: 'per_second',
		requestPayload: 'multipart',
		requiredUpstreamCapabilities: ['audio.transcriptions'],
		publicPath: MINIMAX_SPEECH_TO_TEXT_PATH,
	}),
	passthroughDescriptor({
		protocol: 'minimax',
		operation: 'audio.speech',
		modelKind: 'audio.speech',
		modality: 'audio',
		exchange: 'sse',
		billing: 'per_character',
		responsePayload: 'sse',
		requiredUpstreamCapabilities: ['audio.speech'],
		publicPath: MINIMAX_T2A_PATH,
		upstreamModels: { include: MINIMAX_NATIVE_TTS_MODELS },
	}),
	passthroughDescriptor({
		protocol: 'minimax',
		operation: 'images.generations',
		modelKind: 'image',
		modality: 'image',
		billing: 'per_image',
		requiredUpstreamCapabilities: ['images.generations'],
		publicPath: MINIMAX_IMAGE_GENERATION_PATH,
		upstreamModels: { include: MINIMAX_IMAGE_MODELS },
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.transcriptions.multimodal',
		modelKind: 'audio.transcription',
		modality: 'audio',
		billing: 'per_second',
		requiredUpstreamCapabilities: ['audio.transcriptions.multimodal'],
		publicPath: DASHSCOPE_MULTIMODAL_GENERATION_PATH,
		presetIntent: 'dashscope-asr-flash-passthrough',
		upstreamModels: { include: DASHSCOPE_SYNC_ASR_MODELS },
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.transcriptions.realtime.inference',
		modelKind: 'audio.transcription',
		modality: 'audio',
		exchange: 'websocket',
		billing: 'per_second',
		responsePayload: 'websocket',
		requiredUpstreamCapabilities: ['audio.realtime.inference'],
		publicPath: `/v1/dashscope/realtime?model=${SURFACE_PATH_MODEL_PLACEHOLDER}&operation={operation}`,
		upstreamModels: { include: DASHSCOPE_ASR_INFERENCE_MODELS },
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.transcriptions.realtime.session',
		modelKind: 'audio.transcription',
		modality: 'audio',
		exchange: 'websocket',
		billing: 'per_second',
		responsePayload: 'websocket',
		requiredUpstreamCapabilities: ['audio.realtime.session'],
		publicPath: `/v1/dashscope/realtime?model=${SURFACE_PATH_MODEL_PLACEHOLDER}&operation={operation}`,
		upstreamModels: { include: DASHSCOPE_ASR_SESSION_MODELS },
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.speech.realtime.inference',
		modelKind: 'audio.speech',
		modality: 'audio',
		exchange: 'websocket',
		billing: 'per_character',
		responsePayload: 'websocket',
		requiredUpstreamCapabilities: ['audio.realtime.inference'],
		publicPath: `/v1/dashscope/realtime?model=${SURFACE_PATH_MODEL_PLACEHOLDER}&operation={operation}`,
		presetIntent: 'dashscope-tts-realtime',
		upstreamModels: { include: COSYVOICE_REALTIME_MODELS },
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.speech',
		modelKind: 'audio.speech',
		modality: 'audio',
		billing: 'per_character',
		responsePayload: 'binary',
		requiredUpstreamCapabilities: ['audio.speech'],
		publicPath: DASHSCOPE_SPEECH_SYNTHESIZER_PATH,
		upstreamModels: { include: COSYVOICE_AND_QWEN_AUDIO_TTS_MODELS },
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.speech.stream',
		modelKind: 'audio.speech',
		modality: 'audio',
		exchange: 'sse',
		billing: 'per_character',
		responsePayload: 'sse',
		requiredUpstreamCapabilities: ['audio.speech'],
		publicPath: DASHSCOPE_SPEECH_SYNTHESIZER_PATH,
		upstreamModels: { include: COSYVOICE_AND_QWEN_AUDIO_TTS_MODELS },
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.speech.multimodal',
		modelKind: 'audio.speech',
		modality: 'audio',
		billing: 'per_character',
		requiredUpstreamCapabilities: ['audio.speech.multimodal'],
		publicPath: DASHSCOPE_MULTIMODAL_GENERATION_PATH,
		upstreamModels: QWEN_TTS_HTTP_MODELS,
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.speech.realtime.session',
		modelKind: 'audio.speech',
		modality: 'audio',
		exchange: 'websocket',
		billing: 'per_character',
		responsePayload: 'websocket',
		requiredUpstreamCapabilities: ['audio.realtime.session'],
		publicPath: `/v1/dashscope/realtime?model=${SURFACE_PATH_MODEL_PLACEHOLDER}&operation={operation}`,
		upstreamModels: { include: QWEN_TTS_REALTIME_SESSION_MODELS },
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'images.generations.multimodal',
		modelKind: 'image',
		modality: 'image',
		billing: 'per_image',
		requiredUpstreamCapabilities: ['images.generations.multimodal'],
		publicPath: DASHSCOPE_MULTIMODAL_GENERATION_PATH,
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.transcriptions.async',
		modelKind: 'audio.transcription',
		modality: 'audio',
		exchange: 'job',
		billing: 'per_second',
		requiredUpstreamCapabilities: ['audio.transcriptions', 'audio.transcriptions.tasks'],
		publicPath: DASHSCOPE_FILE_TRANSCRIPTION_PATH,
		upstreamModels: { include: DASHSCOPE_ASYNC_ASR_MODELS },
	}),
];

/** Display-only surfaces that are not selectable request operations. */
/** 仅用于展示上游路径，不能选作请求入口。 */
const DISPLAY_PATH_SURFACES: readonly AdapterDescriptor[] = [
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.transcriptions',
		modelKind: 'audio.transcription',
		modality: 'audio',
		billing: 'per_second',
		requestPayload: 'multipart',
		requiredUpstreamCapabilities: ['audio.transcriptions'],
		publicPath: '/v1/audio/transcriptions',
		roles: [],
	}),
];

export const ADAPTER_REGISTRY: readonly AdapterDescriptor[] = [
	...PASSTHROUGH_ADAPTERS,
	...CONVERSION_ADAPTERS,
	...DISPLAY_PATH_SURFACES,
];

export const ROUTE_ADAPTERS = [
	PASSTHROUGH_ROUTE_ADAPTER,
	...CONVERSION_ADAPTERS.map((adapter) => adapter.id),
] as const;

export type RouteAdapter = (typeof ROUTE_ADAPTERS)[number];

/** 转换 adapter：在 `ROUTE_ADAPTER_MAPPINGS` 中有条目（不含 passthrough）。 */
export type ConversionRouteAdapter = Exclude<RouteAdapter, typeof PASSTHROUGH_ROUTE_ADAPTER>;

export type RouteAdapterMapping = {
	requestProtocol: UpstreamProtocol;
	requestOperation: string;
	upstreamProtocol: UpstreamProtocol;
	upstreamOperation: string;
};

export const ROUTE_ADAPTER_MAPPINGS: Record<ConversionRouteAdapter, RouteAdapterMapping> =
	Object.fromEntries(
		CONVERSION_ADAPTERS.map((adapter) => [
			adapter.id,
			{
				requestProtocol: adapter.request.protocol,
				requestOperation: adapter.request.operation,
				upstreamProtocol: adapter.upstream.protocol,
				upstreamOperation: adapter.upstream.operations[0]!,
			} satisfies RouteAdapterMapping,
		]),
	) as Record<ConversionRouteAdapter, RouteAdapterMapping>;

export function isRouteAdapter(raw: string): raw is RouteAdapter {
	return (ROUTE_ADAPTERS as readonly string[]).includes(raw);
}

export function isConversionRouteAdapter(raw: string): raw is ConversionRouteAdapter {
	return raw !== PASSTHROUGH_ROUTE_ADAPTER && isRouteAdapter(raw);
}

export function listConversionAdapters(): readonly AdapterDescriptor[] {
	return CONVERSION_ADAPTERS;
}

export function listSelectableAdapters(): readonly AdapterDescriptor[] {
	return ADAPTER_REGISTRY.filter(
		(adapter) => adapter.optionKey === adapter.id || adapter.roles.includes('request')
	);
}

export function getAdapterById(id: string): AdapterDescriptor | undefined {
	return ADAPTER_REGISTRY.find((adapter) => adapter.id === id && adapter.optionKey === id)
		?? ADAPTER_REGISTRY.find((adapter) => adapter.id === id);
}

export function getAdapterByOptionKey(optionKey: string): AdapterDescriptor | undefined {
	return ADAPTER_REGISTRY.find((adapter) => adapter.optionKey === optionKey);
}

export function getAdapterByPresetIntent(intent: AdapterPresetIntent): AdapterDescriptor | undefined {
	return ADAPTER_REGISTRY.find((adapter) => adapter.presetIntent === intent);
}

export function adaptersForModelKind(kind: AdapterModelKind): readonly AdapterDescriptor[] {
	return listSelectableAdapters().filter((adapter) => adapter.modelKind === kind);
}

export function requestOperationsFromRegistry(
	protocol: UpstreamProtocol,
	kind: AdapterModelKind
): readonly string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const adapter of ADAPTER_REGISTRY) {
		if (adapter.modelKind !== kind) continue;
		if (adapter.request.protocol !== protocol) continue;
		if (!adapter.roles.includes('request')) continue;
		if (seen.has(adapter.request.operation)) continue;
		seen.add(adapter.request.operation);
		out.push(adapter.request.operation);
	}
	return out;
}

export function upstreamOperationsFromRegistry(
	protocol: UpstreamProtocol,
	kind: AdapterModelKind
): readonly string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const adapter of ADAPTER_REGISTRY) {
		if (adapter.modelKind !== kind) continue;
		if (adapter.upstream.protocol !== protocol) continue;
		if (!adapter.roles.includes('upstream')) continue;
		for (const operation of adapter.upstream.operations) {
			if (seen.has(operation)) continue;
			seen.add(operation);
			out.push(operation);
		}
	}
	return out;
}

export function requiredCapabilitiesForUpstreamOperation(
	protocol: UpstreamProtocol,
	operation: string
): readonly string[] {
	const match = ADAPTER_REGISTRY.find(
		(adapter) =>
			adapter.upstream.protocol === protocol &&
			adapter.upstream.operations.includes(operation) &&
			adapter.roles.includes('upstream')
	);
	return match?.requiredUpstreamCapabilities ?? [operation];
}

function lookupPublicPath(protocol: string, operation: string): string | undefined {
	const match = ADAPTER_REGISTRY.find(
		(adapter) => adapter.request.protocol === protocol && adapter.request.operation === operation
	);
	return match?.publicPath;
}

export function requestSurfacePath(
	protocol: string,
	operation: string,
	modelId?: string
): string {
	const modelSegment =
		modelId && modelId.length > 0 ? modelId : SURFACE_PATH_MODEL_PLACEHOLDER;
	if (protocol === 'openai') {
		if (operation === '*') return '/v1/*';
		return lookupPublicPath(protocol, operation) ?? `/v1/${operation}`;
	}
	if (protocol === 'anthropic') {
		return operation === '*' ? '/v1/*' : '/v1/messages';
	}
	if (protocol === 'gemini') {
		if (operation === 'models.generate') {
			return `/v1beta/models/${modelSegment}:{generateContent|streamGenerateContent}`;
		}
		return `/v1beta/models/${modelSegment}:${operation}`;
	}
	if (protocol === 'minimax') {
		if (operation === '*') return '/*';
		return lookupPublicPath(protocol, operation) ?? `/${operation}`;
	}
	if (protocol === 'dashscope') {
		if (operation.includes('.realtime.')) {
			const modelParam =
				modelId && modelId.length > 0
					? encodeURIComponent(modelId)
					: SURFACE_PATH_MODEL_PLACEHOLDER;
			return `/v1/dashscope/realtime?model=${modelParam}&operation=${encodeURIComponent(operation)}`;
		}
		if (operation === '*') return '/*';
		return lookupPublicPath(protocol, operation) ?? `/${operation}`;
	}
	return operation === '*' ? '/*' : `/${operation}`;
}
