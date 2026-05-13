/**
 * 上游 HTTP 代理与故障转移：按协议分发到 openai/anthropic/gemini driver，并在流开始前按路由顺序重试。
 * 返回的 `usagePromise` 在流结束后解析 token 用量，供 `usage-tracker` 记账。
 */
import type { RouteResult } from './model-router';
import { dispatchOpenAiRoute } from './egress/openai-driver';
import { dispatchAnthropicRoute } from './egress/anthropic-driver';
import { dispatchGeminiRoute } from './egress/gemini-driver';

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
}

export interface ProxyResult {
  response: Response;
  usagePromise: Promise<UsageFromStream>;
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
 * 代理 OpenAI Chat Completions：按 priority 依次尝试；非 2xx（含 429）换下一供应商，直至成功或候选耗尽。
 * @param routes 已按优先级排好且协议均为 openai 的候选（非 openai 会在循环内跳过）
 * @param body 将经 `buildRouteRequestBody` 合并默认参数后转发上游
 * @param requestSignal 一般为 `c.req.raw.signal`，用于断开检测与 usage drain
 */
export async function proxyChatCompletions(
  routes: RouteResult[],
  body: Record<string, unknown>,
  requestSignal?: AbortSignal
): Promise<ProxyResult> {
  if (routes.length === 0) {
    const errResponse = new Response(
      JSON.stringify({ error: 'No routes configured' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
    return {
      response: errResponse,
      usagePromise: Promise.resolve(EMPTY_USAGE),
      chosenRoute: {
        providerId: '',
        providerName: '',
        providerModelName: '',
        upstreamProtocol: 'openai',
        baseUrl: '',
        providerApiKey: '',
        priceOverrideRaw: null,
        routeMeteredProfileJson: null,
        routeChargedProfileJson: null,
        customParams: null,
        routeGroup: 'default',
      },
    };
  }

  let lastResponse: Response | null = null;
  let lastRoute: RouteResult = routes[0]!;

  for (const route of routes) {
    if (route.upstreamProtocol !== 'openai') {
      console.warn(
        `[Gateway Proxy] unsupported protocol for chat/completions, skipping providerId=${route.providerId} protocol=${route.upstreamProtocol}`
      );
      continue;
    }

    console.log(`[Gateway Proxy] calling provider providerId=${route.providerId} model=${route.providerModelName}`);

    let response: Response;
    let usagePromise: Promise<UsageFromStream>;
    try {
      const dispatched = await dispatchOpenAiRoute(route, body, requestSignal);
      response = dispatched.response;
      usagePromise = dispatched.usagePromise;
    } catch (err) {
      console.warn(
        `[Gateway Proxy] fetch failed providerId=${route.providerId} error=${err instanceof Error ? err.message : String(err)}`
      );
      lastResponse = new Response(
        JSON.stringify({ error: 'Upstream request failed' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
      lastRoute = route;
      continue;
    }

    lastResponse = response;
    lastRoute = route;

    if (response.ok) {
      return {
        response,
        usagePromise,
        chosenRoute: route,
      };
    }

    console.warn(
      `[Gateway Proxy] provider non-OK, trying next providerId=${route.providerId} status=${response.status}`
    );
  }

  if (!lastResponse) {
    return {
      response: new Response(
        JSON.stringify({ error: 'No supported upstream protocol route available' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      ),
      usagePromise: Promise.resolve(EMPTY_USAGE),
      chosenRoute: lastRoute,
    };
  }

  return {
    response: lastResponse,
    usagePromise: Promise.resolve(EMPTY_USAGE),
    chosenRoute: lastRoute,
  };
}

/**
 * 代理 Anthropic Messages API，故障转移逻辑与 Chat Completions 类似（仅 anthropic 协议路由）。
 * @param body 合并默认参数后的请求体
 */
export async function proxyAnthropicMessages(
  routes: RouteResult[],
  body: Record<string, unknown>,
  requestSignal?: AbortSignal
): Promise<ProxyResult> {
  if (routes.length === 0) {
    return {
      response: new Response(
        JSON.stringify({ error: 'No routes configured' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      ),
      usagePromise: Promise.resolve(EMPTY_USAGE),
      chosenRoute: {
        providerId: '',
        providerName: '',
        providerModelName: '',
        upstreamProtocol: 'anthropic',
        baseUrl: '',
        providerApiKey: '',
        priceOverrideRaw: null,
        routeMeteredProfileJson: null,
        routeChargedProfileJson: null,
        customParams: null,
        routeGroup: 'default',
      },
    };
  }

  let lastResponse: Response | null = null;
  let lastRoute: RouteResult = routes[0]!;

  for (const route of routes) {
    if (route.upstreamProtocol !== 'anthropic') {
      continue;
    }

    let response: Response;
    let usagePromise: Promise<UsageFromStream>;
    try {
      const dispatched = await dispatchAnthropicRoute(route, body, requestSignal);
      response = dispatched.response;
      usagePromise = dispatched.usagePromise;
    } catch (err) {
      console.warn(
        `[Gateway Proxy] anthropic fetch failed providerId=${route.providerId} error=${err instanceof Error ? err.message : String(err)}`
      );
      lastResponse = new Response(
        JSON.stringify({ error: 'Upstream request failed' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
      lastRoute = route;
      continue;
    }

    lastResponse = response;
    lastRoute = route;

    if (response.ok) {
      return { response, usagePromise, chosenRoute: route };
    }

    console.warn(
      `[Gateway Proxy] anthropic provider non-OK, trying next providerId=${route.providerId} status=${response.status}`
    );
  }

  if (!lastResponse) {
    return {
      response: new Response(
        JSON.stringify({ error: 'No anthropic route available' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      ),
      usagePromise: Promise.resolve(EMPTY_USAGE),
      chosenRoute: lastRoute,
    };
  }

  return {
    response: lastResponse,
    usagePromise: Promise.resolve(EMPTY_USAGE),
    chosenRoute: lastRoute,
  };
}

/**
 * 代理 Gemini `generateContent` / `streamGenerateContent`，仅尝试 gemini 协议路由。
 * @param search 原始 URL 查询串（含 `?`，driver 内按需使用）
 */
export async function proxyGeminiContent(
  routes: RouteResult[],
  action: 'generateContent' | 'streamGenerateContent',
  body: Record<string, unknown>,
  search: string,
  requestSignal?: AbortSignal
): Promise<ProxyResult> {
  if (routes.length === 0) {
    return {
      response: new Response(
        JSON.stringify({ error: 'No routes configured' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      ),
      usagePromise: Promise.resolve(EMPTY_USAGE),
      chosenRoute: {
        providerId: '',
        providerName: '',
        providerModelName: '',
        upstreamProtocol: 'gemini',
        baseUrl: '',
        providerApiKey: '',
        priceOverrideRaw: null,
        routeMeteredProfileJson: null,
        routeChargedProfileJson: null,
        customParams: null,
        routeGroup: 'default',
      },
    };
  }

  let lastResponse: Response | null = null;
  let lastRoute: RouteResult = routes[0]!;

  for (const route of routes) {
    if (route.upstreamProtocol !== 'gemini') {
      continue;
    }

    let response: Response;
    let usagePromise: Promise<UsageFromStream>;
    try {
      const dispatched = await dispatchGeminiRoute(route, body, action, search, requestSignal);
      response = dispatched.response;
      usagePromise = dispatched.usagePromise;
    } catch (err) {
      console.warn(
        `[Gateway Proxy] gemini fetch failed providerId=${route.providerId} error=${err instanceof Error ? err.message : String(err)}`
      );
      lastResponse = new Response(
        JSON.stringify({ error: 'Upstream request failed' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
      lastRoute = route;
      continue;
    }

    lastResponse = response;
    lastRoute = route;

    if (response.ok) {
      return { response, usagePromise, chosenRoute: route };
    }

    console.warn(
      `[Gateway Proxy] gemini provider non-OK, trying next providerId=${route.providerId} status=${response.status}`
    );
  }

  if (!lastResponse) {
    return {
      response: new Response(
        JSON.stringify({ error: 'No gemini route available' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      ),
      usagePromise: Promise.resolve(EMPTY_USAGE),
      chosenRoute: lastRoute,
    };
  }

  return {
    response: lastResponse,
    usagePromise: Promise.resolve(EMPTY_USAGE),
    chosenRoute: lastRoute,
  };
}
