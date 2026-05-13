/**
 * API 时间格式统一：
 * - 存储层允许 SQLite `datetime('now')` 形态（`YYYY-MM-DD HH:mm:ss`）
 * - PostgreSQL / 驱动常返回带偏移或 `T` 分隔的字符串
 * - 对外接口统一输出 ISO 8601 UTC（带 `Z`）
 */
const SQLITE_UTC_SECONDS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const API_TIME_KEYS = new Set([
	'created_at',
	'updated_at',
	'budget_reset_at',
	'before_budget_reset_at',
	'after_budget_reset_at',
	'last_active_at',
]);

/**
 * 将各类时间字符串规范为 UTC ISO 字符串；无法解析时原样返回。
 */
export function normalizeApiTimeString(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return value;
	}

	// D1 / SQLite：无小数、无时区，按历史约定视为 UTC
	if (SQLITE_UTC_SECONDS_RE.test(trimmed)) {
		return `${trimmed.replace(' ', 'T')}.000Z`;
	}

	// PostgreSQL 等：空格日期 + 偏移 / Z / 小数秒等，交给 Date 再统一为 Z
	const forParse = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
	const d = new Date(forParse);
	if (!Number.isNaN(d.getTime())) {
		return d.toISOString();
	}

	return value;
}

/** @deprecated 使用 {@link normalizeApiTimeString} */
export function toIsoUtcIfSqliteDateTime(value: string): string {
	return normalizeApiTimeString(value);
}

/**
 * 深度遍历 API payload，并对约定时间字段执行格式归一化。
 * 不改动业务含义，仅统一输出格式。
 */
export function normalizeApiTimeFields<T>(payload: T): T {
	if (payload instanceof Date) {
		const t = payload.getTime();
		return (Number.isNaN(t) ? payload : payload.toISOString()) as unknown as T;
	}
	if (Array.isArray(payload)) {
		return payload.map((item) => normalizeApiTimeFields(item)) as T;
	}
	if (payload == null || typeof payload !== 'object') {
		return payload;
	}

	const source = payload as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, rawValue] of Object.entries(source)) {
		if (API_TIME_KEYS.has(key)) {
			if (rawValue instanceof Date) {
				const t = rawValue.getTime();
				out[key] = Number.isNaN(t) ? rawValue : rawValue.toISOString();
				continue;
			}
			if (typeof rawValue === 'string') {
				out[key] = normalizeApiTimeString(rawValue);
				continue;
			}
		}
		out[key] = normalizeApiTimeFields(rawValue);
	}
	return out as T;
}
