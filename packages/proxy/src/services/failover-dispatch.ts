/**
 * 上游调度与故障转移：
 * - 可选 Provider sticky（跨 Tier 优先）→ priority 硬序 + 层内 route strategy 编排尝试序列。
 * - 失败按类别进入 provider 熔断（`provider-circuit-breaker`：429 无头 5s→60s 梯度；普通 5xx 连续 3 次后 10s；524/fetch 不跨请求熔断）。
 * - 全部候选因熔断不可用时返回 429 + Retry-After（而非 502）。
 * - 循环内复查：本次请求内刚被熔断的 provider（同 providerId 多 target）不再打。
 */
import type { GatewayRepositories, RouteStrategyName, UpstreamProtocol } from '@octafuse/core';
import { DEFAULT_ROUTE_STRATEGY, fingerprintProviderApiKey } from '@octafuse/core';
import { overlayClientHeadersOnRouteCustomParams } from '@octafuse/core/route-custom-params';
import type { RoutePoolStickyRoutingConfig } from '@octafuse/core/db/route-pool-sticky-types';
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
	classifyUpstreamFetchFailure,
	classifyUpstreamHttpFailure,
	type UpstreamFailureClassification,
} from './upstream-failure-classifier';
import type { RequestTimingAttempt, RequestTimingCollector } from './request-timing';
import { GatewayErrorCode, NO_AVAILABLE_ROUTE_MESSAGE } from './gateway-error-codes';
import { gatewayErrorResponse, gatewayNestedErrorResponse } from './gateway-error-response';
import { formatHttpErrorTextForRequestLog } from './request-log-record-status';
import {
	clearStickyBindingSync,
	mergeStickyIntoAttempts,
	resolveStickySession,
	resolveStickyTrace,
	scheduleStickyBind,
	scheduleStickyTouchIfNeeded,
	shouldInvalidateStickyBinding,
	stickyMutationPromise,
	type StickySession,
	type StickyTraceSnapshot,
} from './provider-sticky-routing';

/** Opportunistic hygiene: ~1/500 sticky-enabled requests purge expired rows. */
const STICKY_STALE_GC_PROBABILITY = 1 / 500;
const STICKY_STALE_GC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STICKY_STALE_GC_LIMIT = 500;

function maybeScheduleStickyStaleGc(
	repos: GatewayRepositories,
	session: StickySession,
	nowMs = Date.now()
): void {
	if (Math.random() >= STICKY_STALE_GC_PROBABILITY) return;
	const cutoffIso = new Date(nowMs - STICKY_STALE_GC_MAX_AGE_MS).toISOString();
	session.mutations.push(
		repos.routePoolSticky.deleteStaleBefore(cutoffIso, STICKY_STALE_GC_LIMIT).catch((err) => {
			console.warn('[Gateway Sticky] stale GC failed', err);
		})
	);
}

/** Images 合成 abort（Gateway 超时 / 客户端取消）——禁止 failover 再打上游。 */
export type ImageDispatchAbortReason = 'client_abort' | 'gateway_timeout';

/** 协议 driver 可选透传（如 Images / Audio 已解析的 body / usage，避免 route 侧重复 parse）。 */
export type ProxyDispatchMeta = {
	imageUsage?: import('@octafuse/core').ImageTokenUsage | null;
	parsedBody?: unknown;
	/** 仅 Images：上游 wait 被 abort 时由 driver 写入（见 openai-images-driver） */
	imageAbortReason?: ImageDispatchAbortReason;
	/** 仅 DashScope 生图：由上游 usage 推导的 per_image 档位（如 `1k` / `2k`） */
	imageBillingSize?: string | null;
	/** 仅 Audio transcriptions：计费时长（秒） */
	audioDurationSeconds?: number | null;
	/** TTS 透传：上游 `usage.characters`；缺失时不按输入长度补算。 */
	audioCharacters?: number | null;
	/** 生图透传：从原生 `output.choices` 数出的图片张数。 */
	imageCount?: number | null;
	/** 仅 Audio：duration 来源 */
	audioDurationSource?: 'upstream' | 'media' | 'client' | 'estimated' | null;
	/** 仅 Audio：上传文件字节数 */
	audioFileBytes?: number;
	/** 仅 Audio token 计费：上游 `usage.type=tokens` */
	audioTokenUsage?: import('@octafuse/core').AudioTokenUsage | null;
	/** 客户端额外字段命中受保护路径后被改回的点路径。 */
	restoredUpstreamPaths?: string[];
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
	/**
	 * Lazy sticky observation for `route_trace`.
	 * Await inside request-log background work so CAS outcomes are visible.
	 */
	stickyTrace?: (() => Promise<StickyTraceSnapshot>) | undefined;
	/** Background bind/touch mutations (schedule via waitUntil) */
	stickyMutationPromise?: Promise<unknown> | null;
};

