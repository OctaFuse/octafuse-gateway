/**
 * 上游调度与故障转移：
 * - 批量预取候选 provider 的 key 池，经 `buildKeyAttemptPlan` 编排（priority 硬序 + 层内余量 + 粘性置顶）。
 * - 失败按类别进入 key 熔断（`provider-key-circuit-breaker`：429 无头 5s→60s 梯度；普通 5xx 连续 3 次后 10s；524/fetch 不跨请求熔断）；限流计数见 `provider-key-rate-limiter`。
 * - 粘性绑定 key 短暂限流时在网关内短等待（保上游 prompt cache）；请求成功后写回/刷新绑定。
 * - 全部候选因限流/熔断不可用时返回 429 + Retry-After（而非 502）。
 */
import type { GatewayRepositories, StickyRouteRule, UpstreamProtocol } from '@octafuse/core';
import { fingerprintProviderApiKey, resolveStickyRouteRule } from '@octafuse/core';
import type { ActiveProviderApiKeyRow } from '@octafuse/core';
import type { RouteResult } from './model-router';
import type { UsageFromStream } from './proxy';
import { EMPTY_USAGE } from './proxy';
import { buildKeyAttemptPlan, type KeyAttempt } from './provider-key-scheduler';
import {
	markProviderKeyFailure,
	markProviderKeySuccess,
	parseRetryAfterMs,
} from './provider-key-circuit-breaker';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import { acquireProviderKey, releaseProviderKeyUsage } from './provider-key-rate-limiter';
import { getStickyBinding, setStickyBinding } from './sticky-key-binding';
import {
	classifyUpstreamHttpFailure,
	type UpstreamFailureClassification,
} from './upstream-failure-classifier';
import type { RequestTimingAttempt, RequestTimingCollector } from './request-timing';

/** 协议 driver 可选透传（如 Images 已解析的 body / usage，避免 route 侧重复 parse）。 */
export type ProxyDispatchMeta = {
	imageUsage?: import('@octafuse/core').ImageTokenUsage | null;
	parsedBody?: unknown;
};

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
	/** 本次请求触发的 provider key 熔断事件（仅 openedOrExtended） */
	circuitEvents: GatewayCircuitAlertEvent[];
	/** 因已有 provider key 熔断短路、无需重复 webhook 告警 */
	suppressErrorAlert: boolean;
	meta?: ProxyDispatchMeta;
};

/** 粘性路由上下文：由各协议路由在解析 `models.sticky_config` 后传入；null=该请求无粘性。 */
export type StickyDispatchContext = {
	userId: string;
	baseModelId: string;
	routeGroup: string;
	protocol: UpstreamProtocol;
	rule: StickyRouteRule;
};

export type FailoverDispatchOptions = {
	sticky?: StickyDispatchContext | null;
	timing?: RequestTimingCollector | null;
};

/**
 * 由 `models.sticky_config` 解析本次请求的粘性上下文；未配置或该「协议 × 分组」未开启时返回 null。
 * 供 chat / messages / gemini 路由在调用 proxy 前构建。
 */
export function buildStickyDispatchContext(params: {
	stickyConfigRaw: string | null | undefined;
	userId: string;
	baseModelId: string;
	routeGroup: string;
	protocol: UpstreamProtocol;
}): StickyDispatchContext | null {
	const rule = resolveStickyRouteRule(params.stickyConfigRaw, params.protocol, params.routeGroup);
	if (!rule) return null;
	return {
		userId: params.userId,
		baseModelId: params.baseModelId,
		routeGroup: params.routeGroup,
		protocol: params.protocol,
		rule,
	};
}

type DispatchFn = (
	route: RouteResult,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
) => Promise<ProxyDispatchResult>;

/** usagePromise 长期不结束时的并发释放兜底（大于路由层 5min usage 超时）。 */
const CONCURRENCY_RELEASE_SAFETY_MS = 10 * 60 * 1000;

function emptyRoute(protocol: UpstreamProtocol): RouteResult {
	return {
		providerId: '',
		providerName: '',
		providerModelName: '',
		upstreamProtocol: protocol,
		providerEndpoints: {},
		providerApiKey: '',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
	};
}

function routeWithKey(base: RouteResult, key: ActiveProviderApiKeyRow): RouteResult {
	return {
		...base,
		providerApiKey: key.api_key,
		providerKeyId: key.id,
		providerKeyLabel: key.label,
		providerKeyFingerprint: fingerprintProviderApiKey(key.api_key),
	};
}

function logKeySwitchAlert(route: RouteResult, classification: UpstreamFailureClassification, status?: number): void {
	if (!classification.alertOnKeySwitch) return;
	console.warn(
		`[Gateway Proxy] provider key auth issue, trying next key providerId=${route.providerId} keyId=${route.providerKeyId} status=${status ?? 'fetch_error'}`
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...extraHeaders },
	});
}

