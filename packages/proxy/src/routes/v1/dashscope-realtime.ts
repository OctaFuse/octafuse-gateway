/**
 * DashScope 原生实时音频入口：
 * `GET /v1/dashscope/realtime?model=<gateway-model>&operation=<native-operation>`
 *
 * 下游使用网关 API Key，上游使用路由选中的 DashScope API Key。事件保持 DashScope 原生语义。
 */
import type { GatewayRepositories, ModelRow } from '@octafuse/core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../app';
import { requireApiKey, type ApiKeyContext } from '../../middleware/auth';
import {
	DASHSCOPE_REALTIME_OPERATIONS,
	type DashScopeRealtimeOperation,
} from '../../services/egress/dashscope-realtime-driver';
import { GatewayErrorCode } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { resolveRoutesForSurface } from '../../services/model-router';
import { proxyDashScopeRealtime, type UsageFromStream } from '../../services/proxy';
import { recordAudioUsage } from '../../services/audio-usage-charge';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { RequestTimingCollector } from '../../services/request-timing';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import { parseDashScopeRealtimeAuthProtocol } from '@octafuse/core/realtime-protocol';

type RealtimeEnv = Env & { Variables: { apiKey: ApiKeyContext } };
type RealtimeContext = Context<RealtimeEnv>;

export const dashScopeRealtimeRoutes = new Hono<RealtimeEnv>();

dashScopeRealtimeRoutes.use('*', requireApiKey);

function isRealtimeOperation(value: string): value is DashScopeRealtimeOperation {
	return (DASHSCOPE_REALTIME_OPERATIONS as readonly string[]).includes(value);
}

function isSpeechOperation(operation: DashScopeRealtimeOperation): boolean {
	return operation.startsWith('audio.speech.');
}

function realtimeErrorMessage(usage: UsageFromStream): string | null {
	if (usage.stream_error) return `Realtime stream failed: ${usage.stream_error}`;
	if (usage.cancelled) return 'Client disconnected before realtime audio completed';
	return null;
}

function modelDisplayName(model: { display_name?: string | null }, baseModelId: string): string {
	const displayName = model.display_name == null ? '' : String(model.display_name).trim();
	return displayName || baseModelId;
}

function recordRealtimeUsage(params: {
	c: RealtimeContext;
	repos: GatewayRepositories;
	apiKey: ApiKeyContext;
	model: ModelRow;
	baseModelId: string;
	effectiveRouteGroup: string;
	operation: DashScopeRealtimeOperation;
	start: number;
	timing: RequestTimingCollector;
	proxyResult: Awaited<ReturnType<typeof proxyDashScopeRealtime>>;
}): void {
	const {
		c,
		repos,
		apiKey,
		model,
		baseModelId,
		effectiveRouteGroup,
		operation,
		start,
		timing,
		proxyResult,
	} = params;
	const route = proxyResult.chosenRoute;
	scheduleBackgroundWork(
		c,
		proxyResult.usagePromise
			.then((usage) => {
				const errorMessage = realtimeErrorMessage(usage);
				const status: 'success' | 'error' = errorMessage ? 'error' : 'success';
				const tokenUsage =
					usage.input_tokens > 0 || usage.output_tokens > 0 || usage.total_tokens > 0
						? {
								input_tokens: usage.input_tokens,
								output_tokens: usage.output_tokens,
								audio_tokens: usage.output_tokens,
								text_tokens: usage.input_tokens,
								total_tokens: usage.total_tokens,
								raw_usage: usage.raw_usage,
							}
						: null;
				return recordAudioUsage({
					repos,
					apiKeyId: apiKey.keyId,
					userId: apiKey.userId,
					userEmail: apiKey.userEmail,
					modelId: baseModelId,
					providerId: route.providerId,
					providerModelName: route.providerModelName,
					modelName: modelDisplayName(model, baseModelId),
					providerName: route.providerName,
					requestBody: JSON.stringify({ kind: 'dashscope_realtime', operation }),
					requestProtocol: 'dashscope',
					requestOperation: operation,
					upstreamProtocol: route.upstreamProtocol,
					upstreamOperation: route.upstreamOperation,
					modelSurfaceId: route.modelSurfaceId,
					routePoolId: route.routePoolId,
					routeTargetId: route.targetId,
					adapter: route.adapter,
					routeGroup: effectiveRouteGroup,
					status,
					latencyMs: Date.now() - start,
					errorMessage,
					billing: {
						modelPricingProfileJson: model.pricing_profile ?? null,
						routePriceOverrideJson: route.priceOverrideRaw,
						durationSeconds: isSpeechOperation(operation)
							? 0
							: (usage.audio_duration_seconds ?? 0),
						durationSource: 'upstream',
						characters: isSpeechOperation(operation)
							? (usage.audio_characters ?? null)
							: null,
						tokenUsage,
						requestStartedAtMs: start,
					},
					providerKeyId: route.providerKeyId ?? null,
					providerKeyLabel: route.providerKeyLabel ?? null,
					providerKeyFingerprint: route.providerKeyFingerprint ?? null,
					upstreamRequestId: proxyResult.upstreamRequestId,
					timing: timing.snapshot(),
					circuitEvents:
						proxyResult.circuitEvents.length > 0 ? proxyResult.circuitEvents : undefined,
					suppressErrorAlert: proxyResult.suppressErrorAlert || undefined,
				});
			})
			.catch((error) => {
				console.error(
					`[Gateway Realtime] record usage failed modelId=${baseModelId} error=${error instanceof Error ? error.message : String(error)}`
				);
			})
	);
}

