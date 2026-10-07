/**
 * DashScope 异步文件转写透传。
 * `POST /v1/dashscope/services/audio/asr/transcription` 提交任务。
 * `GET /v1/dashscope/tasks/:taskId?model=` 查询任务；成功时按结果里的时长计费，响应仍是任务 JSON。
 */
import { isAudioTranscriptionModel, type ModelRow } from '@octafuse/core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../app';
import { requireApiKey, type ApiKeyContext } from '../../middleware/auth';
import { resolveRoutesForSurface, type RouteResult } from '../../services/model-router';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { proxyDashScopeJsonPassthrough } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { recordAudioUsage } from '../../services/audio-usage-charge';
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

type AsyncEnv = Env & { Variables: { apiKey: ApiKeyContext } };

export const dashScopeFileTranscriptionRoutes = new Hono<AsyncEnv>();
export const dashScopeTaskRoutes = new Hono<AsyncEnv>();

dashScopeFileTranscriptionRoutes.use('*', requireApiKey);
dashScopeTaskRoutes.use('*', requireApiKey);

dashScopeFileTranscriptionRoutes.post('/', async (c) => {
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
	return runAsyncPassthrough(c, rawModelId, requestBody, null);
});

dashScopeTaskRoutes.get('/:taskId', async (c) => {
	const rawModelId = c.req.query('model')?.trim() ?? '';
	if (!rawModelId) {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidRequest, message: 'Missing model' });
	}
	const taskId = c.req.param('taskId')?.trim() ?? '';
	if (!taskId) {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidRequest, message: 'Missing task id' });
	}
	return runAsyncPassthrough(c, rawModelId, { model: rawModelId, task_id: taskId }, taskId);
});

async function runAsyncPassthrough(
	c: Context<AsyncEnv>,
	rawModelId: string,
	requestBody: Record<string, unknown>,
	taskId: string | null,
): Promise<Response> {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const start = Date.now();
	const timing = new RequestTimingCollector();
	const preview = await resolveModelRouting(repos, rawModelId);
	if (!preview) {
		return gatewayErrorJson(c, {
			status: 404,
			code: GatewayErrorCode.modelNotFound,
			message: `Model not found: ${rawModelId.slice(0, 200)}`,
		});
	}
	if (!isAudioTranscriptionModel(preview.model)) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'DashScope file transcription passthrough requires a transcription model',
		});
	}
	const { model, baseModelId, explicitGroup } = preview;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	let routes: RouteResult[];
	let poolStrategy: string | null = null;
	let poolTierStrategies: string | null = null;
	let stickySurface = null as Awaited<ReturnType<typeof resolveRoutesForSurface>>['surface'];
	try {
		const resolvedSurface = await resolveRoutesForSurface(repos, {
			modelId: baseModelId,
			routeGroup: effectiveRouteGroup,
			requestProtocol: 'dashscope',
			requestOperation: 'audio.transcriptions.async',
		});
		routes = resolvedSurface.routes;
		poolStrategy = resolvedSurface.surface?.pool_strategy ?? null;
		poolTierStrategies = resolvedSurface.surface?.pool_tier_strategies ?? null;
		stickySurface = resolvedSurface.surface;
	} catch (err) {
		return gatewayErrorJson(c, {
			status: 502,
			code: GatewayErrorCode.routeResolutionFailed,
			message: err instanceof Error ? err.message : 'Model route resolution failed',
		});
	}
	if (routes.length === 0) {
		return gatewayErrorJson(c, { status: 404, code: GatewayErrorCode.noRoute, message: NO_AVAILABLE_ROUTE_MESSAGE });
	}
	if (!apiKeyHasBalance(apiKey)) {
		return gatewayErrorJson(c, { status: 403, code: GatewayErrorCode.budgetExceeded, message: 'Budget exceeded' });
	}
	const modelNameForLog = displayName(model, baseModelId);
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
		poolStrategy,
		poolTierStrategies,
		protocol: 'dashscope',
		capability: taskId ? 'audio.transcriptions.tasks' : 'audio.transcriptions',
		routeGroup: effectiveRouteGroup,
		repos,
	});
	timing.markGatewayComplete();
	const proxyResult = await proxyDashScopeJsonPassthrough(
		repos,
		routes,
		'audio.transcriptions.async',
		taskId ? null : requestBody,
		c.req.raw.signal,
		{
			affinityKey: buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'dashscope'),
			tierKeyPrefix: buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'dashscope'),
			strategy: strategyPlan.base,
			tierStrategies: strategyPlan.tierOverrides,
			timing,
			sticky: stickyConfigFromSurface(stickySurface),
			inboundHeaders: c.req.raw.headers,
			dashScopeJson: {
				taskId,
				asyncHeader: c.req.header('X-DashScope-Async'),
			},
		},
	);
	const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);
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
	const meta = proxyResult.meta;
	scheduleBackgroundWork(
		c,
		(async () => {
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
				requestOperation: 'audio.transcriptions.async',
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
					durationSeconds: response.ok ? (meta?.audioDurationSeconds ?? 0) : 0,
					durationSource: response.ok && meta?.audioDurationSource ? meta.audioDurationSource : 'estimated',
					fileBytes: 0,
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
				`[Gateway Audio] record DashScope async passthrough failed baseModelId=${baseModelId} error=${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}),
	);
	if (proxyResult.stickyMutationPromise) scheduleBackgroundWork(c, proxyResult.stickyMutationPromise);
	return response;
}

function displayName(model: ModelRow, baseModelId: string): string {
	return model.display_name != null && String(model.display_name).trim() !== ''
		? String(model.display_name).trim()
		: baseModelId;
}
