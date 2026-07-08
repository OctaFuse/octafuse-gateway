/**
 * Provider key 熔断：替代原固定 60s cooldown（`provider-key-scheduler` 已迁移至此）。
 *
 * 按失败类别区分冷却策略：
 * - `rate_limit`（上游 429）：优先用上游 `Retry-After`（封顶 15min）；无头时按冷却周期递增退避
 *   （5s → 15s → 30s → 60s 封顶）；同一限流回合内熔断已打开时不再累加计数；一次成功即清零。
 * - `auth`（401/403）：10min（key 大概率失效，等待人工处理；配合告警日志）。
 * - `server`（普通 5xx）：连续 3 次失败后短熔断 10s；524 / fetch 不写入此类熔断。
 *
 * 熔断中的 key 一律跳过（不再有「全部冷却则回退全试」）；全部不可用时由 dispatch 层返回 429 + Retry-After。
 * 状态为单实例进程内存。
 */

export type ProviderKeyFailureKind = 'rate_limit' | 'auth' | 'server';

export type ProviderKeyCircuitFailureResult = {
	failureKind: ProviderKeyFailureKind;
	openUntil: number;
	cooldownMs: number;
	/** 本次失败是否打开或延长了熔断窗口 */
	openedOrExtended: boolean;
};

const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;
const RATE_LIMIT_RETRY_AFTER_CAP_MS = 900_000;
const AUTH_COOLDOWN_MS = 600_000;
const SERVER_FAILURE_THRESHOLD = 3;
const SERVER_COOLDOWN_MS = 10_000;
const MAX_ENTRIES = 10_000;

type CircuitEntry = {
	openUntil: number;
	consecutiveRateLimit: number;
	consecutiveServerFailures: number;
};

const circuitByKey = new Map<string, CircuitEntry>();

function purgeIfOverCapacity(now: number): void {
	if (circuitByKey.size <= MAX_ENTRIES) return;
	for (const [keyId, entry] of circuitByKey) {
		if (entry.openUntil <= now && entry.consecutiveRateLimit === 0 && entry.consecutiveServerFailures === 0) {
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
): ProviderKeyCircuitFailureResult {
	const entry = circuitByKey.get(keyId) ?? { openUntil: 0, consecutiveRateLimit: 0, consecutiveServerFailures: 0 };
	const previousOpenUntil = entry.openUntil;
	let appliedCooldownMs = 0;

	if (kind === 'rate_limit') {
		let cooldownMs: number;
		if (retryAfterMs != null && retryAfterMs > 0) {
			cooldownMs = Math.min(retryAfterMs, RATE_LIMIT_RETRY_AFTER_CAP_MS);
		} else {
			// 熔断已打开 = 同一限流回合的并发/连续 429，不重复升级
			if (entry.openUntil <= now) {
				entry.consecutiveRateLimit += 1;
			}
			const idx = Math.min(entry.consecutiveRateLimit - 1, RATE_LIMIT_BACKOFF_MS.length - 1);
			cooldownMs = RATE_LIMIT_BACKOFF_MS[idx]!;
		}
		appliedCooldownMs = cooldownMs;
		entry.openUntil = Math.max(entry.openUntil, now + cooldownMs);
	} else if (kind === 'auth') {
		appliedCooldownMs = AUTH_COOLDOWN_MS;
		entry.openUntil = Math.max(entry.openUntil, now + AUTH_COOLDOWN_MS);
	} else {
		const wasOpen = entry.openUntil > now;
		if (!wasOpen && entry.consecutiveServerFailures >= SERVER_FAILURE_THRESHOLD) {
			entry.consecutiveServerFailures = 0;
		}
		if (entry.openUntil <= now) {
			entry.consecutiveServerFailures += 1;
		}
		if (entry.consecutiveServerFailures >= SERVER_FAILURE_THRESHOLD) {
			appliedCooldownMs = SERVER_COOLDOWN_MS;
			entry.openUntil = Math.max(entry.openUntil, now + SERVER_COOLDOWN_MS);
		}
	}
	circuitByKey.set(keyId, entry);
	purgeIfOverCapacity(now);

	const openedOrExtended = entry.openUntil > Math.max(previousOpenUntil, now);
	const cooldownMs =
		entry.openUntil > now ? Math.max(0, entry.openUntil - now) : appliedCooldownMs;

	return {
		failureKind: kind,
		openUntil: entry.openUntil,
		cooldownMs,
		openedOrExtended,
	};
}

/** 请求成功：清零连续失败计数（已过期的 openUntil 一并清理）。 */
export function markProviderKeySuccess(keyId: string, now = Date.now()): void {
	const entry = circuitByKey.get(keyId);
	if (!entry) return;
	if (entry.openUntil <= now) {
		circuitByKey.delete(keyId);
	} else {
		entry.consecutiveRateLimit = 0;
		entry.consecutiveServerFailures = 0;
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
