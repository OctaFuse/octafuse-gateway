/**
 * 上游 HTTP 代理与故障转移：按协议分发到 openai/anthropic/gemini driver，并在流开始前按路由顺序重试。
 * 返回的 `usagePromise` 在流结束后解析 token 用量，供 `usage-tracker` 记账。
 */
import type { GatewayRepositories } from "@octafuse/core";
import type { RouteResult } from "./model-router";
import { dispatchOpenAiRoute } from "./egress/openai-driver";
import { dispatchOpenAiResponsesRoute } from "./egress/openai-responses-driver";
import {
	dispatchOpenAiImageEdits,
	dispatchOpenAiImageGenerations,
	type NormalizedImageEditRequest,
} from "./egress/openai-images-driver";
import type { NormalizedAudioTranscriptionRequest } from "./egress/openai-audio-driver";
import type { DashScopeAsrDispatchOptions } from "./egress/dashscope-audio-driver";
import {
	dispatchAudioSpeech,
	dispatchAudioTranscriptions,
	dispatchMultimodalPassthrough,
} from "./egress/dispatch-table";
import type {
	AudioSpeechDispatchOptions,
	NormalizedAudioSpeechRequest,
} from "./egress/audio-speech-driver";
import {
	dispatchDashScopeRealtime,
	type DashScopeRealtimeDispatchOptions,
	type DashScopeRealtimeOperation,
} from "./egress/dashscope-realtime-driver";
import { dispatchAnthropicRoute } from "./egress/anthropic-driver";
import { dispatchGeminiRoute } from "./egress/gemini-driver";
import {
	failoverDispatch,
	type FailoverDispatchOptions,
	type ProxyDispatchMeta,
} from './failover-dispatch';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import type { StickyTraceSnapshot } from './provider-sticky-routing';
import type { RequestTimingAttempt, RequestTimingCollector } from './request-timing';

export type {
	FailoverDispatchOptions,
	ProxyDispatchMeta,
} from "./failover-dispatch";

/** 各协议 driver 从上游响应/stream 汇总出的用量（供 `usage-tracker` 计价）。 */
export interface UsageFromStream {
	/** 输入侧常规 token（含逻辑输入；具体口径见各 driver） */
	input_tokens: number;
	/** 按 `output_price` 计费的输出 token（Gemini：`candidatesTokenCount`+`thoughtsTokenCount`；OpenAI：completion 总量） */
	output_tokens: number;
	/** 缓存命中等按上游 usage 拆出的只读类 token */
	cache_read_tokens: number;
	cache_write_tokens: number;
	/** 推理/thinking 分列（Gemini：thoughts，为计入 `output_tokens` 的子集；OpenAI：completion 内 reasoning 子集） */
	reasoning_tokens: number;
	total_tokens: number;
	/** 上游 usage 对象 JSON 字符串快照，便于审计 */
	raw_usage: string | null;
	/** TTS 上游返回的真实计费字符数；缺失时不按输入长度补算。 */
	audio_characters?: number;
	/** 实时 ASR 上游返回的真实计费时长（秒）。 */
	audio_duration_seconds?: number;
	/** 客户端在流结束前断开（如用户取消）时置位 */
	cancelled?: boolean;
	/** 上游流在终止事件前失败；用于把已返回 2xx headers 的半截流记为失败。 */
	stream_error?: string;
	/**
	 * 上游响应 body 里的「生成结果」id（OpenAI `chatcmpl-*` / Anthropic `msg_*` / Gemini `responseId`）。
	 * 与 header 侧 `upstreamRequestId` 语义不同：这是应用层 message id，穿透聚合商/CDN，随 usage 一起解析。
	 */
	upstreamMessageId?: string | null;
	/** Gemini 等上游 body 内非标准的 request id 字段（`requestId` / `request_id`），与 message id 区分 */
	upstreamBodyRequestId?: string | null;
}

export interface ProxyResult {
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	/** 上游响应头中的 provider 追踪 id（如 x-request-id） */
	upstreamRequestId: string | null;
	/** 实际选用或最后尝试的路由（用于日志）；若全部失败则为最后一次尝试 */
	chosenRoute: RouteResult;
	/** 本次请求触发的熔断事件（provider / user+model） */
	circuitEvents: GatewayCircuitAlertEvent[];
	/** 因已有熔断短路、无需重复 webhook 告警 */
	suppressErrorAlert: boolean;
	/** Images 等协议透传已解析字段，避免 route 侧重复 parse */
	meta?: ProxyDispatchMeta;
	/** Sticky routing observation for `route_trace` */
	stickyTrace?: (() => Promise<StickyTraceSnapshot>) | undefined;
	/** Background bind/touch mutations (schedule via waitUntil) */
	stickyMutationPromise?: Promise<unknown> | null;
}

/** 无用量或解析失败时的零值占位（避免 undefined 传播）。 */
export const EMPTY_USAGE: UsageFromStream = {
	input_tokens: 0,
	output_tokens: 0,
	cache_read_tokens: 0,
	cache_write_tokens: 0,
	reasoning_tokens: 0,
	total_tokens: 0,
	raw_usage: null,
};

export type AudioTranscriptionProxyOptions = FailoverDispatchOptions & {
	dashScope?: DashScopeAsrDispatchOptions;
};

export type AudioSpeechProxyOptions = FailoverDispatchOptions &
	AudioSpeechDispatchOptions;
