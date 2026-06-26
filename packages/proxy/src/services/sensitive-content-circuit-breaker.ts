/**
 * 敏感内容熔断：按 userId + baseModelId 在进程内缓存 3 分钟，短路重复请求避免连续打上游。
 */
import { formatHttpErrorTextForRequestLog } from './request-log-record-status';
import { isSensitiveContentErrorMessage } from './sensitive-content-detector';

export const SENSITIVE_CONTENT_CIRCUIT_BREAKER_ENABLED = true;
export const SENSITIVE_CONTENT_CIRCUIT_BREAKER_MS = 180_000;
const MAX_CIRCUIT_ENTRIES = 10_000;

export type SensitiveContentCircuitOpenInfo = {
	blockedUntil: number;
	retryAfterSeconds: number;
};

type CircuitEntry = {
	blockedUntil: number;
	lastErrorMessage?: string;
};

const circuitUntilByKey = new Map<string, CircuitEntry>();

function circuitKey(userId: string, modelId: string): string {
	return `${userId}\x1f${modelId}`;
}

function purgeExpiredEntries(now: number): void {
	for (const [key, entry] of circuitUntilByKey) {
		if (entry.blockedUntil <= now) {
			circuitUntilByKey.delete(key);
		}
	}
}

function maybePurgeIfOverCapacity(now: number): void {
	if (circuitUntilByKey.size <= MAX_CIRCUIT_ENTRIES) {
		return;
	}
	purgeExpiredEntries(now);
}

export function getSensitiveContentCircuitOpen(
	userId: string,
	modelId: string,
	now = Date.now()
): SensitiveContentCircuitOpenInfo | null {
	if (!SENSITIVE_CONTENT_CIRCUIT_BREAKER_ENABLED) {
		return null;
	}
	const key = circuitKey(userId, modelId);
	const entry = circuitUntilByKey.get(key);
	if (!entry) {
		return null;
	}
	if (entry.blockedUntil <= now) {
		circuitUntilByKey.delete(key);
		return null;
	}
	const retryAfterSeconds = Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
	return {
		blockedUntil: entry.blockedUntil,
		retryAfterSeconds,
	};
}

export function recordSensitiveContentCircuitTrigger(
	userId: string,
	modelId: string,
	lastErrorMessage?: string,
	cooldownMs = SENSITIVE_CONTENT_CIRCUIT_BREAKER_MS,
	now = Date.now()
): SensitiveContentCircuitOpenInfo {
	const blockedUntil = now + cooldownMs;
	const key = circuitKey(userId, modelId);
	circuitUntilByKey.set(key, {
		blockedUntil,
		lastErrorMessage,
	});
	maybePurgeIfOverCapacity(now);
	const retryAfterSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
	return { blockedUntil, retryAfterSeconds };
}

export function isSensitiveUpstreamResponse(
	status: number,
	contentType: string | null,
	bodyText: string
): boolean {
	const formatted = formatHttpErrorTextForRequestLog(status, contentType, bodyText);
	return isSensitiveContentErrorMessage(formatted) || isSensitiveContentErrorMessage(bodyText);
}

export function formatSensitiveContentCircuitOpenErrorMessage(info: SensitiveContentCircuitOpenInfo): string {
	const blockedUntilIso = new Date(info.blockedUntil).toISOString();
	return `Sensitive content circuit open; retry after ${info.retryAfterSeconds}s (blocked until ${blockedUntilIso})`;
}

export function buildSensitiveContentCircuitOpenResponse(info: SensitiveContentCircuitOpenInfo): Response {
	const blockedUntilIso = new Date(info.blockedUntil).toISOString();
	const body = {
		error: {
			message: `Sensitive content was blocked upstream. Please retry this user/model after ${info.retryAfterSeconds} seconds.`,
			type: 'sensitive_content_circuit_open',
			code: 'sensitive_content_circuit_open',
			retry_after_seconds: info.retryAfterSeconds,
			blocked_until: blockedUntilIso,
		},
	};
	return new Response(JSON.stringify(body), {
		status: 429,
		headers: {
			'Content-Type': 'application/json',
			'Retry-After': String(info.retryAfterSeconds),
		},
	});
}

/** 测试用：清空熔断状态。 */
export function resetSensitiveContentCircuitStateForTests(): void {
	circuitUntilByKey.clear();
}