export type FailoverDispatchOptions = {
	affinityKey: string;
	tierKeyPrefix: string;
	strategy: RouteStrategyName;
	/** Per-priority overrides from `route_pools.tier_strategies` */
	tierStrategies?: ReadonlyMap<number, RouteStrategyName> | null;
	timing?: RequestTimingCollector | null;
	/** Route pool id for sticky bindings (null disables sticky) */
	routePoolId?: string | null;
	/** Pool sticky config from surface join */
	sticky?: RoutePoolStickyRoutingConfig | null;
	/** Incoming user request headers; used to overlay route `custom_params.headers` when force override is off. */
	inboundHeaders?: Headers;
	/** 尚未收到非空 chunk 时的等待上限；未设则 driver 用代码默认。 */
	firstChunkTimeoutMs?: number;
	/** 已吐 chunk 后两次 chunk 之间的空闲上限；未设则 driver 用代码默认。 */
	idleTimeoutMs?: number;
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

/** 故障转移前最多读这么多错误体，避免把大响应整段拉进日志。 */
const FAILOVER_ERROR_BODY_CHARS = 8192;
/** 错误体迟迟不结束时放弃等待，先切下一候选。 */
const FAILOVER_ERROR_BODY_READ_MS = 300;
const FAILOVER_LOG_REASON_CHARS = 240;

function providerLabel(route: RouteResult): string {
	const name = route.providerName?.trim();
	return name || route.providerId;
}

function clipLogReason(reason: string): string {
	const collapsed = reason.replace(/\s+/g, ' ').trim();
	const clipped =
		collapsed.length > FAILOVER_LOG_REASON_CHARS
			? `${collapsed.slice(0, FAILOVER_LOG_REASON_CHARS)}…`
			: collapsed;
	return JSON.stringify(clipped);
}

/**
 * 只读错误体的前一段。用 clone，不消耗返回给客户端的原响应。
 * 读超时或 body 已锁定时返回已读到的文本，调用方退回 `HTTP <status>`。
 */
async function readResponsePrefix(response: Response, maxChars: number, timeoutMs: number): Promise<string> {
	const body = response.body;
	if (!body) return '';
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let text = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<null>((resolve) => {
			timer = setTimeout(() => resolve(null), timeoutMs);
		});
		while (text.length < maxChars) {
			// 读失败并到超时分支时不能变成未处理的 rejection。
			const read = reader.read().then(
				(result) => result,
				() => null
			);
			const next = await Promise.race([read, timeout]);
			if (!next || next.done) break;
			text += decoder.decode(next.value, { stream: true });
		}
		text += decoder.decode();
		return text.length > maxChars ? text.slice(0, maxChars) : text;
	} finally {
		if (timer) clearTimeout(timer);
		try {
			await reader.cancel();
		} catch {
			// 原响应仍可用；取消 clone 失败不影响故障转移。
		}
	}
}

async function summarizeUpstreamHttpError(response: Response): Promise<string> {
	const contentType = response.headers.get('content-type');
	try {
		const text = await readResponsePrefix(
			response.clone(),
			FAILOVER_ERROR_BODY_CHARS,
			FAILOVER_ERROR_BODY_READ_MS
		);
		return formatHttpErrorTextForRequestLog(response.status, contentType, text);
	} catch {
		return `HTTP ${response.status}`;
	}
}

type FailoverCircuitNote = 'none' | 'closed' | `open:${number}`;

