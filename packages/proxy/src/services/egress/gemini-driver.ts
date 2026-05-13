/**
 * Gemini generateContent / streamGenerateContent 出站：构建 v1beta URL、解析 JSON 或 SSE 中的 usageMetadata。
 */
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';

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

function buildUrl(baseUrl: string, action: 'generateContent' | 'streamGenerateContent', modelName: string): string {
  return `${baseUrl.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(modelName)}:${action}`;
}

function parseJsonUsage(text: string, usage: UsageFromStream): void {
  try {
    const parsed = JSON.parse(text) as {
      usageMetadata?: GeminiUsageMetadata;
      candidates?: Array<{ usageMetadata?: GeminiUsageMetadata }>;
    };
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

function parseSSEChunk(chunk: Uint8Array, state: SSEState, usage: UsageFromStream): void {
  state.lineBuffer += decoder.decode(chunk, { stream: true });
  const lines = state.lineBuffer.split('\n');
  state.lineBuffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    parseJsonUsage(data, usage);
  }
}

function processRemainingLineBuffer(state: SSEState, usage: UsageFromStream): void {
  const line = state.lineBuffer.trim();
  if (!line.startsWith('data: ')) return;
  const data = line.slice(6).trim();
  if (!data || data === '[DONE]') return;
  parseJsonUsage(data, usage);
}

async function pumpWithUsageTracking(
  upstream: ReadableStream<Uint8Array>,
  downstream: WritableStream<Uint8Array>,
  usage: UsageFromStream,
  resolveUsage: (u: UsageFromStream) => void,
  requestSignal?: AbortSignal
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
        processRemainingLineBuffer(state, usage);
        break;
      }

      parseSSEChunk(value, state, usage);

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
    resolveUsage(usage);
    try {
      await writer.close();
    } catch {
      // ignore downstream close errors
    }
  }
}

function streamResponseWithUsage(
  response: Response,
  requestSignal?: AbortSignal
): { response: Response; usagePromise: Promise<UsageFromStream> } {
  let resolveUsage!: (u: UsageFromStream) => void;
  const usagePromise = new Promise<UsageFromStream>((resolve) => {
    resolveUsage = resolve;
  });
  const usage: UsageFromStream = { ...EMPTY_USAGE_LOCAL };
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  pumpWithUsageTracking(response.body!, writable, usage, resolveUsage, requestSignal).catch(() => {
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
  response: Response
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
    return {
      response,
      usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
    };
  }
}

/**
 * 调用 Gemini `v1beta/models/{model}:{action}`：URL 查询串可与客户端 `search` 合并，缺省则追加 `key=` 使用路由密钥。
 * `streamGenerateContent` 走 SSE 解析；`generateContent` 单次 JSON 用 `usageMetadata`。
 * @param search 原始 query 字符串（可含或不含 `?`），会与上游所需参数合并
 */
export async function dispatchGeminiRoute(
  route: RouteResult,
  body: Record<string, unknown>,
  action: 'generateContent' | 'streamGenerateContent',
  search: string,
  requestSignal?: AbortSignal
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream> }> {
  const url = new URL(buildUrl(route.baseUrl, action, route.providerModelName));
  if (search) {
    const source = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    for (const [k, v] of source.entries()) {
      url.searchParams.set(k, v);
    }
  }
  if (!url.searchParams.get('key')) {
    url.searchParams.set('key', route.providerApiKey);
  }

  const requestBody = buildRouteRequestBody(route, body);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (response.ok && response.body) {
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json') && action === 'generateContent') {
      return nonStreamResponseWithUsage(response);
    }
    return streamResponseWithUsage(response, requestSignal);
  }

  return {
    response,
    usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
  };
}
