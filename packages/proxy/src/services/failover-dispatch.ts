/**
 * 上游调度与故障转移：
 * - 按 priority 硬序 + 层内 route strategy（cache_affinity / weighted_random / fixed_order / weighted_round_robin）编排尝试序列。
 * - 失败按类别进入 provider 熔断（`provider-circuit-breaker`：429 无头 5s→60s 梯度；普通 5xx 连续 3 次后 10s；524/fetch 不跨请求熔断）。
 * - 全部候选因熔断不可用时返回 429 + Retry-After（而非 502）。
 * - 循环内复查：本次请求内刚被熔断的 provider（同 providerId 多 target）不再打。
 */
import type { GatewayRepositories, RouteStrategyName, UpstreamProtocol } from '@octafuse/core';
import { DEFAULT_ROUTE_STRATEGY, fingerprintProviderApiKey } from '@octafuse/core';
import type { RouteResult } from './model-router';
import type { UsageFromStream } from './proxy';
import { EMPTY_USAGE } from './proxy';
import { buildRouteAttemptPlan } from './route-attempt-planner';
import {
	getProviderCircuitRemainingMs,
	markProviderFailure,
	markProviderSuccess,
	parseRetryAfterMs,
} from './provider-circuit-breaker';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import {
	classifyUpstreamHttpFailure,
	type UpstreamFailureClassification,
} from './upstream-failure-classifier';
import type { RequestTimingAttempt, RequestTimingCollector } from './request-timing';
import { GatewayErrorCode } from './gateway-error-codes';
import { gatewayErrorResponse, gatewayNestedErrorResponse } from './gateway-error-response';

/** Images 合成 abort（Gateway 超时 / 客户端取消）——禁止 failover 再打上游。 */
export type ImageDispatchAbortReason = 'client_abort' | 'gateway_timeout';

/** 协议 driver 可选透传（如 Images / Audio 已解析的 body / usage，避免 route 侧重复 parse）。 */
export type ProxyDispatchMeta = {
	imageUsage?: import('@octafuse/core').ImageTokenUsage | null;
	parsedBody?: unknown;
	/** 仅 Images：上游 wait 被 abort 时由 driver 写入（见 openai-images-driver） */
	imageAbortReason?: ImageDispatchAbortReason;
	/** 仅 Audio transcriptions：计费时长（秒） */
	audioDurationSeconds?: number | null;
	/** 仅 Audio：duration 来源 */
	audioDurationSource?: 'upstream' | 'media' | 'client' | 'estimated' | null;
	/** 仅 Audio：上传文件字节数 */
	audioFileBytes?: number;
	/** 仅 Audio token 计费：上游 `usage.type=tokens` */
	audioTokenUsage?: import('@octafuse/core').AudioTokenUsage | null;
};

/** Images abort 的 504 不得换 provider / 换路由（避免客户端取消或超时后二次打 OpenAI）。 */
export function shouldFailImmediatelyForImageAbort(meta?: ProxyDispatchMeta | null): boolean {
	const reason = meta?.imageAbortReason;
	return reason === 'client_abort' || reason === 'gateway_timeout';
}

export type ProxyDispatchResult = {
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	meta?: ProxyDispatchMeta;
};

export type ProxyFailoverResult = {
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	chosenRoute: RouteResult;
	/** 本次请求触发的 provider 熔断事件（仅 openedOrExtended） */
	circuitEvents: GatewayCircuitAlertEvent[];
	/** 因已有 provider 熔断短路、无需重复 webhook 告警 */
	suppressErrorAlert: boolean;
	meta?: ProxyDispatchMeta;
};

export type FailoverDispatchOptions = {
	affinityKey: string;
	tierKeyPrefix: string;
	strategy: RouteStrategyName;
	/** Per-priority overrides from `route_pools.tier_strategies` */
	tierStrategies?: ReadonlyMap<number, RouteStrategyName> | null;
	timing?: RequestTimingCollector | null;
};

type DispatchFn = (
	route: RouteResult,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
) => Promise<ProxyDispatchResult>;