function allKeysBusyDueToCircuitOnly(plan: {
	attempts: { length: number };
	skippedByCircuit: number;
	skippedByRateLimiter: number;
}): boolean {
	return (
		plan.attempts.length === 0 &&
		plan.skippedByCircuit > 0 &&
		plan.skippedByRateLimiter === 0
	);
}

function allKeysBusyResponse(retryAfterMs: number | null): Response {
	const retryAfterSeconds = Math.max(1, Math.ceil((retryAfterMs ?? 30_000) / 1000));
	return jsonResponse(
		{
			error: {
				message: `All upstream keys are rate limited or cooling down. Please retry after ${retryAfterSeconds} seconds.`,
				type: 'upstream_capacity_exhausted',
				code: 'upstream_capacity_exhausted',
				retry_after_seconds: retryAfterSeconds,
			},
		},
		429,
		{ 'Retry-After': String(retryAfterSeconds) }
	);
}

/** 幂等的并发/TPM 释放：成功路径挂在 usagePromise 上，附超时兜底。 */
function scheduleUsageRelease(key: ActiveProviderApiKeyRow, usagePromise: Promise<UsageFromStream>): void {
	let released = false;
	const release = (tokens: number): void => {
		if (released) return;
		released = true;
		releaseProviderKeyUsage(key, tokens);
	};
	const safety = setTimeout(() => release(0), CONCURRENCY_RELEASE_SAFETY_MS);
	usagePromise
		.then((usage) => {
			clearTimeout(safety);
			release(usage.total_tokens);
		})
		.catch(() => {
			clearTimeout(safety);
			release(0);
		});
}

async function loadKeysByProvider(
	repos: GatewayRepositories,
	routes: RouteResult[]
): Promise<Map<string, ActiveProviderApiKeyRow[]>> {
	const providerIds = [...new Set(routes.map((r) => r.providerId))];
	const entries = await Promise.all(
		providerIds.map(async (providerId) => {
			const keys = await repos.providerKeys.getActiveProviderKeys(providerId);
			return [providerId, keys] as const;
		})
	);
	return new Map(entries);
}

/**
 * 按「provider priority 层 → key priority 批次 → 余量」调度上游请求，支持粘性绑定与短等待。
 */
