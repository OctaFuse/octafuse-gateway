/**
 * 上游 HTTP 代理与故障转移：按协议分发到 openai/anthropic/gemini driver，并在流开始前按路由顺序重试。
 * 返回的 `usagePromise` 在流结束后解析 token 用量，供 `usage-tracker` 记账。
 */
import type { GatewayRepositories } from '@octafuse/core';
import type { RouteResult } from './model-router';
import { dispatchOpenAiRoute } from './egress/openai-driver';
import { dispatchAnthropicRoute } from './egress/anthropic-driver';
import { dispatchGeminiRoute } from './egress/gemini-driver';
import { failoverDispatchWithKeyPool, type FailoverDispatchOptions } from './failover-dispatch';

export type { FailoverDispatchOptions, StickyDispatchContext } from './failover-dispatch';

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
	/** 客户端在流结束前断开（如用户取消）时置位 */
	cancelled?: boolean;
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

/**
 * 代理 OpenAI Chat Completions：外层 provider 优先级 + 内层 key pool failover。
 */
export async function proxyChatCompletions(
	repos: GatewayRepositories,
	routes: RouteResult[],
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyResult> {
	const result = await failoverDispatchWithKeyPool(
		repos,
		routes,
		'openai',
		(route, signal) => dispatchOpenAiRoute(route, body, signal),
		requestSignal,
		options
	);
	return result;
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
	return failoverDispatchWithKeyPool(
		repos,
		routes,
		'anthropic',
		(route, signal) => dispatchAnthropicRoute(route, body, signal),
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
	action: 'generateContent' | 'streamGenerateContent',
	body: Record<string, unknown>,
	search: string,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyResult> {
	return failoverDispatchWithKeyPool(
		repos,
		routes,
		'gemini',
		(route, signal) => dispatchGeminiRoute(route, body, action, search, signal),
		requestSignal,
		options
	);
}
