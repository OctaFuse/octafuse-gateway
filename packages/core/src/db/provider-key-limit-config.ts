/**
 * `provider_api_keys.limit_config` JSON 解析：per-key 限流配置。
 * 形如 `{ "rpm": 500, "tpm": 200000, "max_concurrency": 32 }`；字段均可选，缺省=该维度不限。
 * 未知字段忽略（向前兼容）；非法 JSON / 无有效字段视为不限流（返回 null）。
 */

export interface ProviderKeyLimitConfig {
	/** 每分钟请求数上限；null=不限 */
	rpm: number | null;
	/** 每分钟 token 数上限（响应结束后滞后计数）；null=不限 */
	tpm: number | null;
	/** 同时 in-flight 请求数上限；null=不限 */
	maxConcurrency: number | null;
}

function asPositiveInt(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	const n = Math.floor(value);
	return n > 0 ? n : null;
}

/**
 * 解析 limit_config JSON。
 * @returns 至少一个维度有效时返回配置；否则 null（等价不限流）
 */
export function parseProviderKeyLimitConfig(raw: string | null | undefined): ProviderKeyLimitConfig | null {
	if (!raw || typeof raw !== 'string') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const obj = parsed as Record<string, unknown>;
	const rpm = asPositiveInt(obj.rpm);
	const tpm = asPositiveInt(obj.tpm);
	const maxConcurrency = asPositiveInt(obj.max_concurrency);
	if (rpm == null && tpm == null && maxConcurrency == null) return null;
	return { rpm, tpm, maxConcurrency };
}

/**
 * Admin 保存前校验：null/空串合法（清空配置）；否则须为 JSON 对象且至少一个有效维度。
 * @returns 规范化后的 JSON 字符串（仅保留已知字段）或 null（清空）；非法时抛 Error
 */
export function normalizeProviderKeyLimitConfigInput(raw: string | null | undefined): string | null {
	if (raw == null || raw.trim() === '') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('limit_config must be valid JSON');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('limit_config must be a JSON object');
	}
	const obj = parsed as Record<string, unknown>;
	const out: Record<string, number> = {};
	const rpm = asPositiveInt(obj.rpm);
	const tpm = asPositiveInt(obj.tpm);
	const maxConcurrency = asPositiveInt(obj.max_concurrency);
	if (rpm != null) out.rpm = rpm;
	if (tpm != null) out.tpm = tpm;
	if (maxConcurrency != null) out.max_concurrency = maxConcurrency;
	if (Object.keys(out).length === 0) {
		throw new Error('limit_config must contain at least one of: rpm, tpm, max_concurrency (positive integers)');
	}
	return JSON.stringify(out);
}
