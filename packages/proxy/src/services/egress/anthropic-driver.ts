/**
 * Anthropic Messages 协议出站：组装 URL、合并路由默认参数、流式 SSE 解析 usage，并在断连后限时 drain。
 */
import { resolveUpstreamEndpoint } from '@octafuse/core';
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

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type SSEState = { lineBuffer: string };

function usageFromAnthropic(u: AnthropicUsage): UsageFromStream {
  const netInputAfterBreakpoint = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  // Anthropic: `input_tokens` is only tokens after the last cache breakpoint; cache_* are separate additive buckets.
  // Total input = net + cache_read + cache_creation (see Anthropic prompt caching docs).
  // `computeMeteredCost` expects OpenAI-like semantics: `input_tokens` = total prompt, then
  // regular = input_tokens - cache_read - cache_write.
  const inputTokensTotal = netInputAfterBreakpoint + cacheRead + cacheWrite;
  const rawJson = JSON.stringify(u);
  return {
    input_tokens: inputTokensTotal,
    output_tokens: outputTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    reasoning_tokens: 0,
    total_tokens: inputTokensTotal + outputTokens,
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

export function hasAnthropicReasoningDelta(parsed: {
  type?: string;
  delta?: { type?: unknown; thinking?: unknown };
}): boolean {
  if (parsed.type !== 'content_block_delta') return false;
  const delta = parsed.delta;
  if (!delta) return false;
  if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
    return true;
  }
  return false;
}

export function hasAnthropicContentDelta(parsed: {
  type?: string;
  delta?: { type?: unknown; text?: unknown; partial_json?: unknown };
}): boolean {
  if (parsed.type !== 'content_block_delta' && parsed.type !== 'message_delta') return false;
  const delta = parsed.delta;
  if (!delta) return false;
  if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) return true;
  if (typeof delta.text === 'string' && delta.text.length > 0) return true;
  if (typeof delta.partial_json === 'string' && delta.partial_json.length > 0) return true;
  return false;
}

function parseEventData(data: string, usage: UsageFromStream, timing?: RequestTimingCollector | null): void {
  if (!data || data === '[DONE]') return;
  try {
    const parsed = JSON.parse(data) as {
      type?: string;
      delta?: { type?: unknown; text?: unknown; partial_json?: unknown; thinking?: unknown };
      usage?: AnthropicUsage;
      message?: { id?: string };
    };
    timing?.markFirstEvent();
    if (hasAnthropicReasoningDelta(parsed)) timing?.markFirstReasoningToken();
    if (hasAnthropicContentDelta(parsed)) timing?.markFirstToken();
    // message id 来自 `message_start` 事件的 `message.id`（如 msg_* / msg_bdrk_*）；只取首个。
    if (!usage.upstreamMessageId) {
      const msgId = normalizeUpstreamId(parsed.message?.id);
      if (msgId) usage.upstreamMessageId = msgId;
    }
    if (parsed.usage) {
      applyUsage(usage, usageFromAnthropic(parsed.usage));
    }
  } catch {
    // ignore
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
    parseEventData(line.slice(6).trim(), usage, timing);
  }
}

function processRemainingLineBuffer(
  state: SSEState,
  usage: UsageFromStream,
  timing?: RequestTimingCollector | null
): void {
  const line = state.lineBuffer.trim();
  if (!line.startsWith('data: ')) return;
  parseEventData(line.slice(6).trim(), usage, timing);
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
        '[Gateway Proxy] anthropic pump writer.close (non-fatal)',
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
    const parsed = JSON.parse(text) as { id?: string; usage?: AnthropicUsage };
    const usage = parsed.usage ? usageFromAnthropic(parsed.usage) : { ...EMPTY_USAGE_LOCAL };
    const msgId = normalizeUpstreamId(parsed.id);
    if (msgId) usage.upstreamMessageId = msgId;
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
 * 调用 Anthropic Messages API（`x-api-key` + `anthropic-version`），请求体合并路由默认参数并替换 `model`。
 * 流式为 SSE，`usagePromise` 在流结束或断连 drain 后解析；非流 JSON 从根对象 `usage` 取数。
 * @param requestSignal 断连检测与 POST_DISCONNECT_DRAIN_MS 内继续读上游
 */
export async function dispatchAnthropicRoute(
  route: RouteResult,
  body: Record<string, unknown>,
  requestSignal?: AbortSignal,
  timing?: RequestTimingCollector | null,
  attempt?: RequestTimingAttempt
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream>; upstreamRequestId: string | null }> {
  const url = resolveUpstreamEndpoint('anthropic', 'messages', route.providerEndpoints, {
    providerId: route.providerId,
  });
  const requestBody = {
    ...buildRouteRequestBody(route, body),
    model: route.providerModelName,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': route.providerApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });
  timing?.markAttemptHeaders(attempt, response.status);
  const upstreamRequestId = extractUpstreamRequestId(response.headers);

  if (response.ok && response.body) {
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
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
