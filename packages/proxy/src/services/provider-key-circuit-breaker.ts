/**
 * Provider key 熔断：替代原固定 60s cooldown（`provider-key-scheduler` 已迁移至此）。
 *
 * 按失败类别区分冷却策略：
 * - `rate_limit`（上游 429）：优先用上游 `Retry-After`；无头时按连续 429 次数递增退避
 *   （30s → 60s → 5min → 15min 封顶）；一次成功即清零。
 * - `auth`（401/403）：10min（key 大概率失效，等待人工处理；配合告警日志）。
 * - `server`（5xx / 网络错误）：60s。
 *
 * 熔断中的 key 一律跳过（不再有「全部冷却则回退全试」）；全部不可用时由 dispatch 层返回 429 + Retry-After。
 * 状态为单实例进程内存。
 */

export type ProviderKeyFailureKind = 'rate_limit' | 'auth' | 'server';

const RATE_LIMIT_BACKOFF_MS = [30_000, 60_000, 300_000, 900_000] as const;
const RATE_LIMIT_RETRY_AFTER_CAP_MS = 900_000;
const AUTH_COOLDOWN_MS = 600_000;
const SERVER_COOLDOWN_MS = 60_000;
const MAX_ENTRIES = 10_000;

type CircuitEntry = {
	openUntil: number;
	consecutiveRateLimit: number;
};

const circuitByKey = new Map<string, CircuitEntry>();

function purgeIfOverCapacity(now: number): void {
	if (circuitByKey.size <= MAX_ENTRIES) return;
	for (const [keyId, entry] of circuitByKey) {
		if (entry.openUntil <= now && entry.consecutiveRateLimit === 0) {
			circuitByKey.delete(keyId);
		}
	}
}

/**
 * 解析上游 `Retry-After` 头（秒数或 HTTP date）为毫秒；非法时 null。
 */
export function parseRetryAfterMs(retryAfterHeader: string | null | undefined, now = Date.now()): number | null {
	if (!retryAfterHeader) return null;
	const trimmed = retryAfterHeader.trim();
	if (/^\d+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		return seconds >= 0 ? seconds * 1000 : null;
	}
	const dateMs = Date.parse(trimmed);
	if (!Number.isNaN(dateMs)) {
		return Math.max(0, dateMs - now);
	}
	return null;
}

/**
 * 记录一次失败并打开熔断。
 * @param retryAfterMs 上游建议的恢复时间（仅 `rate_limit` 生效；来自 `parseRetryAfterMs`）
 */
export function markProviderKeyFailure(
	keyId: string,
	kind: ProviderKeyFailureKind,
	retryAfterMs?: number | null,
	now = Date.now()
): void {
	const entry = circuitByKey.get(keyId) ?? { openUntil: 0, consecutiveRateLimit: 0 };
	let cooldownMs: number;
	if (kind === 'rate_limit') {
		entry.consecutiveRateLimit += 1;
		if (retryAfterMs != null && retryAfterMs > 0) {
			cooldownMs = Math.min(retryAfterMs, RATE_LIMIT_RETRY_AFTER_CAP_MS);
		} else {
			const idx = Math.min(entry.consecutiveRateLimit - 1, RATE_LIMIT_BACKOFF_MS.length - 1);
			cooldownMs = RATE_LIMIT_BACKOFF_MS[idx]!;
		}
	} else if (kind === 'auth') {
		cooldownMs = AUTH_COOLDOWN_MS;
	} else {
		cooldownMs = SERVER_COOLDOWN_MS;
	}
	entry.openUntil = Math.max(entry.openUntil, now + cooldownMs);
	circuitByKey.set(keyId, entry);
	purgeIfOverCapacity(now);
}

/** 请求成功：清零连续失败计数（已过期的 openUntil 一并清理）。 */
export function markProviderKeySuccess(keyId: string, now = Date.now()): void {
	const entry = circuitByKey.get(keyId);
	if (!entry) return;
	if (entry.openUntil <= now) {
		circuitByKey.delete(keyId);
	} else {
		entry.consecutiveRateLimit = 0;
	}
}

/** 熔断剩余毫秒数；未熔断返回 0。 */
export function getProviderKeyCircuitRemainingMs(keyId: string, now = Date.now()): number {
	const entry = circuitByKey.get(keyId);
	if (!entry) return 0;
	return Math.max(0, entry.openUntil - now);
}

export function isProviderKeyCircuitOpen(keyId: string, now = Date.now()): boolean {
	return getProviderKeyCircuitRemainingMs(keyId, now) > 0;
}

/** 测试用：清空熔断状态。 */
export function resetProviderKeyCircuitStateForTests(): void {
	circuitByKey.clear();
}
