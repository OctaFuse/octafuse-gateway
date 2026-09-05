/**
 * Per-key / per-user rate limit JSON (`api_keys.rate_limit`, `users.rate_limit`).
 * NULL / empty object = that layer is unlimited. Current dimension: `rpm` (rolling 60s).
 * `rpm: 0` rejects metered calls. Layers are independent; Key is a per-key cap, User is a shared pool.
 */

import type { ApiKeyRateLimit } from '../types';

export type { ApiKeyRateLimit };

export const API_KEY_RATE_WINDOW_MS = 60_000;
export const INGRESS_HOST_MAX_LENGTH = 255;

const RATE_LIMIT_INVALID = 'rate_limit must be a JSON object or null';
const RATE_LIMIT_RPM_INVALID = 'rate_limit.rpm must be a non-negative integer';

export function resolveIngressHost(hostHeader?: string | null, requestUrl?: string): string | null {
	const fromHeader = hostHeader?.trim() ?? '';
	if (fromHeader) return fromHeader.slice(0, INGRESS_HOST_MAX_LENGTH);
	if (!requestUrl) return null;
	try {
		const host = new URL(requestUrl).host.trim();
		return host ? host.slice(0, INGRESS_HOST_MAX_LENGTH) : null;
	} catch {
		return null;
	}
}

function parseNonNegativeInt(raw: unknown): number | null {
	if (raw == null || raw === '') return null;
	if (typeof raw === 'boolean' || typeof raw === 'object') return null;
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.floor(n);
}

function extractKnownRateLimit(raw: Record<string, unknown>): ApiKeyRateLimit | null {
	const out: ApiKeyRateLimit = {};
	if ('rpm' in raw && raw.rpm != null && raw.rpm !== '') {
		const n = parseNonNegativeInt(raw.rpm);
		if (n != null) out.rpm = n;
	}
	return out.rpm == null ? null : out;
}

function coerceRateLimitObject(raw: Record<string, unknown>): { ok: true; value: ApiKeyRateLimit | null } | { ok: false; message: string } {
	const out: ApiKeyRateLimit = {};
	for (const [key, value] of Object.entries(raw)) {
		if (value === undefined || value === null || value === '') continue;
		if (key === 'rpm') {
			const n = parseNonNegativeInt(value);
			if (n == null) return { ok: false, message: RATE_LIMIT_RPM_INVALID };
			out.rpm = n;
			continue;
		}
		return { ok: false, message: `rate_limit.${key} is not supported` };
	}
	return { ok: true, value: out.rpm == null ? null : out };
}

/** Admin PATCH: omit vs null (unlimited) vs `{ rpm?: number }`. */
export function coerceRateLimitInput(
	raw: unknown
): { ok: true; omit: true } | { ok: true; value: ApiKeyRateLimit | null } | { ok: false; message: string } {
	if (raw === undefined) return { ok: true, omit: true };
	if (raw === null || raw === '') return { ok: true, value: null };
	let obj: unknown = raw;
	if (typeof raw === 'string') {
		try {
			obj = JSON.parse(raw);
		} catch {
			return { ok: false, message: RATE_LIMIT_INVALID };
		}
	}
	if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
		return { ok: false, message: RATE_LIMIT_INVALID };
	}
	return coerceRateLimitObject(obj as Record<string, unknown>);
}

