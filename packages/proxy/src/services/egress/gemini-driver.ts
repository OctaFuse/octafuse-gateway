/**
 * Gemini generateContent / streamGenerateContent 出站：按 `base_url_gemini` 前缀构建 URL、解析 JSON 或 SSE 中的 usageMetadata。
 */
import { prepareGeminiUpstreamFetch } from '@octafuse/core';
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';
import { extractUpstreamRequestId, normalizeUpstreamId } from './upstream-request-id';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';

const EMPTY_USAGE_LOCAL: UsageFromStream = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  raw_usage: null,
};

const POST_DISCONNECT_DRAIN_MS = 90_000;
const decoder = new TextDecoder();

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  /** Thinking / internal reasoning tokens (Gemini thinking models); see ai.google.dev/gemini-api/docs/thinking */
  thoughtsTokenCount?: number;
  thoughts_token_count?: number;
};

type SSEState = { lineBuffer: string };

function thoughtsTokenCountFromGemini(u: GeminiUsageMetadata): number {
  const n = u.thoughtsTokenCount ?? u.thoughts_token_count;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function usageFromGemini(u: GeminiUsageMetadata): UsageFromStream {
  const inputTokens = u.promptTokenCount ?? 0;
  const candidatesTokens = u.candidatesTokenCount ?? 0;
  const cacheRead = u.cachedContentTokenCount ?? 0;
  const reasoningTokens = thoughtsTokenCountFromGemini(u);
  /** 与 Google 输出侧计费一致：`output_tokens` = candidates + thoughts（`reasoning_tokens` 仍为 thoughts 分列）。 */
  const outputTokens = candidatesTokens + reasoningTokens;
  /** `totalTokenCount` 文档为 prompt + candidates，可能不含 thoughts；取与 explicit 和的上界避免少记。 */
  const explicitSum = inputTokens + outputTokens;
  const total =
    u.totalTokenCount != null ? Math.max(u.totalTokenCount, explicitSum) : explicitSum;
  const rawJson = JSON.stringify(u);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: 0,
    reasoning_tokens: reasoningTokens,
    total_tokens: total,
    raw_usage: rawJson,
  };
}

function applyUsage(target: UsageFromStream, next: UsageFromStream): void {
  target.input_tokens = next.input_tokens;
  target.output_tokens = next.output_tokens;
  target.cache_read_tokens = next.cache_read_tokens;
  target.cache_write_tokens = next.cache_write_tokens;
  target.reasoning_tokens = next.reasoning_tokens;
  target.total_tokens = next.total_tokens;
  target.raw_usage = next.raw_usage;
}

function hasGeminiContentPart(parsed: {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown; functionCall?: unknown; function_call?: unknown }>;
    };
  }>;
}): boolean {
  for (const candidate of parsed.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === 'string' && part.text.length > 0) return true;
      if (part.functionCall != null || part.function_call != null) return true;
    }
  }
  return false;
}

function parseJsonUsage(text: string, usage: UsageFromStream, timing?: RequestTimingCollector | null): void {
  try {
    const parsed = JSON.parse(text) as {
      usageMetadata?: GeminiUsageMetadata;
      candidates?: Array<{
        usageMetadata?: GeminiUsageMetadata;
        content?: {
          parts?: Array<{ text?: unknown; functionCall?: unknown; function_call?: unknown }>;
        };
      }>;
      responseId?: string;
      requestId?: string;
      request_id?: string;
    };
    timing?.markFirstEvent();
    if (hasGeminiContentPart(parsed)) timing?.markFirstToken();
    // message id 为 Gemini 顶层 `responseId`（流式每个 chunk 亦带），取首个。
    if (!usage.upstreamMessageId) {
      const msgId = normalizeUpstreamId(parsed.responseId);
      if (msgId) usage.upstreamMessageId = msgId;
    }
    // 部分 Gemini 代理在 body 追加 requestId；与 responseId 区分，供日志 request id 解析。
    if (!usage.upstreamBodyRequestId) {
      const reqId = normalizeUpstreamId(parsed.requestId ?? parsed.request_id);
      if (reqId) usage.upstreamBodyRequestId = reqId;
    }
    if (parsed.usageMetadata) {
      applyUsage(usage, usageFromGemini(parsed.usageMetadata));
      return;
    }
    for (const c of parsed.candidates ?? []) {
      if (c.usageMetadata) {
        applyUsage(usage, usageFromGemini(c.usageMetadata));
      }
    }
  } catch {
    // ignore parse failures
  }
}

function parseSSEChunk(
  chunk: Uint8Array,
  state: SSEState,
  usage: UsageFromStream,
  timing?: RequestTimingCollector | null
): void {
  state.lineBuffer += decoder.decode(chunk, { stream: true });
  const lines = state.lineBuffer.split('\n');
  state.lineBuffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    parseJsonUsage(data, usage, timing);
  }
}

