/**
 * Ingress 公共流水线：鉴权上下文之后的模型解析、预算、选路、策略、熔断、failover 与异步记账。
 * 各端点只提供协议相关的 parse / redact / dispatch hook。
 */
import type { Context } from 'hono';
import { hasPositiveTotalBalance, type GatewayRepositories, type ModelRow, type ResolvedModelSurfaceRow, type UpstreamProtocol } from '@octafuse/core';
import type { Env } from '../app';
import type { ApiKeyContext } from '../middleware/auth';
import { scheduleBackgroundWork } from '../runtime/schedule-background-work';
import { GatewayErrorCode } from './gateway-error-codes';
import { gatewayErrorJson } from './gateway-error-response';
import { resolveModelRouting } from './resolve-model-route-group';
import { resolveRoutesForSurface, type RouteResult } from './model-router';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategyPlan,
} from './route-strategies';
import { stickyConfigFromSurface } from './provider-sticky-routing';
import {
	computeRequestLogStatus,
	formatHttpErrorTextForRequestLog,
	materializeNonOkResponse,
} from './request-log-record-status';
import {
	maybeBlockUserModelCircuit,
	maybeTriggerUserModelCircuitFromUpstream,
	markUserModelSuccess,
} from './user-model-circuit-route';
import { recordUsage } from './usage-tracker';
import { EMPTY_USAGE, type ProxyResult, type UsageFromStream } from './proxy';
import type { FailoverDispatchOptions } from './failover-dispatch';
import { RequestTimingCollector } from './request-timing';

export const USAGE_SAFETY_TIMEOUT_MS = 5 * 60 * 1000;

export type AuthedEnv = Env & { Variables: { apiKey: ApiKeyContext } };

export type PipelineParseResult<TBody> = {
	body: TBody;
	rawModelId: string;
};

export type PipelineDispatchContext<TBody> = {
	repos: GatewayRepositories;
	routes: RouteResult[];
	body: TBody;
	requestSignal: AbortSignal;
	options: FailoverDispatchOptions;
	context: Context<AuthedEnv>;
};

export interface ProxyEndpointSpec<TBody> {
	requestProtocol: Extract<UpstreamProtocol, 'openai' | 'anthropic' | 'gemini'>;
	requestOperation: string;
	strategyCapability: string;
	logTag: string;
	noRouteMessage: (routeGroup: string) => string;
	parseRequest: (c: Context<AuthedEnv>) => Promise<PipelineParseResult<TBody> | Response>;
	requestBodyForLog: (body: TBody) => string | null;
	upstreamWireBodyForLog: (route: RouteResult, body: TBody) => string | null;
	dispatch: (ctx: PipelineDispatchContext<TBody>) => Promise<ProxyResult>;
	hasUsage?: (usage: UsageFromStream) => boolean;
	afterRoutesResolved?: (
		c: Context<AuthedEnv>,
		input: { routes: RouteResult[]; body: TBody; rawModelId: string }
	) => Response | null;
	logForward?: boolean;
	logRouteResolutionError?: boolean;
	logEmptyRoutes?: boolean;
	logRecordUsageError?: boolean;
	resolveLoggedRequestId?: (headerId: string | null, usage: UsageFromStream) => string | null;
	extraRecordUsage?: (input: {
		body: TBody;
		usage: UsageFromStream;
	}) => { gemini_wire_action?: string | null };
	incompleteErrorMessage?: (usage: UsageFromStream, timedOut: boolean) => string;
	httpErrorFallback?: (usage: UsageFromStream, status: number) => string;
}

export type LoadedProxyRoutes = {
	routes: RouteResult[];
	poolStrategy: string | null;
	poolTierStrategies: string | null;
	stickySurface: ResolvedModelSurfaceRow | null;
};

export type ResolvedProxySurface = {
	model: ModelRow;
	baseModelId: string;
	effectiveRouteGroup: string;
	routes: RouteResult[];
	poolStrategy: string | null;
	poolTierStrategies: string | null;
	stickySurface: ResolvedModelSurfaceRow | null;
};