export type DashScopeRealtimeProxyOptions = FailoverDispatchOptions &
	DashScopeRealtimeDispatchOptions;

/**
 * 代理 OpenAI Chat Completions：外层 provider 优先级 + 层内 route strategy failover。
 */
export async function proxyChatCompletions(
	repos: GatewayRepositories,
	routes: RouteResult[],
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyResult> {
	const result = await failoverDispatch(
		repos,
		routes,
		"openai",
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) => dispatchOpenAiRoute(route, body, signal, timing, attempt),
		requestSignal,
		options
	);
	return result;
}

/**
 * 代理 OpenAI Responses API。
 */
export async function proxyResponses(
	repos: GatewayRepositories,
	routes: RouteResult[],
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyResult> {
	return failoverDispatch(
		repos,
		routes,
		"openai",
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) => dispatchOpenAiResponsesRoute(route, body, signal, timing, attempt),
		requestSignal,
		options
	);
}

/**
 * 代理 Anthropic Messages API。
 */
export async function proxyAnthropicMessages(
	repos: GatewayRepositories,
	routes: RouteResult[],
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyResult> {
	return failoverDispatch(
		repos,
		routes,
		"anthropic",
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) => dispatchAnthropicRoute(route, body, signal, timing, attempt),
		requestSignal,
		options
	);
}

/**
 * 代理 OpenAI Images Generations。
 */
export async function proxyImageGenerations(
	repos: GatewayRepositories,
	routes: RouteResult[],
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyResult> {
	return failoverDispatch(
		repos,
		routes,
		"openai",
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) => dispatchOpenAiImageGenerations(route, body, signal, timing, attempt),
		requestSignal,
		options
	);
}

/**
 * 代理 OpenAI Images Edits（multipart；每次 attempt 重建 FormData）。
 */
export async function proxyImageEdits(
	repos: GatewayRepositories,
	routes: RouteResult[],
	edit: NormalizedImageEditRequest,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyResult> {
	return failoverDispatch(
		repos,
		routes,
		"openai",
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) => dispatchOpenAiImageEdits(route, edit, signal, timing, attempt),
		requestSignal,
		options
	);
}

/**
 * 代理 OpenAI Audio Transcriptions（multipart；每次 attempt 重建 FormData）。
 */
export async function proxyAudioTranscriptions(
	repos: GatewayRepositories,
	routes: RouteResult[],
	req: NormalizedAudioTranscriptionRequest,
	requestSignal?: AbortSignal,
	options?: AudioTranscriptionProxyOptions
): Promise<ProxyResult> {
	return failoverDispatch(
		repos,
		routes,
		["openai", "dashscope"],
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) =>
			dispatchAudioTranscriptions(
				route,
				req,
				signal,
				timing,
				attempt,
				options?.dashScope
			),
		requestSignal,
		options
	);
}

/** 代理 OpenAI Audio Speech，并按显式 adapter 转为三类 DashScope TTS 请求。 */
export async function proxyAudioSpeech(
	repos: GatewayRepositories,
	routes: RouteResult[],
	request: NormalizedAudioSpeechRequest,
	requestSignal?: AbortSignal,
	options?: AudioSpeechProxyOptions
): Promise<ProxyResult> {
	return failoverDispatch(
		repos,
		routes,
		["openai", "dashscope"],
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) =>
			dispatchAudioSpeech(route, request, signal, timing, attempt, options),
		requestSignal,
		options
	);
}

/** 代理 DashScope 同步多模态 ASR HTTP 透传（原生 JSON，不转 OpenAI transcriptions）。 */
export async function proxyDashScopeMultimodalPassthrough(
	repos: GatewayRepositories,
	routes: RouteResult[],
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	options?: AudioTranscriptionProxyOptions
): Promise<ProxyResult> {
	return failoverDispatch(
		repos,
		routes,
		"dashscope",
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) =>
			dispatchMultimodalPassthrough(
				route,
				body,
				signal,
				timing,
				attempt,
				options?.dashScope
			),
		requestSignal,
		options
	);
}

/** 代理 DashScope 原生实时音频 WebSocket，建连失败时按普通路由规则切换供应商。 */
export async function proxyDashScopeRealtime(
	repos: GatewayRepositories,
	routes: RouteResult[],
	operation: DashScopeRealtimeOperation,
	requestSignal?: AbortSignal,
	options?: DashScopeRealtimeProxyOptions
): Promise<ProxyResult> {
	return failoverDispatch(
		repos,
		routes,
		"dashscope",
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) =>
			dispatchDashScopeRealtime(
				route,
				operation,
				signal,
				timing,
				attempt,
				options
			),
		requestSignal,
		options
	);
}

/**
 * 代理 Gemini `generateContent` / `streamGenerateContent`。
 */
export async function proxyGeminiContent(
	repos: GatewayRepositories,
	routes: RouteResult[],
	action: "generateContent" | "streamGenerateContent",
	body: Record<string, unknown>,
	search: string,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyResult> {
	return failoverDispatch(
		repos,
		routes,
		"gemini",
		(
			route,
			signal,
			timing?: RequestTimingCollector | null,
			attempt?: RequestTimingAttempt
		) =>
			dispatchGeminiRoute(route, body, action, search, signal, timing, attempt),
		requestSignal,
		options
	);
}
