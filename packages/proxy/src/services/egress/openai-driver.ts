import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';

/**
 * OpenAI 协议流式响应（SSE）在此文件中有两条并行关注点，请勿混为一谈：
 *
 * 1) 网关计费 / 统计（`usage` 对象）
 *    - 从每条 `data: {...}` 里解析 `usage`，用「最后一次出现的快照」覆盖 `usageFromStream`。
 *    - 与是否转发给客户端无关：即使后面把某行里的 `usage` 从转发流里删掉，这里仍已按行解析过。
 *
 * 2) 转发给下游客户端的字节流
 *    - 历史上曾原样转发上游字节；部分上游（如 MiMo）在「非空 choices」的每个 chunk 里都带**累计** usage，
 *      而常见客户端（含 OpenAI SDK）会对每个 chunk 的 `usage` 做累加，导致「上下文用量」被放大数倍。
 *    - 因此这里按行重组 SSE，并对 **转发内容** 调用 `transformStreamUsageForClient`，在「仍在 delta 阶段」
 *      的行里去掉 `usage`，保留「收尾」形态（如 `choices: []` 或带 `finish_reason`）上的 `usage`，与
 *      OpenAI 官方流式行为更接近。
 *
 * 行缓冲：上游 `read()` 的切分点不一定落在换行符上，因此用 `lineBuffer` 拼完整行后再解析与转发。
 */

const EMPTY_USAGE_LOCAL: UsageFromStream = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  raw_usage: null,
};

/** Client disconnected后继续从上游读取以争取拿到末尾 usage 的最大时长。 */
const POST_DISCONNECT_DRAIN_MS = 90_000;

/** Provider usage object (OpenAI / Claude via OpenAI-compatible API). */
type ProviderUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_creation_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    text_tokens?: number;
  };
};

type SSEState = { lineBuffer: string };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * 不同 OpenAI 兼容供应商对 `prompt_tokens` 口径不一致：
 * - 常见口径（OpenAI）：`prompt_tokens` 已包含 cached/cache_creation。
 * - 兼容口径（部分供应商）：`prompt_tokens` 仅为非缓存输入，cached 单独给出。
 *
 * 网关内部计费公式假设：`input_tokens = regular + cache_read + cache_write`。
 * 因此这里需要把上游口径归一到该语义。
 */
function normalizeInputTokensFromPrompt(args: {
  promptTokens: number;
  completionTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens?: number;
}): number {
  const { promptTokens, completionTokens, cacheRead, cacheWrite, totalTokens } = args;
  const cacheTotal = cacheRead + cacheWrite;
  if (cacheTotal <= 0) return promptTokens;

  // prompt 小于 cache 总量时，不可能是「已包含缓存」口径，按「纯输入 + 缓存」兼容处理。
  if (promptTokens < cacheTotal) {
    return promptTokens + cacheTotal;
  }

  // 若上游给了 total_tokens，用其判定哪种口径更贴近。
  if (typeof totalTokens === 'number' && Number.isFinite(totalTokens) && totalTokens >= 0) {
    const expectedWithIncludedCache = promptTokens + completionTokens;
    const expectedWithPureInputPrompt = promptTokens + cacheTotal + completionTokens;
    const diffIncluded = Math.abs(totalTokens - expectedWithIncludedCache);
    const diffPureInput = Math.abs(totalTokens - expectedWithPureInputPrompt);
    if (diffPureInput < diffIncluded) {
      return promptTokens + cacheTotal;
    }
  }

  // 默认采用 OpenAI 口径：prompt 已包含缓存。
  return promptTokens;
}

