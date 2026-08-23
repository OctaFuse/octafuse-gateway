/**
 * Adapter Registry：配置层稳定 ID + 多模态元数据的单一来源。
 * `adapter` 是 route target 上的配置 ID；运行时实现叫 driver，一个 driver 可服务多个 adapter。
 */
import type { UpstreamProtocol } from '../upstream-protocol';

export const PASSTHROUGH_ROUTE_ADAPTER = 'passthrough';

export const DASHSCOPE_MULTIMODAL_GENERATION_PATH =
	'/v1/dashscope/services/aigc/multimodal-generation/generation';

export const SURFACE_PATH_MODEL_PLACEHOLDER = '{model}';

export type AdapterModality = 'text' | 'image' | 'audio' | 'video' | 'embedding';
export type AdapterModelKind = 'llm' | 'image' | 'audio.transcription' | 'audio.speech';
export type AdapterExchange = 'unary' | 'sse' | 'websocket' | 'job';
export type AdapterBilling = 'tokens' | 'per_image' | 'per_second' | 'per_character' | 'per_call';
export type AdapterRequestPayload = 'json' | 'multipart';
export type AdapterResponsePayload = 'json' | 'sse' | 'binary' | 'websocket';
export type AdapterSurfaceRole = 'request' | 'upstream';

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
}

const CONVERSION_ADAPTERS = [
	{
		id: 'dashscope-asr-qwen-file',
		optionKey: 'dashscope-asr-qwen-file',
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
		protocol: 'dashscope',
		operation: 'audio.transcriptions.multimodal',
		modelKind: 'audio.transcription',
		modality: 'audio',
		billing: 'per_second',
		requiredUpstreamCapabilities: ['audio.transcriptions.multimodal'],
		publicPath: DASHSCOPE_MULTIMODAL_GENERATION_PATH,
		presetIntent: 'dashscope-asr-flash-passthrough',
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
	}),
];

/** Display-only surfaces that are not selectable request operations. */
const DISPLAY_PATH_SURFACES: readonly AdapterDescriptor[] = [
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.speech',
		modelKind: 'audio.speech',
		modality: 'audio',
		billing: 'per_character',
		responsePayload: 'binary',
		requiredUpstreamCapabilities: ['audio.speech'],
		publicPath: '/v1/audio/speech',
		roles: [],
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
		publicPath: '/v1/audio/speech',
		roles: [],
	}),
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.speech.multimodal',
		modelKind: 'audio.speech',
		modality: 'audio',
		billing: 'per_character',
		requiredUpstreamCapabilities: ['audio.speech.multimodal'],
		publicPath: '/v1/audio/speech',
		roles: [],
	}),
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
	passthroughDescriptor({
		protocol: 'dashscope',
		operation: 'audio.transcriptions.async',
		modelKind: 'audio.transcription',
		modality: 'audio',
		exchange: 'job',
		billing: 'per_second',
		requiredUpstreamCapabilities: ['audio.transcriptions', 'audio.transcriptions.tasks'],
		publicPath: '/v1/audio/transcriptions',
		roles: [],
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

export type RouteAdapterMapping = {
	requestProtocol: UpstreamProtocol;
	requestOperation: string;
	upstreamProtocol: UpstreamProtocol;
	upstreamOperation: string;
};

export const ROUTE_ADAPTER_MAPPINGS: Record<
	Exclude<RouteAdapter, 'passthrough'>,
	RouteAdapterMapping
> = Object.fromEntries(
	CONVERSION_ADAPTERS.map((adapter) => [
		adapter.id,
		{
			requestProtocol: adapter.request.protocol,
			requestOperation: adapter.request.operation,
			upstreamProtocol: adapter.upstream.protocol,
			upstreamOperation: adapter.upstream.operations[0]!,
		} satisfies RouteAdapterMapping,
	])
) as Record<Exclude<RouteAdapter, 'passthrough'>, RouteAdapterMapping>;

export function isRouteAdapter(raw: string): raw is RouteAdapter {
	return (ROUTE_ADAPTERS as readonly string[]).includes(raw);
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
