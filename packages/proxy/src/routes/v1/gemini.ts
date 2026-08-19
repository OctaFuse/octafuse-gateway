/**
 * 用户路由：`POST /v1beta/models/{model}:{generateContent|streamGenerateContent}`（Gemini 风格路径）。
 */
import { GEMINI_GENERATE_OPERATION } from '@octafuse/core';
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
import { proxyGeminiContent, EMPTY_USAGE, type UsageFromStream } from '../../services/proxy';
import { buildRouteRequestBody } from '../../services/route-default-params';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeGeminiToolsForLog } from '../../services/request-log-tools-summary';
import { resolveGeminiLoggedRequestId } from '../../services/egress/upstream-request-id';
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

/** usage Promise 兜底超时（与 OpenAI/Anthropic 路由一致）。 */
const USAGE_SAFETY_TIMEOUT_MS = 5 * 60 * 1000;

/** Gemini generateContent：去掉 contents / systemInstruction；tools 仅保留名称摘要；并记录 action。 */
function geminiBodyRedactedForLog(
  body: Record<string, unknown>,
  action?: 'generateContent' | 'streamGenerateContent'
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'contents' || k === 'systemInstruction' || k === 'system_instruction') {
      continue;
    }
    if (k === 'tools') {
      Object.assign(out, summarizeGeminiToolsForLog(v));
      continue;
    }
    out[k] = v;
  }
  if (Array.isArray(body.contents)) {
    out._contents_count = body.contents.length;
  }
  if (action) {
    out._gemini_action = action;
  }
  return out;
}

function geminiRequestBodyForLog(
  body: Record<string, unknown>,
  action: 'generateContent' | 'streamGenerateContent'
): string | null {
  return finalizeRequestLogJson(geminiBodyRedactedForLog(body, action));
}

/** 与 gemini-driver 一致：仅 `buildRouteRequestBody`（模型在 URL）。 */
function geminiUpstreamWireBodyForLog(
  route: RouteResult,
  body: Record<string, unknown>,
  action: 'generateContent' | 'streamGenerateContent'
): string | null {
  const merged = buildRouteRequestBody(route, body) as Record<string, unknown>;
  return finalizeRequestLogJson(geminiBodyRedactedForLog(merged, action));
}

/** 流/响应是否已产出可用 token 统计。 */
function hasUsage(u: UsageFromStream): boolean {
  return (
    u.total_tokens > 0 ||
    u.input_tokens > 0 ||
    u.output_tokens > 0 ||
    u.reasoning_tokens > 0
  );
}

/** 与 chat/messages 相同：`Variables.apiKey` 在鉴权后注入。 */
type GeminiEnv = Env & { Variables: { apiKey: import('../../middleware/auth').ApiKeyContext } };

/**
 * 解析路径参数 `modelAction`：`{modelId}:{generateContent|streamGenerateContent}`（以最后一个 `:` 分隔）。
 * @returns 非法格式或 action 名不对时 null
 */
function parseGeminiAction(
  modelAction: string
): { modelId: string; action: 'generateContent' | 'streamGenerateContent' } | null {
  const idx = modelAction.lastIndexOf(':');
  if (idx <= 0 || idx >= modelAction.length - 1) {
    return null;
  }
  const modelId = modelAction.slice(0, idx).trim();
  const actionRaw = modelAction.slice(idx + 1).trim();
  if (!modelId) return null;
  if (actionRaw !== 'generateContent' && actionRaw !== 'streamGenerateContent') {
    return null;
  }
  return { modelId, action: actionRaw };
}

export const geminiRoutes = new Hono<GeminiEnv>();

geminiRoutes.use('*', requireApiKey);

/** `modelAction` 形如 `{modelId}:{generateContent|streamGenerateContent}`（见 `parseGeminiAction`）。 */
geminiRoutes.post('/models/:modelAction', async (c) => {
  const repos = c.get('repositories');
  const apiKey = c.get('apiKey');
  const start = Date.now();
  const timing = new RequestTimingCollector();
  const parsedAction = parseGeminiAction(c.req.param('modelAction'));
  if (!parsedAction) {
    return gatewayErrorJson(c, {
      status: 400,
      code: GatewayErrorCode.invalidRequest,
      message:
        'Invalid Gemini path, expected /v1beta/models/{model}:{generateContent|streamGenerateContent}',
    });
  }

  const { modelId: pathModelId, action } = parsedAction;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return gatewayErrorJson(c, {
      status: 400,
      code: GatewayErrorCode.invalidJson,
      message: 'Invalid JSON body',
    });
  }

  const resolved = await resolveModelRouting(repos, pathModelId);
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
      requestProtocol: 'gemini',
      requestOperation: GEMINI_GENERATE_OPERATION,
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
      message: `No Gemini route in route group "${effectiveRouteGroup}" for this model`,
    });
  }

  const modelNameForLog =
    model.display_name != null && String(model.display_name).trim() !== ''
      ? String(model.display_name).trim()
      : baseModelId;
  const requestBodyForLog = geminiRequestBodyForLog(body, action);

  const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
    baseModelId,
    modelNameForLog,
    requestBodyForLog,
    requestProtocol: 'gemini',
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
    protocol: 'gemini',
    capability: GEMINI_GENERATE_OPERATION,
    routeGroup: effectiveRouteGroup,
    repos,
  });
  const affinityKey = buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'gemini');
  const tierKeyPrefix = buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'gemini');
  timing.markGatewayComplete();
  const proxyResult = await proxyGeminiContent(
    repos,
    routes,
    action,
    body,
    c.req.url.includes('?') ? c.req.url.slice(c.req.url.indexOf('?')) : '',
    requestSignal,
    {
      affinityKey,
      tierKeyPrefix,
      strategy: strategyPlan.base,
      tierStrategies: strategyPlan.tierOverrides,
      timing,
      routePoolId: stickySurface?.route_pool_id ?? routes[0]?.routePoolId ?? null,
      sticky: stickyConfigFromSurface(stickySurface),
    }
  );
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
        const upstreamRequestBodyForLog = geminiUpstreamWireBodyForLog(chosenRoute, body, action);
        const loggedRequestId = resolveGeminiLoggedRequestId({
          headerRequestId: upstreamRequestId,
          bodyRequestId: usageCollected.upstreamBodyRequestId ?? null,
        });
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
          request_protocol: 'gemini',
          request_operation: GEMINI_GENERATE_OPERATION,
          upstream_protocol: chosenRoute.upstreamProtocol,
          upstream_operation: chosenRoute.upstreamOperation,
          model_surface_id: chosenRoute.modelSurfaceId,
          route_pool_id: chosenRoute.routePoolId,
          route_target_id: chosenRoute.targetId,
          adapter: chosenRoute.adapter,
          gemini_wire_action: action,
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
          upstream_request_id: loggedRequestId,
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
