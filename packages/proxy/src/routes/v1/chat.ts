/**
 * 用户路由：`POST /v1/chat/completions`（OpenAI 协议）。
 * 流程：鉴权 → 解析 model 与 route_group → 预算校验 → 按协议筛选路由并 proxy 故障转移 → 异步记账。
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
import { proxyChatCompletions, EMPTY_USAGE, type UsageFromStream } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeOpenAiToolsForLog } from '../../services/request-log-tools-summary';
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
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });
    routes = resolvedSurface.routes;
    poolStrategy = resolvedSurface.surface?.pool_strategy ?? null;
    poolTierStrategies = resolvedSurface.surface?.pool_tier_strategies ?? null;
    stickySurface = resolvedSurface.surface;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Model route resolution failed';
    console.error('[Gateway Chat] model route resolution failed', { baseModelId, err });
    return gatewayErrorJson(c, {
      status: 502,
      code: GatewayErrorCode.routeResolutionFailed,
      message,
    });
  }

  if (routes.length === 0) {
    console.warn('[Gateway Chat] no openai route for model', { baseModelId, effectiveRouteGroup });
    return gatewayErrorJson(c, {
      status: 502,
      code: GatewayErrorCode.noRoute,
      message: `No OpenAI route in route group "${effectiveRouteGroup}" for this model`,
    });
  }

  console.log(
    `[Gateway Chat] forwarding baseModelId=${baseModelId} clientModel=${rawModelId} providerIds=${routes.map((r) => r.providerId).join(',')} keyId=${apiKey.keyId}`
  );

  const modelNameForLog =
    model.display_name != null && String(model.display_name).trim() !== ''
      ? String(model.display_name).trim()
      : baseModelId;
  const requestBodyForLog = openAiRequestBodyForLog(body as Record<string, unknown>);

  const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
    baseModelId,
    modelNameForLog,
    requestBodyForLog,
    requestProtocol: 'openai',
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
    protocol: 'openai',
    capability: 'chat',
    routeGroup: effectiveRouteGroup,
    repos,
  });
  const affinityKey = buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'openai');
  const tierKeyPrefix = buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'openai');
  timing.markGatewayComplete();
  const proxyResult = await proxyChatCompletions(repos, routes, body, requestSignal, {
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
          request_operation: 'chat',
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
      .catch((err) => {
        console.error(
          `[Gateway Chat] recordUsage failed baseModelId=${baseModelId} keyId=${apiKey.keyId} error=${err instanceof Error ? err.message : String(err)}`
        );
      })
  );

  return response;
});