function usageFromProvider(u: ProviderUsage): UsageFromStream {
  const promptTokensRaw = u.prompt_tokens ?? u.input_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? u.output_tokens ?? 0;
  const cacheRead = u.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = u.prompt_tokens_details?.cache_creation_tokens ?? 0;
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0;
  const promptTokens = normalizeInputTokensFromPrompt({
    promptTokens: promptTokensRaw,
    completionTokens,
    cacheRead,
    cacheWrite,
    totalTokens: u.total_tokens,
  });
  const rawJson = JSON.stringify(u);
  // 输出单行 SSE 的 usage 日志，比较长，生产中不输出，主要DEBUG 用
  // console.log('[Gateway Proxy] raw usage from provider:', rawJson);
  return {
    input_tokens: promptTokens,
    output_tokens: completionTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    reasoning_tokens: reasoning,
    total_tokens: u.total_tokens ?? promptTokens + completionTokens,
    raw_usage: rawJson,
  };
}

function buildUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/chat/completions`;
}

/**
 * 从单行 SSE `data: {...}` 里解析 `usage`，合并进网关的 `usage`（后出现的覆盖先前的）。
 * 注意：这是**计费侧**用的统计，与 `transformStreamUsageForClient` 是否删字段独立。
 */
function processUsageFromDataLine(line: string, usage: UsageFromStream): void {
  if (!line.startsWith('data: ')) return;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return;
  try {
    const parsed = JSON.parse(data) as { usage?: ProviderUsage };
    const u = parsed.usage;
    if (u) {
      const next = usageFromProvider(u);
      usage.input_tokens = next.input_tokens;
      usage.output_tokens = next.output_tokens;
      usage.cache_read_tokens = next.cache_read_tokens;
      usage.cache_write_tokens = next.cache_write_tokens;
      usage.reasoning_tokens = next.reasoning_tokens;
      usage.total_tokens = next.total_tokens;
      usage.raw_usage = next.raw_usage;
    }
  } catch {
    // ignore parse errors
  }
}

/**
 * 转发给客户端之前，按行改写 `data:` JSON。
 *
 * 背景：部分上游在 `choices` 非空且仍在输出 delta 时，每一行都带**累计**的 `usage`（prompt/completion 递增）。
 * 客户端若对每个 chunk 的 `usage` 做累加，会把「累计值」当成「增量」加无数次，导致 UI 显示百万级 token。
 *
 * 策略（与 OpenAI 官方流式常见形态对齐）：
 * - 若 `choices.length > 0` 且**没有任何** choice 带 `finish_reason` → 视为「仍在流式 delta」，**删除** `usage` 再转发。
 * - 若 `choices` 为空，或已有 `finish_reason`（收尾）→ **保留** `usage`，让客户端只收到少量含 usage 的 chunk。
 *
 * 非 `data:` 行、解析失败、`[DONE]` 原样返回。
 */
function transformStreamUsageForClient(line: string): string {
  if (!line.startsWith('data: ')) return line;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return line;
  try {
    const o = JSON.parse(data) as {
      choices?: { finish_reason?: string | null }[];
      usage?: unknown;
    };
    if (!o || typeof o !== 'object' || o.usage == null) return line;
    const choices = Array.isArray(o.choices) ? o.choices : [];
    const hasTerminalFinish = choices.some(
      (c) =>
        c != null &&
        typeof c === 'object' &&
        c.finish_reason != null &&
        String(c.finish_reason) !== ''
    );
    // 仅在「有 delta 且尚未结束」时剥掉 usage，避免误伤仅含 choices:[] 的最终统计块
    if (choices.length > 0 && !hasTerminalFinish) {
      const copy = { ...o } as Record<string, unknown>;
      delete copy.usage;
      return 'data: ' + JSON.stringify(copy);
    }
  } catch {
    return line;
  }
  return line;
}

/**
 * 从上游读 SSE 字节流，双路处理：
 * - 每凑齐一行完整行：先 `processUsageFromDataLine` 更新计费统计；
 *   再 `transformStreamUsageForClient` 得到发给客户端的文本，拼成 `forward` 写出。
 * - 上游 `read()` 可能截断在半个 UTF-8 字符或半行，剩余留在 `state.lineBuffer`。
 * - `done === true` 时：若缓冲区里还有未以换行结尾的残留，按「最后一行」再处理一次（与旧 `processRemainingLineBuffer` 等价）。
 *
 * 客户端断开时：不再写 `writer`，但仍继续读上游（直到 `POST_DISCONNECT_DRAIN_MS`）以便尽量拿到末尾 usage。
 */
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
        // 流结束：可能剩半行（无末尾换行），与循环内 `lines.pop()` 保留的未完成行一起在此 flush
        if (state.lineBuffer.trim()) {
          const line = state.lineBuffer.trim();
          state.lineBuffer = '';
          processUsageFromDataLine(line, usage);
          if (!clientDisconnected) {
            try {
              await writer.write(encoder.encode(transformStreamUsageForClient(line) + '\n'));
            } catch {
              clientDisconnected = true;
              disconnectTime = Date.now();
              usage.cancelled = true;
            }
          }
        }
        break;
      }

      state.lineBuffer += decoder.decode(value, { stream: true });
      const lines = state.lineBuffer.split('\n');
      // 最后一项可能是不完整行，留到下次 read 或流结束时的 EOF 分支
      state.lineBuffer = lines.pop() ?? '';

      let forward = '';
      for (const line of lines) {
        processUsageFromDataLine(line, usage);
        forward += transformStreamUsageForClient(line) + '\n';
      }

      if (forward && !clientDisconnected) {
        try {
          await writer.write(encoder.encode(forward));
        } catch {
          clientDisconnected = true;
          disconnectTime = Date.now();
          usage.cancelled = true;
          console.log(
            '[Gateway Proxy] client disconnected, draining upstream for usage input_tokens=%s output_tokens=%s',
            usage.input_tokens,
            usage.output_tokens
          );
        }
      }

      if (
        clientDisconnected &&
        disconnectTime > 0 &&
        Date.now() - disconnectTime > POST_DISCONNECT_DRAIN_MS
      ) {
        console.log('[Gateway Proxy] drain timeout, resolving with partial usage');
        await reader.cancel();
        break;
      }
    }
  } catch (err) {
    console.warn('[Gateway Proxy] pump error', err instanceof Error ? err.message : String(err));
  } finally {
    requestSignal?.removeEventListener('abort', onAbort);
    resolveUsage(usage);
    try {
      await writer.close();
    } catch (err) {
      console.warn(
        '[Gateway Proxy] pump writer.close (non-fatal)',
        err instanceof Error ? err.message : String(err),
        { clientDisconnected, usageCancelled: usage.cancelled }
      );
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
    // resolveUsage already called in finally
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
  let usage: UsageFromStream = EMPTY_USAGE_LOCAL;
  try {
    const text = await response.text();
    const parsed = JSON.parse(text) as { usage?: ProviderUsage };
    if (parsed.usage) {
      usage = usageFromProvider(parsed.usage);
    }
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
 * 向供应商发起 OpenAI 兼容 `POST …/chat/completions`：合并路由默认参数、`model` 换为上游名。
 * 流式响应解析 SSE 中的 usage（含对客户端转发的 usage 裁剪逻辑，见文件头说明）；非 JSON 200 走流处理分支。
 * @param route 已解析的 openai 协议路由（含 baseUrl、密钥、providerModelName）
 * @param body 客户端原始 JSON 体
 * @param requestSignal 用于检测取消并在断连后限时 drain 上游以尽量拿到末尾 usage
 * @returns 原样或包装后的 `Response` + 异步解析完成的 `usagePromise`
 */
export async function dispatchOpenAiRoute(
  route: RouteResult,
  body: Record<string, unknown>,
  requestSignal?: AbortSignal
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream> }> {
  const url = buildUrl(route.baseUrl);
  const requestBody = {
    ...buildRouteRequestBody(route, body),
    model: route.providerModelName,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${route.providerApiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (response.ok && response.body) {
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      return nonStreamResponseWithUsage(response);
    }
    return streamResponseWithUsage(response, requestSignal);
  }

  return {
    response,
    usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
  };
}
