/**
 * Playground / Simulator 共用的 invoke kind 映射。
 * Models / Routes 目录 Kind 为 llm|image|audio；Simulator / Playground 另含 tool。
 */
import type { ImageOperation } from '@/lib/image-generations';
import type { ProviderEndpointCapability } from '@octafuse/core/provider-endpoints';
import type { UpstreamProtocol } from '@octafuse/core/upstream-protocol';
import { GATEWAY_TOOLS, findGatewayToolById, type GatewayToolDefinition } from '@/lib/gateway-tools';

/** 全量 invoke kind（含 Agent Tools） */
export const INVOKE_KINDS = ['llm', 'image', 'audio', 'tool'] as const;
export type InvokeKind = (typeof INVOKE_KINDS)[number];

/** Models / Routes 目录筛选（无 tool） */
export const MODEL_KIND_FILTERS = ['llm', 'image', 'audio'] as const;
export type ModelKindFilter = (typeof MODEL_KIND_FILTERS)[number];

export const DEFAULT_KIND_FILTER: ModelKindFilter = 'llm';
export const DEFAULT_INVOKE_KIND: InvokeKind = 'llm';

export type SimulatorProtocol = 'openai' | 'anthropic' | 'gemini' | 'dashscope';
export type GeminiContentAction = 'generateContent' | 'streamGenerateContent';
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
	const v = value.trim().toLowerCase();
	return isModelKindFilter(v) ? v : DEFAULT_KIND_FILTER;
}

export function parseInvokeKindParam(value: string | null): InvokeKind {
	if (value == null || value.trim() === '') return DEFAULT_INVOKE_KIND;
	const v = value.trim().toLowerCase();
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
	audioOperation?: AudioOperation;
	geminiAction?: GeminiContentAction;
	llmOperation?: OpenaiLlmOperation;
}): string | null {
	switch (input.kind) {
		case 'tool':
			return null;
		case 'audio':
			if (input.protocol === 'dashscope') {
				return input.audioOperation === 'speech'
					? 'audio.speech.realtime.inference'
					: 'audio.transcriptions.realtime.inference';
			}
			return input.audioOperation === 'speech' ? 'audio.speech' : 'audio.transcriptions';
		case 'image':
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
	audioOperation?: AudioOperation;
	llmOperation?: OpenaiLlmOperation;
}): ProviderEndpointCapability {
	switch (input.kind) {
		case 'audio':
			return input.audioOperation === 'speech' ? 'audio.speech' : 'audio.transcriptions';
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
 * 由 catalog 标志推导 ModelKindFilter（Models / Routes / Playground route 列表）。
 */
export function modelKindFromFlags(isAudio: boolean, isImage: boolean): ModelKindFilter {
	if (isAudio) return 'audio';
	if (isImage) return 'image';
	return 'llm';
}

/**
 * Proxy 相对路径（不含 base）。tool 用 {@link proxyToolPath}。
 * Gemini 返回带 `:action` 的 path 模板前缀，调用方再拼 model。
 */
export function resolveProxyPathForModelInvoke(input: {
	kind: Exclude<InvokeKind, 'tool'>;
	protocol: SimulatorProtocol | UpstreamProtocol;
	imageOperation?: ImageOperation;
	audioOperation?: AudioOperation;
	geminiAction?: GeminiContentAction;
	/** Gemini path 中的 model 段（已 encode 前的原始值由调用方 encode） */
	geminiModelSegment?: string;
	llmOperation?: OpenaiLlmOperation;
}): string {
	const protocol = input.protocol;
	if (input.kind === 'audio') {
		return input.audioOperation === 'speech' ? '/v1/audio/speech' : '/v1/audio/transcriptions';
	}
	if (input.kind === 'image') {
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
	return { llm: 0, image: 0, audio: 0 };
}

export function emptyInvokeKindCounts(): Record<InvokeKind, number> {
	return { llm: 0, image: 0, audio: 0, tool: GATEWAY_TOOLS.length };
}