function emptyRoute(protocol: UpstreamProtocol): RouteResult {
	return {
		targetId: '',
		modelSurfaceId: null,
		routePoolId: '',
		providerId: '',
		providerName: '',
		providerModelName: '',
		upstreamProtocol: protocol,
		upstreamOperation: '*',
		adapter: 'passthrough',
		providerEndpoints: {},
		providerApiKey: '',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
	};
}

function logProviderSwitchAlert(route: RouteResult, classification: UpstreamFailureClassification, status?: number): void {
	if (!classification.alertOnKeySwitch) return;
	console.warn(
		`[Gateway Proxy] provider auth issue, trying next provider providerId=${route.providerId} status=${status ?? 'fetch_error'}`
	);
}

function allProvidersBusyDueToCircuitOnly(plan: {
	attempts: { length: number };
	skippedByCircuit: number;
}): boolean {
	return plan.attempts.length === 0 && plan.skippedByCircuit > 0;
}

function allProvidersBusyResponse(retryAfterMs: number | null): Response {
	const retryAfterSeconds = Math.max(1, Math.ceil((retryAfterMs ?? 30_000) / 1000));
	const code = GatewayErrorCode.circuitUpstreamCapacityExhausted;
	return gatewayNestedErrorResponse({
		status: 429,
		code,
		error: {
			message: `All upstream providers are cooling down. Please retry after ${retryAfterSeconds} seconds.`,
			type: 'upstream_capacity_exhausted',
			retry_after_seconds: retryAfterSeconds,
		},
		headers: { 'Retry-After': String(retryAfterSeconds) },
	});
}

/** HTTP 2xx 与 Cloudflare WebSocket 101 都表示 driver 已成功建立上游请求。 */
export function isSuccessfulDispatchResponse(response: Response): boolean {
	return response.ok || (response.status === 101 && response.webSocket != null);
}

/**
 * 按「provider priority 层 → route strategy」调度上游请求。
 */
