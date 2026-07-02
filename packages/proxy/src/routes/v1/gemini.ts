/**
 * 用户路由：`POST /v1beta/models/{model}:{generateContent|streamGenerateContent}`（Gemini 风格路径）。
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
import { proxyGeminiContent, EMPTY_USAGE, type UsageFromStream } from '../../services/proxy';
import { buildRouteRequestBody } from '../../services/route-default-params';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeGeminiToolsForLog } from '../../services/request-log-tools-summary';
import { resolveGeminiLoggedRequestId } from '../../services/egress/upstream-request-id';
import { recordUsage } from '../../services/usage-tracker';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import {
  computeRequestLogStatus,
  formatHttpErrorTextForRequestLog,
  materializeNonOkResponse,
} from '../../services/request-log-record-status';
import {
  maybeBlockSensitiveContentCircuit,
  maybeTriggerSensitiveContentCircuitFromUpstream,
} from '../../services/sensitive-content-circuit-route';

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
  const parsedAction = parseGeminiAction(c.req.param('modelAction'));
  if (!parsedAction) {
    return c.json({ error: 'Invalid Gemini path, expected /v1beta/models/{model}:{generateContent|streamGenerateContent}' }, 400);
  }

  const { modelId: pathModelId, action } = parsedAction;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const resolved = await resolveModelRouting(repos, pathModelId);
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
  routes = routes.filter((route) => route.upstreamProtocol === 'gemini');
  if (routes.length === 0) {
    return c.json(
      {
        error: `No Gemini route in route group "${effectiveRouteGroup}" for this model`,
      },
      502
    );
  }

  const modelNameForLog =
    model.display_name != null && String(model.display_name).trim() !== ''
      ? String(model.display_name).trim()
      : baseModelId;
  const requestBodyForLog = geminiRequestBodyForLog(body, action);

  const circuitBlocked = maybeBlockSensitiveContentCircuit(c, repos, apiKey, {
    baseModelId,
    modelNameForLog,
    requestBodyForLog,
    requestProtocol: 'gemini',
    startMs: start,
  });
  if (circuitBlocked) {
    return circuitBlocked;
  }

  const requestSignal = c.req.raw.signal;
  const proxyResult = await proxyGeminiContent(
    repos,
    routes,
    action,
    body,
    c.req.url.includes('?') ? c.req.url.slice(c.req.url.indexOf('?')) : '',
    requestSignal
  );
  const { usagePromise, chosenRoute, upstreamRequestId } = proxyResult;
  const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);

  if (errorBodyText != null) {
    maybeTriggerSensitiveContentCircuitFromUpstream(
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
          provider_key_id: chosenRoute.providerKeyId ?? null,
          provider_key_label: chosenRoute.providerKeyLabel ?? null,
          provider_key_fingerprint: chosenRoute.providerKeyFingerprint ?? null,
          upstream_request_id: loggedRequestId,
          upstream_message_id: usageCollected.upstreamMessageId ?? null,
        });
      })
      .catch(() => {
        // ignore recordUsage failure in response path
      })
  );

  return response;
});
