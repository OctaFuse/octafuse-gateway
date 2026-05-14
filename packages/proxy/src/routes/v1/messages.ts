/**
 * 用户路由：`POST /v1/messages`（Anthropic Messages 协议），逻辑与 chat 对称，仅上游 driver 与协议筛选不同。
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
import { proxyAnthropicMessages, EMPTY_USAGE, type UsageFromStream } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeAnthropicToolsForLog } from '../../services/request-log-tools-summary';
import { buildRouteRequestBody } from '../../services/route-default-params';
import { recordUsage } from '../../services/usage-tracker';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import {
  computeRequestLogStatus,
  formatHttpErrorForRequestLog,
} from '../../services/request-log-record-status';

/** 同 chat：usage Promise 兜底超时，避免永久挂起。 */
const USAGE_SAFETY_TIMEOUT_MS = 5 * 60 * 1000;

/** Anthropic Messages：去掉 messages / system 正文；tools 仅保留名称摘要。 */
function anthropicBodyRedactedForLog(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'messages' || k === 'system') {
      continue;
    }
    if (k === 'tools') {
      Object.assign(out, summarizeAnthropicToolsForLog(v));
      continue;
    }
    out[k] = v;
  }
  if (Array.isArray(body.messages)) {
    out._messages_count = body.messages.length;
  }
  return out;
}

function anthropicRequestBodyForLog(body: Record<string, unknown>): string | null {
  return finalizeRequestLogJson(anthropicBodyRedactedForLog(body));
}

/** 与 anthropic-driver 一致：`{ ...buildRouteRequestBody, model }` 再脱敏（与 chat 分写，便于日后分叉）。 */
function anthropicUpstreamWireBodyForLog(route: RouteResult, body: Record<string, unknown>): string | null {
  const merged = buildRouteRequestBody(route, body);
  const wire = { ...merged, model: route.providerModelName };
  return finalizeRequestLogJson(anthropicBodyRedactedForLog(wire));
}

/** 是否已解析到有效 token 用量（与 chat 一致）。 */
function hasUsage(u: UsageFromStream): boolean {
  return u.total_tokens > 0 || u.input_tokens > 0 || u.output_tokens > 0;
}

/** 与 chat 相同：`apiKey` 在鉴权后必有。 */
type MessagesEnv = Env & { Variables: { apiKey: import('../../middleware/auth').ApiKeyContext } };

export const messagesRoutes = new Hono<MessagesEnv>();

messagesRoutes.use('*', requireApiKey);

/** Anthropic Messages：路由解析、预算与 failover 与 chat 对称，仅上游协议为 `anthropic`。 */
messagesRoutes.post('/', async (c) => {
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
    return c.json({ error: message }, 502);
  }
  routes = routes.filter((route) => route.upstreamProtocol === 'anthropic');
  if (routes.length === 0) {
    return c.json(
      {
        error: `No Anthropic route in route group "${effectiveRouteGroup}" for this model`,
      },
      502
    );
  }

  const requestSignal = c.req.raw.signal;
  const { response, usagePromise, chosenRoute } = await proxyAnthropicMessages(
    routes,
    body,
    requestSignal
  );

  const modelNameForLog =
    model.display_name != null && String(model.display_name).trim() !== ''
      ? String(model.display_name).trim()
      : baseModelId;
  const requestBodyForLog = anthropicRequestBodyForLog(body as Record<string, unknown>);

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
        const upstreamRequestBodyForLog = anthropicUpstreamWireBodyForLog(
          chosenRoute,
          body as Record<string, unknown>
        );
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
          request_protocol: 'anthropic',
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
      .catch(() => {
        // ignore recordUsage failure in response path
      })
  );

  return response;
});
