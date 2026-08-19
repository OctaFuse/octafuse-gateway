/**
 * 用户路由：`POST /v1/messages`（Anthropic Messages 协议），逻辑与 chat 对称，仅上游 driver 与协议筛选不同。
 */
import { Hono } from 'hono';
import type { Env } from '../../app';
import { requireApiKey } from '../../middleware/auth';
import {
  resolveRoutesForSurface,
  type RouteResult,
} from '../../services/model-router';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import {
  buildAffinityKey,
  buildTierKeyPrefix,
  resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { proxyAnthropicMessages, EMPTY_USAGE, type UsageFromStream } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeAnthropicToolsForLog } from '../../services/request-log-tools-summary';
import { buildRouteRequestBody } from '../../services/route-default-params';
import { recordUsage } from '../../services/usage-tracker';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import { stickyConfigFromSurface } from '../../services/provider-sticky-routing';
import {
  computeRequestLogStatus,
  formatHttpErrorTextForRequestLog,
  materializeNonOkResponse,
} from '../../services/request-log-record-status';
import {
  maybeBlockUserModelCircuit,
  maybeTriggerUserModelCircuitFromUpstream,
  markUserModelSuccess,
} from '../../services/user-model-circuit-route';
import { GatewayErrorCode } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { RequestTimingCollector } from '../../services/request-timing';

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
  const timing = new RequestTimingCollector();

  let body: { model?: string; [k: string]: unknown };
  try {
    body = await c.req.json();
  } catch {
    return gatewayErrorJson(c, {
      status: 400,
      code: GatewayErrorCode.invalidJson,
      message: 'Invalid JSON body',
    });
  }

  const rawModelId = typeof body.model === 'string' ? body.model.trim() : null;
  if (!rawModelId) {
    return gatewayErrorJson(c, {
      status: 400,
      code: GatewayErrorCode.missingModel,
      message: 'Missing model',
    });
  }

  const resolved = await resolveModelRouting(repos, rawModelId);
  if (!resolved) {
    return gatewayErrorJson(c, {
      status: 404,
      code: GatewayErrorCode.modelNotFound,
      message: 'Model not found',
    });
  }
  const { model, baseModelId, explicitGroup } = resolved;
  const effectiveRouteGroup = explicitGroup?.trim() || 'default';

  if (apiKey.budgetMax != null && apiKey.budgetSpent >= apiKey.budgetMax) {
    return gatewayErrorJson(c, {
      status: 403,
      code: GatewayErrorCode.budgetExceeded,
      message: 'Budget exceeded',
    });
  }

  let routes: RouteResult[];
  let poolStrategy: string | null = null;
  let poolTierStrategies: string | null = null;
  let stickySurface: import('@octafuse/core').ResolvedModelSurfaceRow | null = null;
  try {
    const resolvedSurface = await resolveRoutesForSurface(repos, {
      modelId: baseModelId,
      routeGroup: effectiveRouteGroup,
      requestProtocol: 'anthropic',
      requestOperation: 'messages',
    });
    routes = resolvedSurface.routes;
    poolStrategy = resolvedSurface.surface?.pool_strategy ?? null;
    poolTierStrategies = resolvedSurface.surface?.pool_tier_strategies ?? null;
    stickySurface = resolvedSurface.surface;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Model route resolution failed';
    return gatewayErrorJson(c, {
      status: 502,
      code: GatewayErrorCode.routeResolutionFailed,
      message,
    });
  }
  if (routes.length === 0) {
    return gatewayErrorJson(c, {
      status: 502,
      code: GatewayErrorCode.noRoute,
      message: `No Anthropic route in route group "${effectiveRouteGroup}" for this model`,
    });
  }

  const modelNameForLog =
    model.display_name != null && String(model.display_name).trim() !== ''
      ? String(model.display_name).trim()
      : baseModelId;
  const requestBodyForLog = anthropicRequestBodyForLog(body as Record<string, unknown>);

  const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
    baseModelId,
    modelNameForLog,
    requestBodyForLog,
    requestProtocol: 'anthropic',
    startMs: start,
    timing,
  });
  if (circuitBlocked) {
    return circuitBlocked;
  }

  const requestSignal = c.req.raw.signal;
  const strategyPlan = await resolveRouteStrategyPlan({
    routePolicyRaw: model.route_policy ?? null,
    poolStrategy,
    poolTierStrategies,
    protocol: 'anthropic',
    capability: 'messages',
    routeGroup: effectiveRouteGroup,
    repos,
  });
  const affinityKey = buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'anthropic');
  const tierKeyPrefix = buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'anthropic');
  timing.markGatewayComplete();
  const proxyResult = await proxyAnthropicMessages(repos, routes, body, requestSignal, {
    affinityKey,
    tierKeyPrefix,
    strategy: strategyPlan.base,
    tierStrategies: strategyPlan.tierOverrides,
    timing,
    routePoolId: stickySurface?.route_pool_id ?? routes[0]?.routePoolId ?? null,
    sticky: stickyConfigFromSurface(stickySurface),
  });
  const {
    usagePromise,
    chosenRoute,
    upstreamRequestId,
    circuitEvents,
    suppressErrorAlert,
    stickyTrace,
    stickyMutationPromise,
  } = proxyResult;
  if (stickyMutationPromise) {
    scheduleBackgroundWork(c, stickyMutationPromise);
  }
  const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);

  let userModelCircuitEvent = null;
  if (response.ok) {
    markUserModelSuccess(apiKey.userId, baseModelId);
  } else if (errorBodyText != null) {
    userModelCircuitEvent = maybeTriggerUserModelCircuitFromUpstream(
      apiKey.userId,
      baseModelId,
      response.status,
      response.headers.get('content-type'),
      errorBodyText,
      formatHttpErrorTextForRequestLog(
        response.status,
        response.headers.get('content-type'),
        errorBodyText
      )
    );
  }

  const alertCircuitEvents = userModelCircuitEvent
    ? [...circuitEvents, userModelCircuitEvent]
    : circuitEvents;

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
        if (timedOut) timing.markStreamComplete();
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
        } else if (errorBodyText != null) {
          errorMessage = formatHttpErrorTextForRequestLog(
            response.status,
            response.headers.get('content-type'),
            errorBodyText
          );
        } else {
          errorMessage = `HTTP ${response.status}`;
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
          request_operation: 'messages',
          upstream_protocol: chosenRoute.upstreamProtocol,
          upstream_operation: chosenRoute.upstreamOperation,
          model_surface_id: chosenRoute.modelSurfaceId,
          route_pool_id: chosenRoute.routePoolId,
          route_target_id: chosenRoute.targetId,
          adapter: chosenRoute.adapter,
          sticky_trace: stickyTrace ? await stickyTrace() : null,
          usage: usageCollected,
          model_pricing_profile: model.pricing_profile ?? null,
          route_price_override_json: chosenRoute.priceOverrideRaw,
          user_charged_cost_factors_json: apiKey.chargedCostFactors,
          route_metered_profile_json: chosenRoute.routeMeteredProfileJson,
          route_charged_profile_json: chosenRoute.routeChargedProfileJson,
          request_started_at_ms: start,
          route_group: chosenRoute.routeGroup,
          status,
          latency_ms: latency,
          timing: timing.snapshot(),
          error_message: errorMessage,
          provider_key_id: chosenRoute.providerKeyId ?? null,
          provider_key_label: chosenRoute.providerKeyLabel ?? null,
          provider_key_fingerprint: chosenRoute.providerKeyFingerprint ?? null,
          upstream_request_id: upstreamRequestId,
          upstream_message_id: usageCollected.upstreamMessageId ?? null,
          circuit_events: alertCircuitEvents.length > 0 ? alertCircuitEvents : undefined,
          suppress_error_alert: suppressErrorAlert || undefined,
        });
      })
      .catch(() => {
        // ignore recordUsage failure in response path
      })
  );

  return response;
});
