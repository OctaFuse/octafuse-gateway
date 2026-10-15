/**
 * Playground / Simulator 共用的 invoke kind 映射。
 * Models / Routes 目录 Kind 即 core `ModelKind`（llm|image|asr|tts|embedding，规则见
 * `docs/developers/reference/model-kinds.md`）；Simulator / Playground 另含 tool。
 */
import type { ImageOperation } from '@/lib/image-generations';
import type { ProviderEndpointCapability } from '@octafuse/core/provider-endpoints';
import {
	DASHSCOPE_MULTIMODAL_GENERATION_PATH,
	MINIMAX_IMAGE_GENERATION_PATH,
	VOLCENGINE_IMAGE_GENERATIONS_PATH,
	MINIMAX_SPEECH_TO_TEXT_PATH,
	MINIMAX_T2A_PATH,
} from '@octafuse/core/route-topology';
import { MODEL_KINDS, type ModelKind } from '@octafuse/core/db/model-kind';
import type { UpstreamProtocol } from '@octafuse/core/upstream-protocol';
import { GATEWAY_TOOLS, findGatewayToolById, type GatewayToolDefinition } from '@/lib/gateway-tools';

/** 全量 invoke kind（含 Agent Tools）。MCP 聚合调用只出现在请求日志，不进入模拟器。 */
export const INVOKE_KINDS = [...MODEL_KINDS, 'tool'] as const;
export type InvokeKind = (typeof INVOKE_KINDS)[number];

/** 请求日志里 MCP 聚合调用的 `provider_id`。不加入 `INVOKE_KINDS`，避免模拟器把它当成可执行入口。 */
export const MCP_REQUEST_LOG_PROVIDER_ID = 'octafuse-mcp';

/** Models / Routes 目录筛选（无 tool） */
export const MODEL_KIND_FILTERS = MODEL_KINDS;
export type ModelKindFilter = ModelKind;

/** 旧链接 / 旧书签里的 `?kind=audio`（拆分前的 ASR + TTS 合并类）落到 ASR。 */
export function normalizeLegacyKindParam(value: string): string {
	return value === 'audio' ? 'asr' : value;
}

/** ASR / TTS 对应的音频 operation。 */
export function audioOperationForKind(kind: 'asr' | 'tts'): AudioOperation {
	return kind === 'tts' ? 'speech' : 'transcriptions';
}

export function isAudioKind(kind: string): kind is 'asr' | 'tts' {
	return kind === 'asr' || kind === 'tts';
}

export const DEFAULT_KIND_FILTER: ModelKindFilter = 'llm';
export const DEFAULT_INVOKE_KIND: InvokeKind = 'llm';

export type SimulatorProtocol = 'openai' | 'anthropic' | 'gemini' | 'dashscope' | 'minimax' | 'volcengine';
export type GeminiContentAction = 'generateContent' | 'streamGenerateContent';
export type GeminiEmbedAction = 'embedContent' | 'batchEmbedContents';
export type AudioOperation = 'transcriptions' | 'speech';
/** OpenAI LLM 公开入口：Chat Completions 或 Responses。 */
export type OpenaiLlmOperation = 'chat' | 'responses';

/** 与 `GATEWAY_TOOLS` 登记的 id 对齐（显式联合，避免被 `GatewayToolDefinition.id: string` 拓宽）。 */
export type GatewayToolId = 'web-search' | 'web-fetch' | 'web-deep-search' | 'ai-detection';

export const GATEWAY_TOOL_IDS: readonly GatewayToolId[] = [
	'web-search',
	'web-fetch',
	'web-deep-search',
	'ai-detection',
];

export function isInvokeKind(value: string): value is InvokeKind {
	return (INVOKE_KINDS as readonly string[]).includes(value);
}

export function isModelKindFilter(value: string): value is ModelKindFilter {
	return (MODEL_KIND_FILTERS as readonly string[]).includes(value);
}

export function parseKindFilterParam(value: string | null): ModelKindFilter {
	if (value == null || value.trim() === '') return DEFAULT_KIND_FILTER;
	const v = normalizeLegacyKindParam(value.trim().toLowerCase());
	return isModelKindFilter(v) ? v : DEFAULT_KIND_FILTER;
}

export function parseInvokeKindParam(value: string | null): InvokeKind {
	if (value == null || value.trim() === '') return DEFAULT_INVOKE_KIND;
	const v = normalizeLegacyKindParam(value.trim().toLowerCase());
	return isInvokeKind(v) ? v : DEFAULT_INVOKE_KIND;
}

export function parseGatewayToolId(value: string | null | undefined): GatewayToolId | null {
	const found = findGatewayToolById(value);
	if (!found) return null;
	return (GATEWAY_TOOL_IDS as readonly string[]).includes(found.id) ? (found.id as GatewayToolId) : null;
}

export function gatewayToolDefinition(toolId: string | null | undefined): GatewayToolDefinition | undefined {
	return findGatewayToolById(toolId);
}

/** Proxy path for Agent Tools（相对 Proxy 根）。 */
export function proxyToolPath(toolId: string): string {
	const id = parseGatewayToolId(toolId) ?? toolId.trim();
	return `/v1/tools/${id}`;
}

/**
 * 由 kind + 协议派生 Proxy 请求 operation（用于 route surface 匹配等）。
 * tool 无 model_routes surface，返回 null。
 */
