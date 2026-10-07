/**
 * DashScope SpeechSynthesizer 透传。
 * `POST /v1/dashscope/services/audio/tts/SpeechSynthesizer`
 * `X-DashScope-SSE: enable` 走 `audio.speech.stream`，否则走 `audio.speech`。
 */
import { isAudioSpeechModel, type GatewayRepositories } from '@octafuse/core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../app';
import { requireApiKey, type ApiKeyContext } from '../../middleware/auth';
import { resolveRoutesForSurface } from '../../services/model-router';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { proxyDashScopeJsonPassthrough } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { canAffordAudioCost, estimateAudioBudgetPrecheck, recordAudioUsage } from '../../services/audio-usage-charge';
import { apiKeyHasBalance } from '../../services/tool-usage-charge';
import { formatHttpErrorTextForRequestLog, materializeNonOkResponse } from '../../services/request-log-record-status';
import {
	maybeBlockUserModelCircuit,
	maybeTriggerUserModelCircuitFromUpstream,
	markUserModelSuccess,
} from '../../services/user-model-circuit-route';
import { GatewayErrorCode, NO_AVAILABLE_ROUTE_MESSAGE } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { RequestTimingCollector } from '../../services/request-timing';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import { stickyConfigFromSurface } from '../../services/provider-sticky-routing';

type SpeechEnv = Env & { Variables: { apiKey: ApiKeyContext } };

export const dashScopeSpeechRoutes = new Hono<SpeechEnv>();

dashScopeSpeechRoutes.use('*', requireApiKey);

dashScopeSpeechRoutes.post('/', async (c) => {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const start = Date.now();
	const timing = new RequestTimingCollector();
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidJson, message: 'Invalid JSON body' });
	}
	if (body == null || typeof body !== 'object' || Array.isArray(body)) {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidRequest, message: 'JSON body must be an object' });
	}
	const requestBody = body as Record<string, unknown>;
	const rawModelId = typeof requestBody.model === 'string' ? requestBody.model.trim() : '';
	if (!rawModelId) {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidRequest, message: 'Missing model' });
	}
	const preview = await resolveModelRouting(repos, rawModelId);
	if (!preview) {
		return gatewayErrorJson(c, {
			status: 404,
			code: GatewayErrorCode.modelNotFound,
			message: `Model not found: ${rawModelId.slice(0, 200)}`,
		});
	}
	if (!isAudioSpeechModel(preview.model)) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'DashScope SpeechSynthesizer passthrough requires a speech model',
		});
	}
	const requestOperation = c.req.header('X-DashScope-SSE') === 'enable' ? 'audio.speech.stream' : 'audio.speech';
	return forwardDashScopeSpeech(c, repos, apiKey, preview, requestOperation, requestBody, start, timing);
});

