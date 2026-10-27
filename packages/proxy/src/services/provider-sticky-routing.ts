/**
 * Route Pool Provider sticky routing — lookup / plan merge / CAS bind·touch·clear.
 * Orthogonal to layer-in strategies (`hash_affinity` etc.).
 */
import type { GatewayRepositories } from '@octafuse/core';
import { hashAffinityKey } from '@octafuse/core/db/route-affinity-key';
import {
	coerceStickyEnabled,
	parseRoutePoolStickyConfig,
	STICKY_TOUCH_THROTTLE_SECONDS,
	type RoutePoolStickyRoutingConfig,
} from '@octafuse/core/db/route-pool-sticky-types';
import type { RouteResult } from './model-router';
import { getProviderCircuitRemainingMs } from './provider-circuit-breaker';
import type { UpstreamFailureClassification } from './upstream-failure-classifier';

export { hashAffinityKey } from '@octafuse/core/db/route-affinity-key';

export type StickyLookupStatus =
	| 'disabled'
	| 'miss'
	| 'hit'
	| 'expired'
	| 'invalid_epoch'
	| 'invalid_target'
	| 'invalid_circuit';
export type StickyResultStatus =
	| 'kept'
	| 'cleared'
	| 'bound'
	| 'rebound'
	| 'storage_error'
	| 'unchanged';

export type StickyTraceSnapshot = {
	lookup: StickyLookupStatus;
	attempted_target: string | null;
	result: StickyResultStatus;
};

export type StickySession = {
	config: RoutePoolStickyRoutingConfig;
	routePoolId: string;
	affinityHash: string;
	/** 明文 affinity key，写入绑定行供后台列出用户。 */
	affinityKey: string;
	/** Previous expires_at from DB (for touch throttle). */
	previousExpiresAt: string | null;
	bindingToken: string | null;
	boundTargetId: string | null;
	/**
	 * Token of a still-valid but unusable row (`invalid_target`).
	 * Passed to tryBind as expectedToken so CAS can overwrite.
	 */
	staleToken: string | null;
	lookup: StickyLookupStatus;
	attemptedTargetId: string | null;
	result: StickyResultStatus;
	mutations: Promise<unknown>[];
};

export function stickyConfigFromSurface(surface: {
	pool_sticky_enabled?: unknown;
	pool_sticky_idle_ttl_seconds?: unknown;
	pool_sticky_epoch?: unknown;
} | null): RoutePoolStickyRoutingConfig {
	return parseRoutePoolStickyConfig({
		stickyEnabled: surface?.pool_sticky_enabled,
		stickyIdleTtlSeconds: surface?.pool_sticky_idle_ttl_seconds,
		stickyEpoch: surface?.pool_sticky_epoch,
	});
}

function toIso(ms: number): string {
	return new Date(ms).toISOString();
}

function parseExpiresAtMs(raw: string): number {
	const ms = Date.parse(raw);
	return Number.isFinite(ms) ? ms : 0;
}

function shouldThrottleTouch(expiresAtMs: number, idleTtlSec: number, nowMs: number): boolean {
	const lastTouchApprox = expiresAtMs - idleTtlSec * 1000;
	return nowMs - lastTouchApprox < STICKY_TOUCH_THROTTLE_SECONDS * 1000;
}

export function shouldInvalidateStickyBinding(
	classification: UpstreamFailureClassification,
	opts?: { imageAbort?: boolean }
): boolean {
	if (opts?.imageAbort) return false;
	return classification.action === 'retry_key';
}

export function mergeStickyIntoAttempts(
	attempts: RouteResult[],
	stickyRoute: RouteResult | null
): RouteResult[] {
	if (!stickyRoute) return attempts;
	const rest = attempts.filter((r) => r.targetId !== stickyRoute.targetId);
	return [stickyRoute, ...rest];
}

export function emptyStickyTrace(): StickyTraceSnapshot {
	return { lookup: 'disabled', attempted_target: null, result: 'unchanged' };
}

export function stickySessionToTrace(session: StickySession | null): StickyTraceSnapshot {
	if (!session) return emptyStickyTrace();
	return {
		lookup: session.lookup,
		attempted_target: session.attemptedTargetId,
		result: session.result,
	};
}

/**
 * Await pending sticky mutations then snapshot for `route_trace`.
 * Call from request-log background work so CAS outcomes are visible.
 */
export async function resolveStickyTrace(session: StickySession | null): Promise<StickyTraceSnapshot> {
	if (!session) return emptyStickyTrace();
	if (session.mutations.length > 0) {
		await Promise.allSettled(session.mutations);
	}
	return stickySessionToTrace(session);
}

/**
 * Resolve sticky binding for this request. Fail-open on storage errors.
 */