export async function failoverDispatch(
	_repos: GatewayRepositories,
	routes: RouteResult[],
	expectedProtocol: UpstreamProtocol | readonly UpstreamProtocol[],
	dispatch: DispatchFn,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyFailoverResult> {
	const timing = options?.timing ?? null;
	timing?.markUpstreamDispatchStart();
	const expectedProtocols = Array.isArray(expectedProtocol)
		? expectedProtocol
		: [expectedProtocol];
	const fallbackProtocol = expectedProtocols[0]!;
	const protocolRoutes = routes.filter((route) => {
		if (expectedProtocols.includes(route.upstreamProtocol)) return true;
		console.warn(
			`[Gateway Proxy] unsupported protocol, skipping providerId=${route.providerId} protocol=${route.upstreamProtocol}`
		);
		return false;
	});

	if (protocolRoutes.length === 0) {
		return {
			response: gatewayErrorResponse({
				status: 502,
				code: GatewayErrorCode.noRoute,
				message: 'No routes configured',
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: emptyRoute(fallbackProtocol),
			circuitEvents: [],
			suppressErrorAlert: false,
		};
	}

	const affinityKey = options?.affinityKey ?? '';
	const tierKeyPrefix = options?.tierKeyPrefix ?? '';
	const strategy: RouteStrategyName = options?.strategy ?? DEFAULT_ROUTE_STRATEGY;
	const tierStrategies = options?.tierStrategies ?? null;

	const circuitEvents: GatewayCircuitAlertEvent[] = [];
	const plan = buildRouteAttemptPlan(
		protocolRoutes,
		{ affinityKey, tierKeyPrefix },
		strategy,
		Date.now(),
		tierStrategies
	);

	if (plan.attempts.length === 0) {
		return {
			response: allProvidersBusyResponse(plan.earliestRetryAfterMs),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: protocolRoutes[0]!,
			circuitEvents: [],
			suppressErrorAlert: allProvidersBusyDueToCircuitOnly(plan),
		};
	}

	let lastResponse: Response | null = null;
	let lastRoute: RouteResult = protocolRoutes[0]!;
	let lastTimingAttempt: RequestTimingAttempt | undefined;

	for (let attemptIndex = 0; attemptIndex < plan.attempts.length; attemptIndex += 1) {
		const route = plan.attempts[attemptIndex]!;

		if (getProviderCircuitRemainingMs(route.providerId) > 0) {
			console.warn(
				`[Gateway Proxy] provider cooling down mid-request, skipping providerId=${route.providerId}`
			);
			continue;
		}

		const timingAttempt = timing?.startAttempt(route);
		lastTimingAttempt = timingAttempt;
		const hasNextAttempt = attemptIndex < plan.attempts.length - 1;
		console.log(
			`[Gateway Proxy] calling provider providerId=${route.providerId} model=${route.providerModelName}`
		);

		let response: Response;
		let usagePromise: Promise<UsageFromStream>;
		let upstreamRequestId: string | null = null;
		let dispatchMeta: ProxyDispatchMeta | undefined;
		try {
			const dispatched = await dispatch(route, requestSignal, timing, timingAttempt);
			response = dispatched.response;
			usagePromise = dispatched.usagePromise;
			upstreamRequestId = dispatched.upstreamRequestId;
			dispatchMeta = dispatched.meta;
		} catch (err) {
			timing?.markAttemptError(timingAttempt, err);
			if (hasNextAttempt) timing?.markAttemptFailover(timingAttempt);
			const errMessage = err instanceof Error ? err.message : String(err);
			console.warn(
				`[Gateway Proxy] fetch failed providerId=${route.providerId} error=${errMessage}`
			);
			// 与 route_resolution_failed 一致：把 fetch 层原文带给客户端（DNS/TLS/abort 等，不含凭据）
			lastResponse = gatewayErrorResponse({
				status: 502,
				code: GatewayErrorCode.upstreamRequestFailed,
				message: errMessage.trim()
					? `Upstream request failed: ${errMessage.trim()}`
					: 'Upstream request failed',
			});
			lastRoute = route;
			continue;
		}

		lastResponse = response;
		lastRoute = route;

		if (isSuccessfulDispatchResponse(response)) {
			timing?.markFinalAttempt(timingAttempt);
			markProviderSuccess(route.providerId);
			return {
				response,
				usagePromise,
				upstreamRequestId,
				chosenRoute: route,
				circuitEvents,
				suppressErrorAlert: false,
				meta: dispatchMeta,
			};
		}

		const classification: UpstreamFailureClassification = shouldFailImmediatelyForImageAbort(dispatchMeta)
			? { action: 'fail_immediately' }
			: classifyUpstreamHttpFailure(response.status);
		logProviderSwitchAlert(route, classification, response.status);

		if (classification.action === 'fail_immediately') {
			timing?.markFinalAttempt(timingAttempt);
			return {
				response,
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId,
				chosenRoute: route,
				circuitEvents,
				suppressErrorAlert: false,
				meta: dispatchMeta,
			};
		}

		if (classification.failureKind) {
			const circuitResult = markProviderFailure(
				route.providerId,
				classification.failureKind,
				classification.failureKind === 'rate_limit'
					? parseRetryAfterMs(response.headers.get('retry-after'))
					: null
			);
			if (circuitResult.openedOrExtended) {
				circuitEvents.push({
					kind: 'provider',
					providerId: route.providerId,
					providerName: route.providerName,
					keyFingerprint:
						route.providerKeyFingerprint ?? fingerprintProviderApiKey(route.providerApiKey),
					failureKind: circuitResult.failureKind,
					openUntil: circuitResult.openUntil,
					cooldownMs: circuitResult.cooldownMs,
					openedOrExtended: true,
				});
			}
		}
		if (hasNextAttempt) timing?.markAttemptFailover(timingAttempt);
		console.warn(
			`[Gateway Proxy] provider non-OK, trying next candidate providerId=${route.providerId} status=${response.status}`
		);
	}

	if (!lastResponse) {
		return {
			response: gatewayErrorResponse({
				status: 502,
				code: GatewayErrorCode.noRoute,
				message: 'No supported upstream protocol route available',
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: lastRoute,
			circuitEvents,
			suppressErrorAlert: false,
		};
	}

	timing?.markFinalAttempt(lastTimingAttempt);
	return {
		response: lastResponse,
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: null,
		chosenRoute: lastRoute,
		circuitEvents,
		suppressErrorAlert: false,
	};
}

/** @deprecated 使用 {@link failoverDispatch} */
export const failoverDispatchWithKeyPool = failoverDispatch;