async function forwardDashScopeSpeech(
	c: Context<SpeechEnv>,
	repos: GatewayRepositories,
	apiKey: ApiKeyContext,
	preview: Awaited<ReturnType<typeof resolveModelRouting>> & object,
	requestOperation: 'audio.speech' | 'audio.speech.stream',
	requestBody: Record<string, unknown>,
	start: number,
	timing: RequestTimingCollector,
): Promise<Response> {
	const { model, baseModelId, explicitGroup } = preview;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	let resolvedSurface;
	try {
		resolvedSurface = await resolveRoutesForSurface(repos, {
			modelId: baseModelId,
			routeGroup: effectiveRouteGroup,
			requestProtocol: 'dashscope',
			requestOperation,
		});
	} catch (err) {
		return gatewayErrorJson(c, {
			status: 502,
			code: GatewayErrorCode.routeResolutionFailed,
			message: err instanceof Error ? err.message : 'Model route resolution failed',
		});
	}
	if (resolvedSurface.routes.length === 0) {
		return gatewayErrorJson(c, { status: 404, code: GatewayErrorCode.noRoute, message: NO_AVAILABLE_ROUTE_MESSAGE });
	}
	const routes = resolvedSurface.routes;
	const modelNameForLog =
		model.display_name != null && String(model.display_name).trim() !== ''
			? String(model.display_name).trim()
			: baseModelId;
	if (!apiKeyHasBalance(apiKey)) {
		return gatewayErrorJson(c, { status: 403, code: GatewayErrorCode.budgetExceeded, message: 'Budget exceeded' });
	}
	const estimate = await estimateAudioBudgetPrecheck(
		repos,
		{
			modelPricingProfileJson: model.pricing_profile ?? null,
			catalogModelId: baseModelId,
			userChargedCostFactorsJson: apiKey.chargedCostFactors,
			routeGroup: effectiveRouteGroup,
			fileBytes: 0,
			requestStartedAtMs: start,
		},
		routes.map((route) => route.priceOverrideRaw),
	);
	if (!canAffordAudioCost(apiKey.budgetMax, apiKey.budgetSpent, estimate.chargedCost, apiKey.walletGranted, apiKey.walletSpent)) {
		return gatewayErrorJson(c, { status: 403, code: GatewayErrorCode.budgetExceeded, message: 'Budget exceeded' });
	}
	const requestBodyForLog = finalizeRequestLogJson(requestBody);
	const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'dashscope',
		startMs: start,
		timing,
		clientErrorCircuitEnabled: false,
	});
	if (circuitBlocked) return circuitBlocked;
	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: resolvedSurface.surface?.pool_strategy ?? null,
		poolTierStrategies: resolvedSurface.surface?.pool_tier_strategies ?? null,
		protocol: 'dashscope',
		capability: requestOperation,
		routeGroup: effectiveRouteGroup,
		repos,
	});
	timing.markGatewayComplete();
	const proxyResult = await proxyDashScopeJsonPassthrough(repos, routes, requestOperation, requestBody, c.req.raw.signal, {
		affinityKey: buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'dashscope'),
		tierKeyPrefix: buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'dashscope'),
		strategy: strategyPlan.base,
		tierStrategies: strategyPlan.tierOverrides,
		timing,
		sticky: stickyConfigFromSurface(resolvedSurface.surface),
		inboundHeaders: c.req.raw.headers,
		dashScopeJson: { sse: c.req.header('X-DashScope-SSE') },
	});
	const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);
	const meta = proxyResult.meta;
	if (response.ok) markUserModelSuccess(apiKey.userId, baseModelId);
	const userModelCircuitEvent =
		!response.ok && errorBodyText != null
			? maybeTriggerUserModelCircuitFromUpstream(
					apiKey.userId,
					baseModelId,
					response.status,
					response.headers.get('content-type'),
					errorBodyText,
					formatHttpErrorTextForRequestLog(response.status, response.headers.get('content-type'), errorBodyText),
					{ clientErrorCircuitEnabled: false },
				)
			: null;
	const alertCircuitEvents = userModelCircuitEvent
		? [...proxyResult.circuitEvents, userModelCircuitEvent]
		: proxyResult.circuitEvents;
	const status = response.ok ? 'success' : 'error';
	scheduleBackgroundWork(
		c,
		(async () => {
			const usage = await proxyResult.usagePromise.catch(() => null);
			const stickyTraceSnapshot = proxyResult.stickyTrace ? await proxyResult.stickyTrace() : null;
			await recordAudioUsage({
				repos,
				apiKeyId: apiKey.keyId,
				userId: apiKey.userId,
				userEmail: apiKey.userEmail,
				ingressHost: apiKey.ingressHost,
				modelId: baseModelId,
				providerId: proxyResult.chosenRoute.providerId,
				providerModelName: proxyResult.chosenRoute.providerModelName,
				modelName: modelNameForLog,
				providerName: proxyResult.chosenRoute.providerName,
				requestBody: requestBodyForLog,
				requestProtocol: 'dashscope',
				requestOperation,
				upstreamProtocol: proxyResult.chosenRoute.upstreamProtocol,
				upstreamOperation: proxyResult.chosenRoute.upstreamOperation,
				modelSurfaceId: proxyResult.chosenRoute.modelSurfaceId,
				routePoolId: proxyResult.chosenRoute.routePoolId,
				routeTargetId: proxyResult.chosenRoute.targetId,
				adapter: proxyResult.chosenRoute.adapter,
				stickyTrace: stickyTraceSnapshot,
				routeGroup: effectiveRouteGroup,
				status,
				latencyMs: Date.now() - start,
				errorMessage:
					status === 'error'
						? errorBodyText != null
							? formatHttpErrorTextForRequestLog(response.status, response.headers.get('content-type'), errorBodyText)
							: `HTTP ${response.status}`
						: undefined,
				billing: {
					modelPricingProfileJson: model.pricing_profile ?? null,
					catalogModelId: baseModelId,
					userChargedCostFactorsJson: apiKey.chargedCostFactors,
					routeGroup: effectiveRouteGroup,
					routePriceOverrideJson: proxyResult.chosenRoute.priceOverrideRaw,
					durationSeconds: 0,
					durationSource: 'estimated',
					fileBytes: 0,
					characters: response.ok ? (meta?.audioCharacters ?? usage?.audio_characters ?? null) : null,
					requestStartedAtMs: start,
				},
				providerKeyId: proxyResult.chosenRoute.providerKeyId ?? null,
				providerKeyLabel: proxyResult.chosenRoute.providerKeyLabel ?? null,
				providerKeyFingerprint: proxyResult.chosenRoute.providerKeyFingerprint ?? null,
				upstreamRequestId: proxyResult.upstreamRequestId,
				timing: timing.snapshot(),
				circuitEvents: alertCircuitEvents.length > 0 ? alertCircuitEvents : undefined,
				suppressErrorAlert: proxyResult.suppressErrorAlert || undefined,
			});
		})().catch((error) => {
			console.error(
				`[Gateway Audio] record DashScope speech passthrough failed baseModelId=${baseModelId} error=${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}),
	);
	if (proxyResult.stickyMutationPromise) scheduleBackgroundWork(c, proxyResult.stickyMutationPromise);
	return response;
}
