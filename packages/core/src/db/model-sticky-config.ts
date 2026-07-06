/**
 * `models.sticky_config` JSON 解析：粘性 key 路由规则（opt-in）。
 *
 * 结构：
 * ```json
 * {
 *   "ttl_seconds": 600,
 *   "short_wait_ms": 3000,
 *   "rules": {
 *     "openai:default": { "enabled": true },
 *     "openai:free":    { "enabled": true, "ttl_seconds": 300 }
 *   }
 * }
 * ```
 * - `rules` 键为 `"{upstream_protocol}:{route_group}"`（协议与 route_group 均规范化为小写后匹配，输入大小写不敏感）。
 * - 列为 NULL、`rules` 无对应条目、或条目 `enabled=false` ⇒ 该「协议 × 分组」无粘性。
 * - 顶层 `ttl_seconds` / `short_wait_ms` 为各 rule 的缺省；再缺省用代码常量。
 */

export const STICKY_DEFAULT_TTL_SECONDS = 600;
export const STICKY_DEFAULT_SHORT_WAIT_MS = 3000;

/** 单个「协议 × 分组」生效的粘性规则（已合并缺省）。 */
export interface StickyRouteRule {
	ttlSeconds: number;
	shortWaitMs: number;
}

/** 解析后的完整 sticky_config。 */
export interface ModelStickyConfig {
	ttlSeconds: number;
	shortWaitMs: number;
	/** 规范化 key：`${protocol.toLowerCase()}:${routeGroup.toLowerCase()}` */
	rules: Map<string, { enabled: boolean; ttlSeconds: number | null; shortWaitMs: number | null }>;
}

function asPositiveInt(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	const n = Math.floor(value);
	return n > 0 ? n : null;
}

export function stickyRuleKey(protocol: string, routeGroup: string): string {
	return `${protocol.trim().toLowerCase()}:${routeGroup.trim().toLowerCase()}`;
}

/**
 * 解析 sticky_config JSON；非法 JSON 或无 rules 时返回 null（等价无粘性）。
 */
export function parseModelStickyConfig(raw: string | null | undefined): ModelStickyConfig | null {
	if (!raw || typeof raw !== 'string') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const obj = parsed as Record<string, unknown>;
	const rulesRaw = obj.rules;
	if (!rulesRaw || typeof rulesRaw !== 'object' || Array.isArray(rulesRaw)) return null;

	const rules = new Map<string, { enabled: boolean; ttlSeconds: number | null; shortWaitMs: number | null }>();
	for (const [key, value] of Object.entries(rulesRaw as Record<string, unknown>)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const rule = value as Record<string, unknown>;
		const idx = key.indexOf(':');
		if (idx <= 0 || idx >= key.length - 1) continue;
		const normalized = stickyRuleKey(key.slice(0, idx), key.slice(idx + 1));
		rules.set(normalized, {
			enabled: rule.enabled !== false,
			ttlSeconds: asPositiveInt(rule.ttl_seconds),
			shortWaitMs: asPositiveInt(rule.short_wait_ms),
		});
	}
	if (rules.size === 0) return null;

	return {
		ttlSeconds: asPositiveInt(obj.ttl_seconds) ?? STICKY_DEFAULT_TTL_SECONDS,
		shortWaitMs: asPositiveInt(obj.short_wait_ms) ?? STICKY_DEFAULT_SHORT_WAIT_MS,
		rules,
	};
}

/**
 * 解析某「协议 × 分组」的生效粘性规则。
 * @returns 未配置或 `enabled=false` 时 null（无粘性）
 */
export function resolveStickyRouteRule(
	rawStickyConfig: string | null | undefined,
	protocol: string,
	routeGroup: string
): StickyRouteRule | null {
	const config = parseModelStickyConfig(rawStickyConfig);
	if (!config) return null;
	const rule = config.rules.get(stickyRuleKey(protocol, routeGroup));
	if (!rule || !rule.enabled) return null;
	return {
		ttlSeconds: rule.ttlSeconds ?? config.ttlSeconds,
		shortWaitMs: rule.shortWaitMs ?? config.shortWaitMs,
	};
}

/**
 * Admin 保存前校验：null/空串合法（清空配置=全关）；否则须为含至少一条合法 rule 的 JSON。
 * @returns 规范化后的 JSON 字符串或 null（清空）；非法时抛 Error
 */
export function normalizeModelStickyConfigInput(raw: string | null | undefined): string | null {
	if (raw == null || raw.trim() === '') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('sticky_config must be valid JSON');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('sticky_config must be a JSON object');
	}
	const obj = parsed as Record<string, unknown>;
	const rulesRaw = obj.rules;
	if (!rulesRaw || typeof rulesRaw !== 'object' || Array.isArray(rulesRaw)) {
		throw new Error('sticky_config.rules must be an object keyed by "{protocol}:{route_group}"');
	}
	const outRules: Record<string, Record<string, unknown>> = {};
	for (const [key, value] of Object.entries(rulesRaw as Record<string, unknown>)) {
		const idx = key.indexOf(':');
		if (idx <= 0 || idx >= key.length - 1) {
			throw new Error(`sticky_config.rules key "${key}" must be "{protocol}:{route_group}"`);
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error(`sticky_config.rules["${key}"] must be an object`);
		}
		const rule = value as Record<string, unknown>;
		const outRule: Record<string, unknown> = { enabled: rule.enabled !== false };
		const ttl = asPositiveInt(rule.ttl_seconds);
		const wait = asPositiveInt(rule.short_wait_ms);
		if (ttl != null) outRule.ttl_seconds = ttl;
		if (wait != null) outRule.short_wait_ms = wait;
		outRules[stickyRuleKey(key.slice(0, idx), key.slice(idx + 1))] = outRule;
	}
	if (Object.keys(outRules).length === 0) {
		throw new Error('sticky_config.rules must contain at least one rule');
	}
	const out: Record<string, unknown> = { rules: outRules };
	const ttl = asPositiveInt(obj.ttl_seconds);
	const wait = asPositiveInt(obj.short_wait_ms);
	if (ttl != null) out.ttl_seconds = ttl;
	if (wait != null) out.short_wait_ms = wait;
	return JSON.stringify(out);
}