/** 仅解析 Surface 路由池；调用方已完成模型解析。 */
export async function loadProxyRouteSurface(
	repos: GatewayRepositories,
	input: {
		modelId: string;
		routeGroup: string;
		requestProtocol: UpstreamProtocol;
		requestOperation: string;
	}
): Promise<{ ok: true; loaded: LoadedProxyRoutes } | { ok: false; message: string; cause: unknown }> {
	try {
		const resolvedSurface = await resolveRoutesForSurface(repos, {
			modelId: input.modelId,
			routeGroup: input.routeGroup,
			requestProtocol: input.requestProtocol,
			requestOperation: input.requestOperation,
		});
		return {
			ok: true,
			loaded: {
				routes: resolvedSurface.routes,
				poolStrategy: resolvedSurface.surface?.pool_strategy ?? null,
				poolTierStrategies: resolvedSurface.surface?.pool_tier_strategies ?? null,
				stickySurface: resolvedSurface.surface,
			},
		};
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : 'Model route resolution failed',
			cause: err,
		};
	}
}

/** 模型解析 + Surface 选路；images / audio 与 LLM 流水线共用。 */
export async function resolveProxySurface(
	repos: GatewayRepositories,
	input: {
		rawModelId: string;
		requestProtocol: UpstreamProtocol;
		requestOperation: string;
	}
): Promise<
	| { ok: true; surface: ResolvedProxySurface }
	| { ok: false; status: 404 | 502; message: string; cause?: unknown; baseModelId?: string }
> {
	const resolved = await resolveModelRouting(repos, input.rawModelId);
	if (!resolved) {
		return { ok: false, status: 404, message: 'Model not found' };
	}
	const { model, baseModelId, explicitGroup } = resolved;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	const loaded = await loadProxyRouteSurface(repos, {
		modelId: baseModelId,
		routeGroup: effectiveRouteGroup,
		requestProtocol: input.requestProtocol,
		requestOperation: input.requestOperation,
	});
	if (!loaded.ok) {
		return {
			ok: false,
			status: 502,
			message: loaded.message,
			cause: loaded.cause,
			baseModelId,
		};
	}
	return {
		ok: true,
		surface: {
			model,
			baseModelId,
			effectiveRouteGroup,
			...loaded.loaded,
		},
	};
}

export async function buildProxyFailoverOptions(input: {
	repos: GatewayRepositories;
	apiKey: ApiKeyContext;
	model: Pick<ModelRow, 'route_policy'>;
	baseModelId: string;
	effectiveRouteGroup: string;
	protocol: UpstreamProtocol;
	capability: string;
	poolStrategy: string | null;
	poolTierStrategies: string | null;
	stickySurface: ResolvedModelSurfaceRow | null;
	routes: RouteResult[];
	timing: RequestTimingCollector;
	/** 默认启用；audio.speech 历史路径未挂 sticky，保持原行为。 */
	includeSticky?: boolean;
}): Promise<FailoverDispatchOptions> {
	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: input.model.route_policy ?? null,
		poolStrategy: input.poolStrategy,
		poolTierStrategies: input.poolTierStrategies,
		protocol: input.protocol,
		capability: input.capability,
		routeGroup: input.effectiveRouteGroup,
		repos: input.repos,
	});
	return {
		affinityKey: buildAffinityKey(
			input.apiKey.userId,
			input.baseModelId,
			input.effectiveRouteGroup,
			input.protocol
		),
		tierKeyPrefix: buildTierKeyPrefix(input.baseModelId, input.effectiveRouteGroup, input.protocol),
		strategy: strategyPlan.base,
		tierStrategies: strategyPlan.tierOverrides,
		timing: input.timing,
		...(input.includeSticky === false
			? {}
			: {
					routePoolId: input.stickySurface?.route_pool_id ?? input.routes[0]?.routePoolId ?? null,
					sticky: stickyConfigFromSurface(input.stickySurface),
				}),
	};
}