export async function resolveStickySession(
	repos: GatewayRepositories,
	params: {
		routePoolId: string | null | undefined;
		affinityKey: string;
		config: RoutePoolStickyRoutingConfig;
		candidates: RouteResult[];
		nowMs?: number;
	}
): Promise<{ session: StickySession | null; stickyRoute: RouteResult | null }> {
	const routePoolId = params.routePoolId?.trim() || '';
	if (!routePoolId || !params.config.enabled || !params.affinityKey) {
		return { session: null, stickyRoute: null };
	}

	const nowMs = params.nowMs ?? Date.now();
	let affinityHash: string;
	try {
		affinityHash = await hashAffinityKey(params.affinityKey);
	} catch (err) {
		console.warn('[Gateway Sticky] affinity hash failed; sticky disabled for request', err);
		return {
			session: {
				config: params.config,
				routePoolId,
				affinityHash: '',
				affinityKey: params.affinityKey,
				previousExpiresAt: null,
				bindingToken: null,
				boundTargetId: null,
				staleToken: null,
				lookup: 'miss',
				attemptedTargetId: null,
				result: 'storage_error',
				mutations: [],
			},
			stickyRoute: null,
		};
	}

	const session: StickySession = {
		config: params.config,
		routePoolId,
		affinityHash,
		affinityKey: params.affinityKey,
		previousExpiresAt: null,
		bindingToken: null,
		boundTargetId: null,
		staleToken: null,
		lookup: 'miss',
		attemptedTargetId: null,
		result: 'unchanged',
		mutations: [],
	};

	try {
		const row = await repos.routePoolSticky.getBinding(routePoolId, affinityHash);
		if (!row) {
			session.lookup = 'miss';
			return { session, stickyRoute: null };
		}

		const expiresAtMs = parseExpiresAtMs(row.expires_at);
		if (expiresAtMs <= nowMs) {
			session.lookup = 'expired';
			return { session, stickyRoute: null };
		}
		if (row.pool_epoch !== params.config.epoch) {
			session.lookup = 'invalid_epoch';
			return { session, stickyRoute: null };
		}

		const stickyRoute = params.candidates.find((r) => r.targetId === row.route_target_id) ?? null;
		if (!stickyRoute) {
			session.lookup = 'invalid_target';
			session.staleToken = row.binding_token;
			return { session, stickyRoute: null };
		}
		if (getProviderCircuitRemainingMs(stickyRoute.providerId, nowMs) > 0) {
			session.lookup = 'invalid_circuit';
			return { session, stickyRoute: null };
		}

		session.lookup = 'hit';
		session.previousExpiresAt = row.expires_at;
		session.bindingToken = row.binding_token;
		session.boundTargetId = row.route_target_id;
		session.attemptedTargetId = row.route_target_id;
		return { session, stickyRoute };
	} catch (err) {
		console.warn('[Gateway Sticky] lookup failed; failing open to normal routing', err);
		session.lookup = 'miss';
		session.result = 'storage_error';
		return { session, stickyRoute: null };
	}
}

export function scheduleStickyTouchIfNeeded(
	repos: GatewayRepositories,
	session: StickySession,
	nowMs = Date.now()
): void {
	if (!session.bindingToken) return;
	if (
		session.previousExpiresAt &&
		shouldThrottleTouch(
			parseExpiresAtMs(session.previousExpiresAt),
			session.config.idleTtlSeconds,
			nowMs
		)
	) {
		session.result = 'kept';
		return;
	}
	const expiresAt = toIso(nowMs + session.config.idleTtlSeconds * 1000);
	const token = session.bindingToken;
	session.result = 'kept';
	session.mutations.push(
		repos.routePoolSticky
			.touchBinding({
				routePoolId: session.routePoolId,
				affinityHash: session.affinityHash,
				expectedToken: token,
				expiresAt,
				nowIso: toIso(nowMs),
				affinityKey: session.affinityKey,
			})
			.then((ok) => {
				if (!ok) session.result = 'unchanged';
			})
			.catch((err) => {
				console.warn('[Gateway Sticky] touch failed', err);
				session.result = 'storage_error';
			})
	);
}

export async function clearStickyBindingSync(
	repos: GatewayRepositories,
	session: StickySession
): Promise<void> {
	if (!session.bindingToken) {
		session.result = 'unchanged';
		return;
	}
	try {
		const ok = await repos.routePoolSticky.clearBinding({
			routePoolId: session.routePoolId,
			affinityHash: session.affinityHash,
			expectedToken: session.bindingToken,
		});
		session.bindingToken = null;
		session.boundTargetId = null;
		session.result = ok ? 'cleared' : 'unchanged';
	} catch (err) {
		console.warn('[Gateway Sticky] clear failed', err);
		session.bindingToken = null;
		session.boundTargetId = null;
		session.result = 'storage_error';
	}
}

export function scheduleStickyBind(
	repos: GatewayRepositories,
	session: StickySession,
	route: RouteResult,
	opts?: { rebound?: boolean; nowMs?: number }
): void {
	const nowMs = opts?.nowMs ?? Date.now();
	const bindingToken = crypto.randomUUID();
	const expiresAt = toIso(nowMs + session.config.idleTtlSeconds * 1000);
	const previousHadBinding =
		session.lookup === 'hit' ||
		session.lookup === 'invalid_target' ||
		Boolean(session.boundTargetId);
	const expectedToken = session.staleToken;
	session.bindingToken = bindingToken;
	session.boundTargetId = route.targetId;
	session.attemptedTargetId = route.targetId;
	session.result = opts?.rebound || previousHadBinding ? 'rebound' : 'bound';
	session.mutations.push(
		repos.routePoolSticky
			.tryBind({
				routePoolId: session.routePoolId,
				affinityHash: session.affinityHash,
				routeTargetId: route.targetId,
				bindingToken,
				poolEpoch: session.config.epoch,
				expiresAt,
				nowIso: toIso(nowMs),
				expectedToken: expectedToken ?? undefined,
				affinityKey: session.affinityKey,
			})
			.then((ok) => {
				if (!ok) session.result = 'unchanged';
			})
			.catch((err) => {
				console.warn('[Gateway Sticky] bind failed', err);
				session.result = 'storage_error';
			})
	);
}

export function stickyMutationPromise(session: StickySession | null): Promise<unknown> | null {
	if (!session || session.mutations.length === 0) return null;
	return Promise.allSettled(session.mutations);
}

/** Convenience: was sticky enabled for this pool? */
export function isStickyEnabled(raw: unknown): boolean {
	return coerceStickyEnabled(raw);
}