/** Parse `api_keys.rate_limit` TEXT JSON (or already-parsed object). Invalid JSON → unlimited. */
export function parseApiKeyRateLimit(raw: unknown): ApiKeyRateLimit | null {
	if (raw == null || raw === '') return null;
	let obj: unknown = raw;
	if (typeof raw === 'string') {
		try {
			obj = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
	return extractKnownRateLimit(obj as Record<string, unknown>);
}

export function serializeApiKeyRateLimit(limit: ApiKeyRateLimit | null | undefined): string | null {
	if (!limit) return null;
	const out: ApiKeyRateLimit = {};
	if (limit.rpm != null) out.rpm = limit.rpm;
	if (out.rpm == null) return null;
	return JSON.stringify(out);
}

export function rateLimitEquals(
	a: ApiKeyRateLimit | null | undefined,
	b: ApiKeyRateLimit | null | undefined
): boolean {
	return serializeApiKeyRateLimit(a ?? null) === serializeApiKeyRateLimit(b ?? null);
}

export function rateLimitRpmOf(limit: ApiKeyRateLimit | null | undefined): number | null {
	return limit?.rpm ?? null;
}

export function currentRateWindowStartedAt(nowMs = Date.now()): string {
	const start = Math.floor(nowMs / API_KEY_RATE_WINDOW_MS) * API_KEY_RATE_WINDOW_MS;
	return new Date(start).toISOString();
}

/** After incrementing the window, `count > rpm` is exceeded. NULL rpm is never exceeded. */
export function isRateLimitExceeded(count: number, rpm: number | null | undefined): boolean {
	if (rpm == null) return false;
	return count > rpm;
}

export function rateLimitRetryAfterSeconds(windowStartedAtIso: string, nowMs = Date.now()): number {
	const start = Date.parse(windowStartedAtIso);
	if (!Number.isFinite(start)) return 60;
	return Math.max(1, Math.ceil((start + API_KEY_RATE_WINDOW_MS - nowMs) / 1000));
}

export function keyRateLimitSubject(keyId: string): string {
	return `k:${keyId}`;
}

export function userRateLimitSubject(userId: string): string {
	return `u:${userId}`;
}

export type RateLimitLayer = {
	subject: string;
	rpm: number | null | undefined;
};

/**
 * Per-subject RPM window counter. Default is process/isolate memory (same consistency as
 * circuit breakers). Swap in Redis later via `setApiKeyRateLimitStore`.
 * Subjects should be prefixed (`k:` / `u:`) so key and user UUIDs never collide.
 */
export type ApiKeyRateLimitStore = {
	consume(subject: string, windowStartedAt: string): number | Promise<number>;
};

const MEMORY_RATE_LIMIT_MAX_ENTRIES = 50_000;

export function createMemoryApiKeyRateLimitStore(
	maxEntries = MEMORY_RATE_LIMIT_MAX_ENTRIES
): ApiKeyRateLimitStore {
	const windows = new Map<string, { windowStartedAt: string; count: number }>();
	return {
		consume(subject, windowStartedAt) {
			const prev = windows.get(subject);
			if (!prev || prev.windowStartedAt !== windowStartedAt) {
				windows.set(subject, { windowStartedAt, count: 1 });
			} else {
				prev.count += 1;
			}
			if (windows.size > maxEntries) {
				for (const [id, row] of windows) {
					if (row.windowStartedAt !== windowStartedAt) windows.delete(id);
				}
				if (windows.size > maxEntries) {
					const overflow = windows.size - maxEntries;
					let dropped = 0;
					for (const id of windows.keys()) {
						if (dropped >= overflow) break;
						windows.delete(id);
						dropped += 1;
					}
				}
			}
			return windows.get(subject)?.count ?? 1;
		},
	};
}

let defaultStore: ApiKeyRateLimitStore = createMemoryApiKeyRateLimitStore();

export function getApiKeyRateLimitStore(): ApiKeyRateLimitStore {
	return defaultStore;
}

export function setApiKeyRateLimitStore(store: ApiKeyRateLimitStore): void {
	defaultStore = store;
}

export async function consumeApiKeyRateWindow(
	subject: string,
	windowStartedAt: string,
	store: ApiKeyRateLimitStore = getApiKeyRateLimitStore()
): Promise<number> {
	return store.consume(subject, windowStartedAt);
}

/**
 * Consume layers in order (typically Key then User). A layer with NULL rpm is skipped.
 * If a layer is already exceeded, later layers are not consumed.
 */
export async function consumeRateLimitLayers(
	layers: RateLimitLayer[],
	windowStartedAt: string,
	store: ApiKeyRateLimitStore = getApiKeyRateLimitStore()
): Promise<{ exceeded: boolean }> {
	for (const layer of layers) {
		if (layer.rpm == null) continue;
		const count = await consumeApiKeyRateWindow(layer.subject, windowStartedAt, store);
		if (isRateLimitExceeded(count, layer.rpm)) {
			return { exceeded: true };
		}
	}
	return { exceeded: false };
}