export function defaultHasUsage(usage: UsageFromStream): boolean {
	return usage.total_tokens > 0 || usage.input_tokens > 0 || usage.output_tokens > 0;
}

export function modelDisplayName(model: Pick<ModelRow, 'display_name'>, baseModelId: string): string {
	return model.display_name != null && String(model.display_name).trim() !== ''
		? String(model.display_name).trim()
		: baseModelId;
}

export async function runProxyPipeline<TBody>(
	c: Context<AuthedEnv>,
	spec: ProxyEndpointSpec<TBody>
): Promise<Response> {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const start = Date.now();
	const timing = new RequestTimingCollector();

	const parsed = await spec.parseRequest(c);
	if (parsed instanceof Response) return parsed;

	const { body, rawModelId } = parsed;
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

	if (!hasPositiveTotalBalance(apiKey.budgetMax, apiKey.budgetSpent, apiKey.walletGranted, apiKey.walletSpent)) {
		return gatewayErrorJson(c, {
			status: 403,
			code: GatewayErrorCode.budgetExceeded,
			message: 'Budget exceeded',
		});
	}

	const loaded = await loadProxyRouteSurface(repos, {
		modelId: baseModelId,
		routeGroup: effectiveRouteGroup,
		requestProtocol: spec.requestProtocol,
		requestOperation: spec.requestOperation,
	});
	if (!loaded.ok) {
		if (spec.logRouteResolutionError) {
			console.error(`[Gateway ${spec.logTag}] model route resolution failed`, {
				baseModelId,
				err: loaded.cause,
			});
		}
		return gatewayErrorJson(c, {
			status: 502,
			code: GatewayErrorCode.routeResolutionFailed,
			message: loaded.message,
		});
	}

	const { routes, poolStrategy, poolTierStrategies, stickySurface } = loaded.loaded;
	if (routes.length === 0) {
		if (spec.logEmptyRoutes) {
			if (spec.logTag === 'Responses') {
				console.warn('[Gateway Responses] no openai.responses route for model', {
					baseModelId,
					effectiveRouteGroup,
				});
			} else {
				console.warn(`[Gateway ${spec.logTag}] no openai route for model`, {
					baseModelId,
					effectiveRouteGroup,
				});
			}
		}
		return gatewayErrorJson(c, {
			status: 502,
			code: GatewayErrorCode.noRoute,
			message: spec.noRouteMessage(effectiveRouteGroup),
		});
	}

	const blockedAfterRoutes = spec.afterRoutesResolved?.(c, { routes, body, rawModelId });
	if (blockedAfterRoutes) return blockedAfterRoutes;

	if (spec.logForward) {
		console.log(
			`[Gateway ${spec.logTag}] forwarding baseModelId=${baseModelId} clientModel=${rawModelId} providerIds=${routes.map((r) => r.providerId).join(',')} keyId=${apiKey.keyId}`
		);
	}

	const nameForLog = modelDisplayName(model, baseModelId);
	const requestBodyForLog = spec.requestBodyForLog(body);
	const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog: nameForLog,
		requestBodyForLog,
		requestProtocol: spec.requestProtocol,
		startMs: start,
		timing,
	});
	if (circuitBlocked) return circuitBlocked;

	const failoverOptions = await buildProxyFailoverOptions({
		repos,
		apiKey,
		model,
		baseModelId,
		effectiveRouteGroup,
		protocol: spec.requestProtocol,
		capability: spec.strategyCapability,
		poolStrategy,
		poolTierStrategies,
		stickySurface,
		routes,
		timing,
	});
	timing.markGatewayComplete();
	const proxyResult = await spec.dispatch({
		repos,
		routes,
		body,
		requestSignal: c.req.raw.signal,
		options: failoverOptions,
		context: c,
	});
	if (proxyResult.stickyMutationPromise) {
		scheduleBackgroundWork(c, proxyResult.stickyMutationPromise);
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
		? [...proxyResult.circuitEvents, userModelCircuitEvent]
		: proxyResult.circuitEvents;
	const hasUsage = spec.hasUsage ?? defaultHasUsage;
	const usageOrSafety = Promise.race([
		proxyResult.usagePromise.then((usage) => ({
			usage,
			incomplete: !hasUsage(usage),
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
					errorMessage = spec.incompleteErrorMessage
						? spec.incompleteErrorMessage(usageCollected, timedOut)
						: timedOut
							? 'Stream usage timeout (no usage within limit)'
							: 'Stream ended before usage available';
				} else if (errorBodyText != null) {
					errorMessage = formatHttpErrorTextForRequestLog(
						response.status,
						response.headers.get('content-type'),
						errorBodyText
					);
				} else {
					errorMessage = spec.httpErrorFallback
						? spec.httpErrorFallback(usageCollected, response.status)
						: `HTTP ${response.status}`;
				}
				const loggedRequestId = spec.resolveLoggedRequestId
					? spec.resolveLoggedRequestId(proxyResult.upstreamRequestId, usageCollected)
					: proxyResult.upstreamRequestId;
				return recordUsage(repos, {
					api_key_id: apiKey.keyId,
					user_id: apiKey.userId,
					user_email: apiKey.userEmail,
					model_id: baseModelId,
					provider_id: proxyResult.chosenRoute.providerId,
					provider_model_name: proxyResult.chosenRoute.providerModelName,
					model_name: nameForLog,
					provider_name: proxyResult.chosenRoute.providerName,
					request_body: requestBodyForLog,
					upstream_request_body: spec.upstreamWireBodyForLog(proxyResult.chosenRoute, body),
					request_protocol: spec.requestProtocol,
					request_operation: spec.requestOperation,
					upstream_protocol: proxyResult.chosenRoute.upstreamProtocol,
					upstream_operation: proxyResult.chosenRoute.upstreamOperation,
					model_surface_id: proxyResult.chosenRoute.modelSurfaceId,
					route_pool_id: proxyResult.chosenRoute.routePoolId,
					route_target_id: proxyResult.chosenRoute.targetId,
					adapter: proxyResult.chosenRoute.adapter,
					sticky_trace: proxyResult.stickyTrace ? await proxyResult.stickyTrace() : null,
					usage: usageCollected,
					model_pricing_profile: model.pricing_profile ?? null,
					route_price_override_json: proxyResult.chosenRoute.priceOverrideRaw,
					user_charged_cost_factors_json: apiKey.chargedCostFactors,
					route_metered_profile_json: proxyResult.chosenRoute.routeMeteredProfileJson,
					route_charged_profile_json: proxyResult.chosenRoute.routeChargedProfileJson,
					request_started_at_ms: start,
					route_group: proxyResult.chosenRoute.routeGroup,
					status,
					latency_ms: latency,
					timing: timing.snapshot(),
					error_message: errorMessage,
					provider_key_id: proxyResult.chosenRoute.providerKeyId ?? null,
					provider_key_label: proxyResult.chosenRoute.providerKeyLabel ?? null,
					provider_key_fingerprint: proxyResult.chosenRoute.providerKeyFingerprint ?? null,
					upstream_request_id: loggedRequestId,
					upstream_message_id: usageCollected.upstreamMessageId ?? null,
					circuit_events: alertCircuitEvents.length > 0 ? alertCircuitEvents : undefined,
					suppress_error_alert: proxyResult.suppressErrorAlert || undefined,
					...spec.extraRecordUsage?.({ body, usage: usageCollected }),
				});
			})
			.catch((err) => {
				if (spec.logRecordUsageError) {
					console.error(
						`[Gateway ${spec.logTag}] recordUsage failed baseModelId=${baseModelId} keyId=${apiKey.keyId} error=${err instanceof Error ? err.message : String(err)}`
					);
				}
			})
	);

	return response;
}

export async function parseJsonModelBody(
	c: Context<AuthedEnv>
): Promise<PipelineParseResult<Record<string, unknown>> | Response> {
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
	const rawModelId = typeof body.model === 'string' ? body.model.trim() : '';
	if (!rawModelId) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.missingModel,
			message: 'Missing model',
		});
	}
	return { body, rawModelId };
}
