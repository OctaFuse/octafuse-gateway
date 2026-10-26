/**
 * Route Pool Provider sticky routing — config constants, parse/normalize helpers.
 */

export const DEFAULT_STICKY_IDLE_TTL_SECONDS = 3600;
export const MIN_STICKY_IDLE_TTL_SECONDS = 60;
export const MAX_STICKY_IDLE_TTL_SECONDS = 86400;
/** Merge consecutive touch writes within this window to reduce D1 write load. */
export const STICKY_TOUCH_THROTTLE_SECONDS = 60;

export type RoutePoolStickyRoutingConfig = {
	enabled: boolean;
	idleTtlSeconds: number;
	epoch: number;
};

export type RoutePoolStickyBindingRow = {
	route_pool_id: string;
	affinity_hash: string;
	route_target_id: string;
	binding_token: string;
	pool_epoch: number;
	expires_at: string;
	created_at?: string;
	updated_at?: string;
	/** 明文 `userId|modelId|routeGroup|protocol`；迁移 0034 前写入的旧行为 null。 */
	affinity_key?: string | null;
};

/** Paged active-binding row for the Admin "who is stuck where" list. */
export type RoutePoolStickyActiveBindingRow = {
	affinity_hash: string;
	affinity_key: string | null;
	route_target_id: string;
	expires_at: string;
	updated_at: string | null;
};

/** Aggregated active binding counts per target (epoch-valid + not expired). */
export type RoutePoolStickyBindingTargetCount = {
	route_target_id: string;
	active_count: number;
	last_updated_at: string | null;
};

export type StickyRoutingApiPayload = {
	enabled: boolean;
	idle_ttl_seconds: number;
};

export function clampStickyIdleTtlSeconds(raw: unknown, fallback = DEFAULT_STICKY_IDLE_TTL_SECONDS): number {
	const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
	if (!Number.isFinite(n)) return fallback;
	const rounded = Math.round(n);
	if (rounded < MIN_STICKY_IDLE_TTL_SECONDS) return MIN_STICKY_IDLE_TTL_SECONDS;
	if (rounded > MAX_STICKY_IDLE_TTL_SECONDS) return MAX_STICKY_IDLE_TTL_SECONDS;
	return rounded;
}

export function coerceStickyEnabled(raw: unknown): boolean {
	if (typeof raw === 'boolean') return raw;
	if (typeof raw === 'number') return raw !== 0;
	if (typeof raw === 'string') {
		const v = raw.trim().toLowerCase();
		if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
		if (v === '0' || v === 'false' || v === 'no' || v === 'off' || v === '') return false;
	}
	return false;
}

export function parseRoutePoolStickyConfig(params: {
	stickyEnabled?: unknown;
	stickyIdleTtlSeconds?: unknown;
	stickyEpoch?: unknown;
}): RoutePoolStickyRoutingConfig {
	return {
		enabled: coerceStickyEnabled(params.stickyEnabled),
		idleTtlSeconds: clampStickyIdleTtlSeconds(params.stickyIdleTtlSeconds),
		epoch:
			typeof params.stickyEpoch === 'number' && Number.isSafeInteger(params.stickyEpoch)
				? params.stickyEpoch
				: typeof params.stickyEpoch === 'string' && /^-?\d+$/.test(params.stickyEpoch.trim())
					? Number(params.stickyEpoch.trim())
					: 0,
	};
}

/**
 * Admin write validation for `sticky_routing` PATCH body.
 * Throws Error with a user-facing message on invalid input.
 */
export function normalizeStickyRoutingInput(raw: unknown): StickyRoutingApiPayload {
	if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('sticky_routing must be an object');
	}
	const obj = raw as Record<string, unknown>;
	if (obj.enabled === undefined) {
		throw new Error('sticky_routing.enabled is required');
	}
	const enabled = coerceStickyEnabled(obj.enabled);
	const idle =
		obj.idle_ttl_seconds === undefined
			? DEFAULT_STICKY_IDLE_TTL_SECONDS
			: (() => {
					const n =
						typeof obj.idle_ttl_seconds === 'number'
							? obj.idle_ttl_seconds
							: typeof obj.idle_ttl_seconds === 'string'
								? Number(obj.idle_ttl_seconds)
								: NaN;
					if (!Number.isFinite(n)) {
						throw new Error(
							`sticky_routing.idle_ttl_seconds must be an integer between ${MIN_STICKY_IDLE_TTL_SECONDS} and ${MAX_STICKY_IDLE_TTL_SECONDS}`
						);
					}
					const rounded = Math.round(n);
					if (rounded < MIN_STICKY_IDLE_TTL_SECONDS || rounded > MAX_STICKY_IDLE_TTL_SECONDS) {
						throw new Error(
							`sticky_routing.idle_ttl_seconds must be between ${MIN_STICKY_IDLE_TTL_SECONDS} and ${MAX_STICKY_IDLE_TTL_SECONDS}`
						);
					}
					return rounded;
				})();
	return { enabled, idle_ttl_seconds: idle };
}

/** Format TTL seconds for compact Admin chip labels (e.g. 3600 → "1h"). */
export function formatStickyIdleTtlShort(seconds: number): string {
	const s = clampStickyIdleTtlSeconds(seconds);
	if (s % 3600 === 0) return `${s / 3600}h`;
	if (s % 60 === 0) return `${s / 60}m`;
	return `${s}s`;
}