export function resolveRequestOperation(input: {
	kind: InvokeKind;
	protocol: SimulatorProtocol;
	imageOperation?: ImageOperation;
	geminiAction?: GeminiContentAction;
	llmOperation?: OpenaiLlmOperation;
	dashscopeRequestOperation?: string;
}): string | null {
	switch (input.kind) {
		case 'tool':
			return null;
		case 'embedding':
			return input.protocol === 'gemini' ? 'models.embed' : 'embeddings';
		case 'asr':
			if (input.protocol === 'dashscope') {
				return input.dashscopeRequestOperation ?? 'audio.transcriptions.realtime.inference';
			}
			return 'audio.transcriptions';
		case 'tts':
			if (input.protocol === 'dashscope') {
				return input.dashscopeRequestOperation ?? 'audio.speech.realtime.inference';
			}
			return 'audio.speech';
		case 'image':
			if (input.protocol === 'dashscope') return 'images.generations.multimodal';
			if (input.protocol === 'gemini') return 'models.generate';
			return `images.${input.imageOperation === 'edits' ? 'edits' : 'generations'}`;
		case 'llm':
			if (input.protocol === 'openai') return input.llmOperation === 'responses' ? 'responses' : 'chat';
			if (input.protocol === 'anthropic') return 'messages';
			return 'models.generate';
		default: {
			const _exhaustive: never = input.kind;
			return _exhaustive;
		}
	}
}

/**
 * OpenAI 上游 capability（Playground / preview 用）。
 * LLM → chat；image → images.*；audio → audio.transcriptions。
 */
export function resolveOpenaiUpstreamCapability(input: {
	kind: Exclude<InvokeKind, 'tool'>;
	imageOperation?: ImageOperation;
	llmOperation?: OpenaiLlmOperation;
}): ProviderEndpointCapability {
	switch (input.kind) {
		case 'embedding':
			return 'embeddings';
		case 'asr':
			return 'audio.transcriptions';
		case 'tts':
			return 'audio.speech';
		case 'image':
			return input.imageOperation === 'edits' ? 'images.edits' : 'images.generations';
		case 'llm':
			return input.llmOperation === 'responses' ? 'responses' : 'chat';
		default: {
			const _exhaustive: never = input.kind;
			return _exhaustive;
		}
	}
}

/**
 * Proxy 相对路径（不含 base）。tool 用 {@link proxyToolPath}。
 * Gemini 返回带 `:action` 的 path 模板前缀，调用方再拼 model。
 */
export function resolveProxyPathForModelInvoke(input: {
	kind: Exclude<InvokeKind, 'tool'>;
	protocol: SimulatorProtocol | UpstreamProtocol;
	imageOperation?: ImageOperation;
	geminiAction?: GeminiContentAction;
	/** Gemini 向量 action（默认 embedContent） */
	geminiEmbedAction?: GeminiEmbedAction;
	/** Gemini path 中的 model 段（已 encode 前的原始值由调用方 encode） */
	geminiModelSegment?: string;
	llmOperation?: OpenaiLlmOperation;
}): string {
	const protocol = input.protocol;
	if (input.kind === 'embedding') {
		if (protocol === 'gemini') {
			const model = encodeURIComponent(input.geminiModelSegment || 'model');
			return `/v1beta/models/${model}:${input.geminiEmbedAction ?? 'embedContent'}`;
		}
		return '/v1/embeddings';
	}
	if (input.kind === 'asr' || input.kind === 'tts') {
		const speech = input.kind === 'tts';
		if (protocol === 'dashscope' && !speech) {
			return DASHSCOPE_MULTIMODAL_GENERATION_PATH;
		}
		if (protocol === 'minimax') {
			return speech ? MINIMAX_T2A_PATH : MINIMAX_SPEECH_TO_TEXT_PATH;
		}
		return speech ? '/v1/audio/speech' : '/v1/audio/transcriptions';
	}
	if (input.kind === 'image') {
		if (protocol === 'gemini') {
			const model = encodeURIComponent(input.geminiModelSegment || 'model');
			return `/v1beta/models/${model}:generateContent`;
		}
		if (protocol === 'minimax') return MINIMAX_IMAGE_GENERATION_PATH;
		if (protocol === 'volcengine') return VOLCENGINE_IMAGE_GENERATIONS_PATH;
		return input.imageOperation === 'edits' ? '/v1/images/edits' : '/v1/images/generations';
	}
	// llm
	if (protocol === 'anthropic') return '/v1/messages';
	if (protocol === 'gemini') {
		const action = input.geminiAction === 'generateContent' ? 'generateContent' : 'streamGenerateContent';
		const model = encodeURIComponent(input.geminiModelSegment || 'model');
		return `/v1beta/models/${model}:${action}`;
	}
	return input.llmOperation === 'responses' ? '/v1/responses' : '/v1/chat/completions';
}

/** empty kind counts for UI */
export function emptyModelKindCounts(): Record<ModelKindFilter, number> {
	return { llm: 0, image: 0, asr: 0, tts: 0, embedding: 0 };
}

export function emptyInvokeKindCounts(): Record<InvokeKind, number> {
	return { llm: 0, image: 0, asr: 0, tts: 0, embedding: 0, tool: GATEWAY_TOOLS.length };
}