dashScopeRealtimeRoutes.get('/', async (c) => {
	const start = Date.now();
	if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
		return gatewayErrorJson(c, {
			status: 426,
			code: GatewayErrorCode.invalidRequest,
			message: 'Expected a WebSocket upgrade request',
		});
	}
	const rawModelId = c.req.query('model')?.trim() ?? '';
	if (!rawModelId) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.missingModel,
			message: 'Missing model query parameter',
		});
	}
	const operationRaw = c.req.query('operation')?.trim() ?? '';
	if (!isRealtimeOperation(operationRaw)) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: `Unsupported realtime operation: ${operationRaw || '(empty)'}`,
		});
	}

	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const resolved = await resolveModelRouting(repos, rawModelId);
	if (!resolved) {
		return gatewayErrorJson(c, {
			status: 404,
			code: GatewayErrorCode.modelNotFound,
			message: `Model not found: ${rawModelId.slice(0, 200)}`,
		});
	}
	const { model, baseModelId, explicitGroup } = resolved;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	let surface;
	try {
		surface = await resolveRoutesForSurface(repos, {
			modelId: baseModelId,
			routeGroup: effectiveRouteGroup,
			requestProtocol: 'dashscope',
			requestOperation: operationRaw,
		});
	} catch (error) {
		return gatewayErrorJson(c, {
			status: 502,
			code: GatewayErrorCode.routeResolutionFailed,
			message: error instanceof Error ? error.message : 'Realtime route resolution failed',
		});
	}
	if (surface.routes.length === 0) {
		return gatewayErrorJson(c, {
			status: 502,
			code: GatewayErrorCode.noRoute,
			message: `No DashScope realtime route in route group "${effectiveRouteGroup}" for this model and operation`,
		});
	}

	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: surface.surface?.pool_strategy ?? null,
		poolTierStrategies: surface.surface?.pool_tier_strategies ?? null,
		protocol: 'dashscope',
		capability: operationRaw,
		routeGroup: effectiveRouteGroup,
		repos,
	});
	const timing = new RequestTimingCollector();
	const proxyResult = await proxyDashScopeRealtime(
		repos,
		surface.routes,
		operationRaw,
		c.req.raw.signal,
		{
			responseProtocol: parseDashScopeRealtimeAuthProtocol(
				c.req.header('Sec-WebSocket-Protocol')
			)?.protocol,
			affinityKey: buildAffinityKey(
				apiKey.userId,
				baseModelId,
				effectiveRouteGroup,
				'dashscope'
			),
			tierKeyPrefix: buildTierKeyPrefix(
				baseModelId,
				effectiveRouteGroup,
				'dashscope'
			),
			strategy: strategyPlan.base,
			tierStrategies: strategyPlan.tierOverrides,
			timing,
		}
	);
	if (proxyResult.response.status !== 101 || !proxyResult.response.webSocket) {
		return proxyResult.response;
	}

	recordRealtimeUsage({
		c,
		repos,
		apiKey,
		model,
		baseModelId,
		effectiveRouteGroup,
		operation: operationRaw,
		start,
		timing,
		proxyResult,
	});
	return proxyResult.response;
});