export async function failoverDispatchWithKeyPool(
	repos: GatewayRepositories,
	routes: RouteResult[],
	expectedProtocol: UpstreamProtocol,
	dispatch: DispatchFn,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyFailoverResult> {
	const timing = options?.timing ?? null;
	timing?.markUpstreamDispatchStart();
	const protocolRoutes = routes.filter((route) => {
		if (route.upstreamProtocol === expectedProtocol) return true;
		console.warn(
			`[Gateway Proxy] unsupported protocol, skipping providerId=${route.providerId} protocol=${route.upstreamProtocol}`
		);
		return false;
	});

	if (protocolRoutes.length === 0) {
		return {
			response: jsonResponse({ error: 'No routes configured' }, 502),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: emptyRoute(expectedProtocol),
			circuitEvents: [],
			suppressErrorAlert: false,
		};
	}

	const keysByProvider = await loadKeysByProvider(repos, protocolRoutes);
	const totalKeys = [...keysByProvider.values()].reduce((sum, keys) => sum + keys.length, 0);
	if (totalKeys === 0) {
		console.warn(
			`[Gateway Proxy] no active keys for providers=${protocolRoutes.map((r) => r.providerId).join(',')}`
		);
		return {
			response: jsonResponse({ error: 'No active provider keys configured' }, 502),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: protocolRoutes[0]!,
			circuitEvents: [],
			suppressErrorAlert: false,
		};
	}

	const circuitEvents: GatewayCircuitAlertEvent[] = [];

	const sticky = options?.sticky ?? null;
	const stickyBinding = sticky
		? getStickyBinding(sticky.userId, sticky.baseModelId, sticky.routeGroup, sticky.protocol)
		: null;

	let plan = buildKeyAttemptPlan(
		protocolRoutes,
		keysByProvider,
		stickyBinding ? { binding: stickyBinding, shortWaitMs: sticky!.rule.shortWaitMs } : null
	);

	// 绑定 key 短暂限流：网关内短等待后重建计划（至多一次），保住上游 prompt cache。
	if (plan.stickyWait && !requestSignal?.aborted) {
		console.log(
			`[Gateway Proxy] sticky key busy, short-waiting ${plan.stickyWait.waitMs}ms keyId=${stickyBinding!.keyId}`
		);
		await sleep(plan.stickyWait.waitMs);
		plan = buildKeyAttemptPlan(
			protocolRoutes,
			keysByProvider,
			stickyBinding ? { binding: stickyBinding, shortWaitMs: 0 } : null
		);
	}

	if (plan.attempts.length === 0) {
		return {
			response: allKeysBusyResponse(plan.earliestRetryAfterMs),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: protocolRoutes[0]!,
			circuitEvents: [],
			suppressErrorAlert: allKeysBusyDueToCircuitOnly(plan),
		};
	}

	let lastResponse: Response | null = null;
	let lastRoute: RouteResult = protocolRoutes[0]!;
	let lastTimingAttempt: RequestTimingAttempt | undefined;

	const rebindOnSuccess = (attempt: KeyAttempt): void => {
		if (!sticky) return;
		setStickyBinding(
			sticky.userId,
			sticky.baseModelId,
			sticky.routeGroup,
			sticky.protocol,
			{ providerId: attempt.route.providerId, keyId: attempt.key.id },
			sticky.rule.ttlSeconds
		);
	};

	for (let attemptIndex = 0; attemptIndex < plan.attempts.length; attemptIndex += 1) {
		const attempt = plan.attempts[attemptIndex]!;
		const { route, key } = attempt;
		const attemptRoute = routeWithKey(route, key);
		const timingAttempt = timing?.startAttempt(attemptRoute);
		lastTimingAttempt = timingAttempt;
		const hasNextAttempt = attemptIndex < plan.attempts.length - 1;
		console.log(
			`[Gateway Proxy] calling provider providerId=${route.providerId} keyId=${key.id} model=${route.providerModelName}`
		);

		acquireProviderKey(key);

		let response: Response;
		let usagePromise: Promise<UsageFromStream>;
		let upstreamRequestId: string | null = null;
		let dispatchMeta: ProxyDispatchMeta | undefined;
		try {
			const dispatched = await dispatch(attemptRoute, requestSignal, timing, timingAttempt);
			response = dispatched.response;
			usagePromise = dispatched.usagePromise;
			upstreamRequestId = dispatched.upstreamRequestId;
			dispatchMeta = dispatched.meta;
		} catch (err) {
			timing?.markAttemptError(timingAttempt, err);
			if (hasNextAttempt) timing?.markAttemptFailover(timingAttempt);
			releaseProviderKeyUsage(key, 0);
			console.warn(
				`[Gateway Proxy] fetch failed providerId=${route.providerId} keyId=${key.id} error=${err instanceof Error ? err.message : String(err)}`
			);
			lastResponse = jsonResponse({ error: 'Upstream request failed' }, 502);
			lastRoute = attemptRoute;
			continue;
		}

		lastResponse = response;
		lastRoute = attemptRoute;

		if (response.ok) {
			timing?.markFinalAttempt(timingAttempt);
			markProviderKeySuccess(key.id);
			scheduleUsageRelease(key, usagePromise);
			rebindOnSuccess(attempt);
			return {
				response,
				usagePromise,
				upstreamRequestId,
				chosenRoute: attemptRoute,
				circuitEvents,
				suppressErrorAlert: false,
				meta: dispatchMeta,
			};
		}

		// 非 2xx：无流式在途，立即释放并发。
		releaseProviderKeyUsage(key, 0);

		const classification = classifyUpstreamHttpFailure(response.status);
		logKeySwitchAlert(attemptRoute, classification, response.status);

		if (classification.action === 'fail_immediately') {
			timing?.markFinalAttempt(timingAttempt);
			return {
				response,
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId,
				chosenRoute: attemptRoute,
				circuitEvents,
				suppressErrorAlert: false,
				meta: dispatchMeta,
			};
		}

		if (classification.failureKind) {
			const circuitResult = markProviderKeyFailure(
				key.id,
				classification.failureKind,
				classification.failureKind === 'rate_limit'
					? parseRetryAfterMs(response.headers.get('retry-after'))
					: null
			);
			if (circuitResult.openedOrExtended) {
				circuitEvents.push({
					kind: 'provider_key',
					keyId: key.id,
					keyLabel: key.label,
					keyFingerprint: fingerprintProviderApiKey(key.api_key),
					failureKind: circuitResult.failureKind,
					openUntil: circuitResult.openUntil,
					cooldownMs: circuitResult.cooldownMs,
					openedOrExtended: true,
				});
			}
		}
		if (hasNextAttempt) timing?.markAttemptFailover(timingAttempt);
		console.warn(
			`[Gateway Proxy] provider key non-OK, trying next candidate providerId=${route.providerId} keyId=${key.id} status=${response.status}`
		);
	}

	if (!lastResponse) {
		return {
			response: jsonResponse({ error: 'No supported upstream protocol route available' }, 502),
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
