/**
 * 用户路由：`POST /v1/chat/completions`（OpenAI 协议）。
 * 流程：鉴权 → 解析 model 与 route_group → 预算校验 → 按协议筛选路由并 proxy 故障转移 → 异步记账。
 */
import { Hono } from 'hono';
import type { Env } from '../../app';
import { requireApiKey } from '../../middleware/auth';
import {
  getActiveModelRouteRows,
  resolveRouteResultsFromRows,
  type RouteResult,
} from '../../services/model-router';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import { selectActiveRouteRows } from '../../services/route-selection';
import { proxyChatCompletions, EMPTY_USAGE, type UsageFromStream } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeOpenAiToolsForLog } from '../../services/request-log-tools-summary';
import { buildRouteRequestBody } from '../../services/route-default-params';
import { recordUsage } from '../../services/usage-tracker';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import {
  computeRequestLogStatus,
  formatHttpErrorForRequestLog,
} from '../../services/request-log-record-status';

/** 流若长期不结束（上游挂死），超过此时长仍无 usage 则按 incomplete 记账；正常/取消场景通常很快结束。 */
const USAGE_SAFETY_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

/** OpenAI Chat Completions：去掉消息与内嵌多模态 data，保留采样/工具等元数据。 */
function openAiBodyRedactedForLog(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'messages' || k === 'input' || k === 'prompt' || k === 'data') {
      continue;
    }
    if (k === 'tools') {
      Object.assign(out, summarizeOpenAiToolsForLog(v));
      continue;
    }
    out[k] = v;
  }
  if (Array.isArray(body.messages)) {
    out._messages_count = body.messages.length;
  }
  return out;
}

function openAiRequestBodyForLog(body: Record<string, unknown>): string | null {
  return finalizeRequestLogJson(openAiBodyRedactedForLog(body));
}

/** 与 openai-driver 一致：`{ ...buildRouteRequestBody, model }` 再脱敏（与 messages 分写，便于日后分叉）。 */
function openAiUpstreamWireBodyForLog(route: RouteResult, body: Record<string, unknown>): string | null {
  const merged = buildRouteRequestBody(route, body);
  const wire = { ...merged, model: route.providerModelName };
  return finalizeRequestLogJson(openAiBodyRedactedForLog(wire));
}

/** 是否已从流/响应中拿到任一有效 token 计数（用于判定 incomplete）。 */
function hasUsage(u: UsageFromStream): boolean {
  return u.total_tokens > 0 || u.input_tokens > 0 || u.output_tokens > 0;
}

/** 本路由在根 `Env` 上收窄 `Variables.apiKey` 为必填。 */
type ChatEnv = Env & { Variables: { apiKey: import('../../middleware/auth').ApiKeyContext } };

export const chatRoutes = new Hono<ChatEnv>();

chatRoutes.use('*', requireApiKey);