function logFailoverDecision(input: {
	headline: string;
	candidateIndex: number;
	candidateCount: number;
	route: RouteResult;
	next: RouteResult | null;
	status: number | 'fetch';
	kind: string;
	reason: string;
	sticky: boolean;
	stickyCleared: boolean;
	circuit: FailoverCircuitNote;
}): void {
	const circuit =
		input.circuit === 'none'
			? ' circuit=none'
			: input.circuit === 'closed'
				? ' circuit=closed'
				: ` circuit=open cooldownMs=${input.circuit.slice('open:'.length)}`;
	const next = input.next
		? ` nextProviderId=${input.next.providerId} nextProvider=${providerLabel(input.next)} nextTarget=${input.next.targetId}`
		: ' next=none';
	const sticky = input.sticky ? ' sticky=1' : '';
	const stickyCleared = input.stickyCleared ? ' stickyCleared=1' : '';
	console.warn(
		`[Gateway Proxy] ${input.headline} candidate=${input.candidateIndex + 1}/${input.candidateCount} providerId=${input.route.providerId} provider=${providerLabel(input.route)} target=${input.route.targetId} model=${input.route.providerModelName} priority=${input.route.routePriority} key=${input.route.providerKeyFingerprint ?? '-'} status=${input.status} kind=${input.kind}${circuit}${sticky}${stickyCleared}${next} reason=${clipLogReason(input.reason)}`
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
 * 按「可选 sticky → provider priority 层 → route strategy」调度上游请求。
 */
export async function failoverDispatch(
	repos: GatewayRepositories,
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
	const protocolRoutes = routes
		.filter((route) => {
			if (expectedProtocols.includes(route.upstreamProtocol)) return true;
			console.warn(
				`[Gateway Proxy] unsupported protocol, skipping providerId=${route.providerId} protocol=${route.upstreamProtocol}`
			);
			return false;
		})
		.map((route) => {
			const customParams = overlayClientHeadersOnRouteCustomParams(route.customParams, {
				clientHeaders: options?.inboundHeaders,
			});
			return customParams === route.customParams ? route : { ...route, customParams };
		});

	if (protocolRoutes.length === 0) {
		return {
			response: gatewayErrorResponse({
				status: 404,
				code: GatewayErrorCode.noRoute,
				message: NO_AVAILABLE_ROUTE_MESSAGE,
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
	const stickyConfig = options?.sticky ?? null;
	const routePoolId =
		options?.routePoolId ?? protocolRoutes.find((r) => r.routePoolId)?.routePoolId ?? null;

	const { session: stickySession, stickyRoute } = stickyConfig?.enabled
		? await resolveStickySession(repos, {
				routePoolId,
				affinityKey,
				config: stickyConfig,
				candidates: protocolRoutes,
			})
		: { session: null, stickyRoute: null };

	if (stickySession) {
		maybeScheduleStickyStaleGc(repos, stickySession);
	}

	const circuitEvents: GatewayCircuitAlertEvent[] = [];
	const plan = buildRouteAttemptPlan(
		protocolRoutes,
		{ affinityKey, tierKeyPrefix },
		strategy,
		Date.now(),
		tierStrategies
	);
	const attempts = mergeStickyIntoAttempts(plan.attempts, stickyRoute);

	if (attempts.length === 0) {
		return {
			response: allProvidersBusyResponse(plan.earliestRetryAfterMs),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: protocolRoutes[0]!,
			circuitEvents: [],
			suppressErrorAlert: allProvidersBusyDueToCircuitOnly(plan),
			stickyTrace: () => resolveStickyTrace(stickySession),
			stickyMutationPromise: stickyMutationPromise(stickySession),
		};
	}

	let lastResponse: Response | null = null;
	let lastRoute: RouteResult = protocolRoutes[0]!;
	let lastTimingAttempt: RequestTimingAttempt | undefined;
	let stickyAttemptCleared = false;

	const finish = (result: ProxyFailoverResult): ProxyFailoverResult => ({
		...result,
		stickyTrace: () => resolveStickyTrace(stickySession),
		stickyMutationPromise: stickyMutationPromise(stickySession),
	});

	for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
		const route = attempts[attemptIndex]!;
		const isStickyAttempt =
			Boolean(stickyRoute) && route.targetId === stickyRoute!.targetId && attemptIndex === 0;

		const circuitRemainingMs = getProviderCircuitRemainingMs(route.providerId);
		if (circuitRemainingMs > 0) {
			console.warn(
				`[Gateway Proxy] provider cooling down mid-request, skipping candidate=${attemptIndex + 1}/${attempts.length} providerId=${route.providerId} provider=${providerLabel(route)} target=${route.targetId} remainingMs=${circuitRemainingMs}`
			);
			continue;
		}

		const timingAttempt = timing?.startAttempt(route);
		lastTimingAttempt = timingAttempt;
		const hasNextAttempt = attemptIndex < attempts.length - 1;
		const nextRoute = hasNextAttempt ? attempts[attemptIndex + 1]! : null;
		console.log(
			`[Gateway Proxy] calling provider candidate=${attemptIndex + 1}/${attempts.length} providerId=${route.providerId} provider=${providerLabel(route)} target=${route.targetId} model=${route.providerModelName} priority=${route.routePriority}${isStickyAttempt ? ' sticky=1' : ''}`
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
			const errMessage = err instanceof Error ? err.message : String(err);
			timing?.markAttemptFailure(timingAttempt, { error: errMessage, failureKind: 'fetch' });
			if (hasNextAttempt) timing?.markAttemptFailover(timingAttempt);
			const fetchClassification = classifyUpstreamFetchFailure();
			let stickyCleared = false;
			if (
				stickySession &&
				isStickyAttempt &&
				shouldInvalidateStickyBinding(fetchClassification)
			) {
				await clearStickyBindingSync(repos, stickySession);
				stickyAttemptCleared = true;
				stickyCleared = true;
			}
			logFailoverDecision({
				headline: nextRoute
					? 'fetch failed, trying next candidate'
					: 'fetch failed, no remaining candidate',
				candidateIndex: attemptIndex,
				candidateCount: attempts.length,
				route,
				next: nextRoute,
				status: 'fetch',
				kind: 'fetch',
				reason: errMessage || 'fetch failed',
				sticky: isStickyAttempt,
				stickyCleared,
				circuit: 'none',
			});
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
			if (stickySession) {
				if (isStickyAttempt && stickySession.bindingToken) {
					scheduleStickyTouchIfNeeded(repos, stickySession);
				} else if (stickySession.lookup !== 'invalid_circuit') {
					// invalid_circuit: keep the existing binding until the provider cools down;
					// tryBind would lose to CAS on a still-fresh row.
					scheduleStickyBind(repos, stickySession, route, {
						rebound:
							stickyAttemptCleared ||
							stickySession.lookup === 'hit' ||
							stickySession.lookup === 'invalid_target',
					});
				}
			}
			return finish({
				response,
				usagePromise,
				upstreamRequestId,
				chosenRoute: route,
				circuitEvents,
				suppressErrorAlert: false,
				meta: dispatchMeta,
			});
		}

		const classification: UpstreamFailureClassification = shouldFailImmediatelyForImageAbort(dispatchMeta)
			? { action: 'fail_immediately' }
			: classifyUpstreamHttpFailure(response.status);
		let stickyCleared = false;

		if (
			stickySession &&
			isStickyAttempt &&
			shouldInvalidateStickyBinding(classification, {
				imageAbort: shouldFailImmediatelyForImageAbort(dispatchMeta),
			})
		) {
			await clearStickyBindingSync(repos, stickySession);
			stickyAttemptCleared = true;
			stickyCleared = true;
		}

		if (classification.action === 'fail_immediately') {
			timing?.markFinalAttempt(timingAttempt);
			return finish({
				response,
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId,
				chosenRoute: route,
				circuitEvents,
				suppressErrorAlert: false,
				meta: dispatchMeta,
			});
		}

		let circuit: FailoverCircuitNote = 'none';
		if (classification.failureKind) {
			const circuitResult = markProviderFailure(
				route.providerId,
				classification.failureKind,
				classification.failureKind === 'rate_limit'
					? parseRetryAfterMs(response.headers.get('retry-after'))
					: null
			);
			circuit = circuitResult.openedOrExtended ? `open:${circuitResult.cooldownMs}` : 'closed';
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
		const failureKind =
			classification.failureKind ?? (response.status === 524 ? 'timeout' : 'retry');
		const reason = await summarizeUpstreamHttpError(response);
		timing?.markAttemptFailure(timingAttempt, {
			status: response.status,
			error: reason,
			failureKind,
		});
		if (hasNextAttempt) timing?.markAttemptFailover(timingAttempt);
		const authOrQuota = classification.alertOnKeySwitch === true;
		logFailoverDecision({
			headline: authOrQuota
				? nextRoute
					? 'provider auth or quota issue, trying next provider'
					: 'provider auth or quota issue, no remaining candidate'
				: nextRoute
					? 'provider non-OK, trying next candidate'
					: 'provider non-OK, no remaining candidate',
			candidateIndex: attemptIndex,
			candidateCount: attempts.length,
			route,
			next: nextRoute,
			status: response.status,
			kind: failureKind,
			reason,
			sticky: isStickyAttempt,
			stickyCleared,
			circuit,
		});
	}

	if (!lastResponse) {
		return finish({
			response: gatewayErrorResponse({
				status: 404,
				code: GatewayErrorCode.noRoute,
				message: NO_AVAILABLE_ROUTE_MESSAGE,
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: lastRoute,
			circuitEvents,
			suppressErrorAlert: false,
		});
	}

	timing?.markFinalAttempt(lastTimingAttempt);
	return finish({
		response: lastResponse,
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: null,
		chosenRoute: lastRoute,
		circuitEvents,
		suppressErrorAlert: false,
	});
}

/** @deprecated 使用 {@link failoverDispatch} */
export const failoverDispatchWithKeyPool = failoverDispatch;