function processRemainingLineBuffer(
  state: SSEState,
  usage: UsageFromStream,
  timing?: RequestTimingCollector | null
): void {
  const line = state.lineBuffer.trim();
  if (!line.startsWith('data: ')) return;
  const data = line.slice(6).trim();
  if (!data || data === '[DONE]') return;
  parseJsonUsage(data, usage, timing);
}

async function pumpWithUsageTracking(
  upstream: ReadableStream<Uint8Array>,
  downstream: WritableStream<Uint8Array>,
  usage: UsageFromStream,
  resolveUsage: (u: UsageFromStream) => void,
  requestSignal?: AbortSignal,
  timing?: RequestTimingCollector | null
): Promise<void> {
  const reader = upstream.getReader();
  const writer = downstream.getWriter();
  const state: SSEState = { lineBuffer: '' };
  let clientDisconnected = false;
  let disconnectTime = 0;

  const onAbort = (): void => {
    usage.cancelled = true;
    clientDisconnected = true;
  };
  requestSignal?.addEventListener('abort', onAbort);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        processRemainingLineBuffer(state, usage, timing);
        break;
      }

      if (value.byteLength > 0) timing?.markFirstByte();
      parseSSEChunk(value, state, usage, timing);

      if (!clientDisconnected) {
        try {
          await writer.write(value);
        } catch {
          clientDisconnected = true;
          disconnectTime = Date.now();
          usage.cancelled = true;
        }
      }

      if (
        clientDisconnected &&
        disconnectTime > 0 &&
        Date.now() - disconnectTime > POST_DISCONNECT_DRAIN_MS
      ) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    requestSignal?.removeEventListener('abort', onAbort);
    timing?.markStreamComplete();
    resolveUsage(usage);
    try {
      await writer.close();
    } catch (err) {
      console.warn(
        '[Gateway Proxy] gemini pump writer.close (non-fatal)',
        err instanceof Error ? err.message : String(err),
        { clientDisconnected, usageCancelled: usage.cancelled }
      );
    }
  }
}

function streamResponseWithUsage(
  response: Response,
  requestSignal?: AbortSignal,
  timing?: RequestTimingCollector | null
): { response: Response; usagePromise: Promise<UsageFromStream> } {
  let resolveUsage!: (u: UsageFromStream) => void;
  const usagePromise = new Promise<UsageFromStream>((resolve) => {
    resolveUsage = resolve;
  });
  const usage: UsageFromStream = { ...EMPTY_USAGE_LOCAL };
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  pumpWithUsageTracking(response.body!, writable, usage, resolveUsage, requestSignal, timing).catch(() => {
    // resolveUsage in finally
  });

  return {
    response: new Response(readable, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    }),
    usagePromise,
  };
}

async function nonStreamResponseWithUsage(
  response: Response,
  timing?: RequestTimingCollector | null
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream> }> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    return {
      response,
      usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
    };
  }
  try {
    const text = await response.text();
    timing?.markStreamComplete();
    const usage: UsageFromStream = { ...EMPTY_USAGE_LOCAL };
    parseJsonUsage(text, usage);
    return {
      response: new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
      usagePromise: Promise.resolve(usage),
    };
  } catch {
    timing?.markStreamComplete();
    return {
      response,
      usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
    };
  }
}

/**
 * 调用 Gemini `{base}/{model}:{action}`（`base_url_gemini` 须含完整路径前缀）：URL 查询串可与客户端 `search` 合并；
 * 官方上游缺省追加 `?key=`，部分 bypass/vertex 兼容服务使用 `Authorization: Bearer`（见 `resolveGeminiUpstreamAuth`）。
 * `streamGenerateContent` 走 SSE 解析（上游强制 `alt=sse`）；`generateContent` 单次 JSON 用 `usageMetadata`。
 * @param search 原始 query 字符串（可含或不含 `?`），会与上游所需参数合并
 */
export async function dispatchGeminiRoute(
  route: RouteResult,
  body: Record<string, unknown>,
  action: 'generateContent' | 'streamGenerateContent',
  search: string,
  requestSignal?: AbortSignal,
  timing?: RequestTimingCollector | null,
  attempt?: RequestTimingAttempt
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream>; upstreamRequestId: string | null }> {
  const { url, headers } = prepareGeminiUpstreamFetch({
    baseUrl: route.baseUrl,
    modelName: route.providerModelName,
    action,
    apiKey: route.providerApiKey,
    search,
  });

  const requestBody = buildRouteRequestBody(route, body);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });
  timing?.markAttemptHeaders(attempt, response.status);
  const upstreamRequestId = extractUpstreamRequestId(response.headers);

  if (response.ok && response.body) {
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json') && action === 'generateContent') {
      const result = await nonStreamResponseWithUsage(response, timing);
      return { ...result, upstreamRequestId };
    }
    const result = streamResponseWithUsage(response, requestSignal, timing);
    return { ...result, upstreamRequestId };
  }

  return {
    response,
    usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
    upstreamRequestId,
  };
}