/** body 须含 `model`；流式结束时异步记账，含 usage 兜底超时。 */
chatRoutes.post('/', async (c) => {
  const repos = c.get('repositories');
  const apiKey = c.get('apiKey');
  const start = Date.now();

  let body: { model?: string; [k: string]: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const rawModelId = typeof body.model === 'string' ? body.model.trim() : null;
  if (!rawModelId) {
    return c.json({ error: 'Missing model' }, 400);
  }

  const resolved = await resolveModelRouting(repos, rawModelId);
  if (!resolved) {
    return c.json({ error: 'Model not found' }, 404);
  }
  const { model, baseModelId, explicitGroup } = resolved;
  const effectiveRouteGroup = explicitGroup?.trim() || 'default';

  if (apiKey.budgetMax != null && apiKey.budgetSpent >= apiKey.budgetMax) {
    return c.json({ error: 'Budget exceeded' }, 403);
  }

  let routes: RouteResult[];
  try {
    const routeRows = await getActiveModelRouteRows(repos, baseModelId);
    const selectedRows = selectActiveRouteRows(routeRows, explicitGroup);
    if (selectedRows.length === 0) {
      return c.json(
        { error: `No active routes for route group "${effectiveRouteGroup}" for this model` },
        400
      );
    }
    routes = await resolveRouteResultsFromRows(repos, selectedRows);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Model route resolution failed';
    console.error('[Gateway Chat] model route resolution failed', { baseModelId, err });
    return c.json({ error: message }, 502);
  }

  routes = routes.filter((route) => route.upstreamProtocol === 'openai');
  if (routes.length === 0) {
    console.warn('[Gateway Chat] no openai route for model', { baseModelId, effectiveRouteGroup });
    return c.json(
      {
        error: `No OpenAI route in route group "${effectiveRouteGroup}" for this model`,
      },
      502
    );
  }

  console.log(
    `[Gateway Chat] forwarding baseModelId=${baseModelId} clientModel=${rawModelId} providerIds=${routes.map((r) => r.providerId).join(',')} keyId=${apiKey.keyId}`
  );

  const requestSignal = c.req.raw.signal;
  const { response, usagePromise, chosenRoute } = await proxyChatCompletions(
    routes,
    body,
    requestSignal
  );

  const modelNameForLog =
    model.display_name != null && String(model.display_name).trim() !== ''
      ? String(model.display_name).trim()
      : baseModelId;
  const requestBodyForLog = openAiRequestBodyForLog(body as Record<string, unknown>);

  // Record when stream ends (usagePromise). Safety timeout only for streams that never end.
  const usageOrSafety = Promise.race([
    usagePromise.then((u) => ({
      usage: u,
      incomplete: !hasUsage(u),
      timedOut: false as const,
    })),
    new Promise<{ usage: typeof EMPTY_USAGE; incomplete: true; timedOut: true }>((resolve) =>
      setTimeout(
        () => resolve({ usage: EMPTY_USAGE, incomplete: true, timedOut: true }),
        USAGE_SAFETY_TIMEOUT_MS
      )
    ),
  ]);

  scheduleBackgroundWork(
    c,
    usageOrSafety
      .then(async ({ usage: usageCollected, incomplete, timedOut }) => {
        const latency = Date.now() - start;
        const status = computeRequestLogStatus({
          cancelled: Boolean(usageCollected.cancelled),
          responseOk: response.ok,
          incomplete,
        });
        let errorMessage: string | undefined;
        if (status === 'success') {
          errorMessage = undefined;
        } else if (status === 'cancelled') {
          errorMessage = 'Client disconnected (e.g. user cancelled)';
        } else if (status === 'incomplete') {
          errorMessage = timedOut
            ? 'Stream usage timeout (no usage within limit)'
            : 'Stream ended before usage available';
        } else {
          errorMessage = await formatHttpErrorForRequestLog(response);
        }
        const upstreamRequestBodyForLog = openAiUpstreamWireBodyForLog(chosenRoute, body as Record<string, unknown>);
        return recordUsage(repos, {
          api_key_id: apiKey.keyId,
          user_id: apiKey.userId,
          user_email: apiKey.userEmail,
          model_id: baseModelId,
          provider_id: chosenRoute.providerId,
          provider_model_name: chosenRoute.providerModelName,
          model_name: modelNameForLog,
          provider_name: chosenRoute.providerName,
          request_body: requestBodyForLog,
          upstream_request_body: upstreamRequestBodyForLog,
          request_protocol: 'openai',
          upstream_protocol: chosenRoute.upstreamProtocol,
          usage: usageCollected,
          model_pricing_profile: model.pricing_profile ?? null,
          route_price_override_json: chosenRoute.priceOverrideRaw,
          route_metered_profile_json: chosenRoute.routeMeteredProfileJson,
          route_charged_profile_json: chosenRoute.routeChargedProfileJson,
          route_group: chosenRoute.routeGroup,
          status,
          latency_ms: latency,
          error_message: errorMessage,
        });
      })
      .catch((err) => {
        console.error(
          `[Gateway Chat] recordUsage failed baseModelId=${baseModelId} keyId=${apiKey.keyId} error=${err instanceof Error ? err.message : String(err)}`
        );
      })
  );

  return response;
});
