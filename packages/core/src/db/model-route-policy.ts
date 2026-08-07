/**
 * `models.route_policy` JSON 解析：同层路由策略（可覆盖全局 ROUTE_STRATEGY）。
 *
 * 结构：
 * ```json
 * {
 *   "strategy": "hash_affinity",
 *   "rules": {
 *     "openai:default": { "strategy": "hash_affinity" },
 *     "openai.chat:default": { "strategy": "weight_priority" }
 *   }
 * }
 * ```
 * - rules 键：`{protocol}.{capability}:{route_group}` 或协议级 `{protocol}:{route_group}`
 * - 解析键时用 `lastIndexOf(':')`；protocol / capability / route_group 均规范化为小写
 * - capability 必须属于对应协议（见 `provider-endpoints` 白名单）
 */

import type { RouteStrategyName } from '../types';
import {
	ANTHROPIC_ENDPOINT_CAPABILITIES,
	DASHSCOPE_ENDPOINT_CAPABILITIES,
	GEMINI_ENDPOINT_CAPABILITIES,
	GEMINI_LEGACY_ENDPOINT_CAPABILITIES,
	OPENAI_ENDPOINT_CAPABILITIES,
	type ProviderEndpointCapability,
} from '../provider-endpoints';
import {
	canonicalizeRequestOperation,
	requestOperationAliasRank,
} from '../route-topology';
import { UPSTREAM_PROTOCOLS, type UpstreamProtocol } from '../upstream-protocol';

export const ROUTE_STRATEGY_NAMES = [
	'hash_affinity',
	'weighted_random',
	'weight_priority',
	'weighted_round_robin',
] as const satisfies readonly RouteStrategyName[];

export const DEFAULT_ROUTE_STRATEGY: RouteStrategyName = 'hash_affinity';

const CAPABILITIES_BY_PROTOCOL: Record<UpstreamProtocol, readonly ProviderEndpointCapability[]> = {
	openai: OPENAI_ENDPOINT_CAPABILITIES,
	anthropic: ANTHROPIC_ENDPOINT_CAPABILITIES,
	gemini: [...GEMINI_ENDPOINT_CAPABILITIES, ...GEMINI_LEGACY_ENDPOINT_CAPABILITIES],
	dashscope: DASHSCOPE_ENDPOINT_CAPABILITIES,
};

export function isRouteStrategyName(s: string): s is RouteStrategyName {
	return (ROUTE_STRATEGY_NAMES as readonly string[]).includes(s);
}

function isUpstreamProtocol(s: string): s is UpstreamProtocol {
	return (UPSTREAM_PROTOCOLS as readonly string[]).includes(s);
}

/** 大小写不敏感匹配白名单，返回规范 capability；非法则 null。 */
function canonicalizeCapability(
	protocol: UpstreamProtocol,
	capability: string
): ProviderEndpointCapability | null {
	const trimmed = capability.trim();
	if (!trimmed) return null;
	const family = canonicalizeRequestOperation(protocol, trimmed);
	const lower = family.toLowerCase();
	for (const c of CAPABILITIES_BY_PROTOCOL[protocol]) {
		if (c.toLowerCase() === lower) {
			// Prefer canonical family for gemini legacy keys.
			if (protocol === 'gemini') {
				return canonicalizeRequestOperation('gemini', c) as ProviderEndpointCapability;
			}
			return c;
		}
	}
	// Also accept case-insensitive match against legacy gemini keys after family map.
	for (const c of CAPABILITIES_BY_PROTOCOL[protocol]) {
		if (c.toLowerCase() === trimmed.toLowerCase()) {
			return canonicalizeRequestOperation(protocol, c) as ProviderEndpointCapability;
		}
	}
	return null;
}

/**
 * 构造 rules 键。
 * - capability 非空：`{protocol}.{capability}:{route_group}`（capability 小写，便于大小写不敏感匹配）
 * - capability 为空：`{protocol}:{route_group}`
 */
export function routePolicyRuleKey(
	protocol: string,
	capability: string | null | undefined,
	routeGroup: string
): string {
	const p = protocol.trim().toLowerCase();
	const g = routeGroup.trim().toLowerCase();
	const cap = capability?.trim().toLowerCase() ?? '';
	if (cap) return `${p}.${cap}:${g}`;
	return `${p}:${g}`;
}

/** 解析后的单条 rule。 */
export interface ModelRoutePolicyRule {
	strategy: RouteStrategyName;
}

/** 解析后的完整 route_policy。 */
export interface ModelRoutePolicy {
	/** 顶层缺省策略；未配置则为 null */
	strategy: RouteStrategyName | null;
	/** 规范化 key → rule */
	rules: Map<string, ModelRoutePolicyRule>;
}

type ParsedRuleKey =
	| {
			ok: true;
			key: string;
			protocol: UpstreamProtocol;
			capability: string | null;
			/** Original capability segment before family canonicalization (for alias rank). */
			rawCapability: string | null;
			routeGroup: string;
	  }
	| { ok: false; reason: string };

/**
 * 用 lastIndexOf(':') 拆分 rules 键，并校验 protocol / capability。
 */
function parseRuleKey(rawKey: string): ParsedRuleKey {
	const trimmed = rawKey.trim();
	const colon = trimmed.lastIndexOf(':');
	if (colon <= 0 || colon >= trimmed.length - 1) {
		return { ok: false, reason: `key "${rawKey}" must be "{protocol}:{route_group}" or "{protocol}.{capability}:{route_group}"` };
	}
	const left = trimmed.slice(0, colon).trim().toLowerCase();
	const routeGroup = trimmed.slice(colon + 1).trim().toLowerCase();
	if (!left || !routeGroup) {
		return { ok: false, reason: `key "${rawKey}" has empty protocol or route_group` };
	}

	const dot = left.indexOf('.');
	if (dot < 0) {
		if (!isUpstreamProtocol(left)) {
			return { ok: false, reason: `protocol "${left}" must be one of ${UPSTREAM_PROTOCOLS.join(', ')}` };
		}
		return {
			ok: true,
			key: routePolicyRuleKey(left, null, routeGroup),
			protocol: left,
			capability: null,
			rawCapability: null,
			routeGroup,
		};
	}

	const protocol = left.slice(0, dot);
	const rawCapability = left.slice(dot + 1);
	if (!isUpstreamProtocol(protocol)) {
		return { ok: false, reason: `protocol "${protocol}" must be one of ${UPSTREAM_PROTOCOLS.join(', ')}` };
	}
	const capability = canonicalizeCapability(protocol, rawCapability);
	if (!rawCapability || !capability) {
		return {
			ok: false,
			reason: `capability "${rawCapability}" is not valid for protocol "${protocol}"`,
		};
	}
	return {
		ok: true,
		key: routePolicyRuleKey(protocol, capability, routeGroup),
		protocol,
		capability,
		routeGroup,
		rawCapability,
	};
}

function parseStrategyValue(raw: unknown): RouteStrategyName | null {
	if (typeof raw !== 'string') return null;
	const s = raw.trim().toLowerCase();
	return isRouteStrategyName(s) ? s : null;
}

/**
 * 解析 route_policy JSON；非法 JSON / 非对象 / 无有效 strategy 且无合法 rules 时返回 null。
 */
export function parseModelRoutePolicy(raw: string | null | undefined): ModelRoutePolicy | null {
	if (!raw || typeof raw !== 'string') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const obj = parsed as Record<string, unknown>;

	const topStrategy = parseStrategyValue(obj.strategy);
	const rules = new Map<string, ModelRoutePolicyRule>();
	const ranks = new Map<string, number>();
	const rulesRaw = obj.rules;
	if (rulesRaw && typeof rulesRaw === 'object' && !Array.isArray(rulesRaw)) {
		for (const [key, value] of Object.entries(rulesRaw as Record<string, unknown>)) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			const parsedKey = parseRuleKey(key);
			if (!parsedKey.ok) continue;
			const strategy = parseStrategyValue((value as Record<string, unknown>).strategy);
			if (!strategy) continue;
			const rank = requestOperationAliasRank(parsedKey.rawCapability ?? '');
			const prevRank = ranks.get(parsedKey.key);
			if (prevRank !== undefined && prevRank >= rank) continue;
			ranks.set(parsedKey.key, rank);
			rules.set(parsedKey.key, { strategy });
		}
	}

	if (topStrategy == null && rules.size === 0) return null;
	return { strategy: topStrategy, rules };
}

/**
 * 在模型级解析生效策略（不含全局 system_config）。
 * 顺序：capability×group → protocol×group → 顶层 strategy；皆无则 null。
 */
export function resolveModelRoutePolicyStrategy(
	raw: string | null | undefined,
	protocol: string,
	capability: string | null | undefined,
	routeGroup: string
): RouteStrategyName | null {
	const config = parseModelRoutePolicy(raw);
	if (!config) return null;

	const trimmed = capability?.trim() ? capability.trim() : null;
	const cap =
		trimmed && isUpstreamProtocol(protocol)
			? (canonicalizeCapability(protocol, trimmed) ?? trimmed)
			: trimmed;
	if (cap) {
		const exact = config.rules.get(routePolicyRuleKey(protocol, cap, routeGroup));
		if (exact) return exact.strategy;
	}
	const proto = config.rules.get(routePolicyRuleKey(protocol, null, routeGroup));
	if (proto) return proto.strategy;
	return config.strategy;
}

/**
 * Admin 保存前校验：null/空串合法（清空=回退全局）；否则须为合法 JSON 对象，
 * 且至少有顶层 strategy 或一条合法 rule。
 * @returns 规范化后的 JSON 字符串或 null（清空）；非法时抛 Error
 */
export function normalizeModelRoutePolicyInput(raw: string | null | undefined): string | null {
	if (raw == null || raw.trim() === '') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('route_policy must be valid JSON');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('route_policy must be a JSON object');
	}
	const obj = parsed as Record<string, unknown>;

	let topStrategy: RouteStrategyName | null = null;
	if (obj.strategy !== undefined && obj.strategy !== null && obj.strategy !== '') {
		topStrategy = parseStrategyValue(obj.strategy);
		if (!topStrategy) {
			throw new Error(
				`route_policy.strategy must be one of ${ROUTE_STRATEGY_NAMES.join(', ')}`
			);
		}
	}

	const outRules: Record<string, { strategy: RouteStrategyName }> = {};
	const ranks = new Map<string, number>();
	const rulesRaw = obj.rules;
	if (rulesRaw !== undefined && rulesRaw !== null) {
		if (typeof rulesRaw !== 'object' || Array.isArray(rulesRaw)) {
			throw new Error(
				'route_policy.rules must be an object keyed by "{protocol}:{route_group}" or "{protocol}.{capability}:{route_group}"'
			);
		}
		for (const [key, value] of Object.entries(rulesRaw as Record<string, unknown>)) {
			const parsedKey = parseRuleKey(key);
			if (!parsedKey.ok) {
				throw new Error(`route_policy.rules ${parsedKey.reason}`);
			}
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				throw new Error(`route_policy.rules["${key}"] must be an object`);
			}
			const strategy = parseStrategyValue((value as Record<string, unknown>).strategy);
			if (!strategy) {
				throw new Error(
					`route_policy.rules["${key}"].strategy must be one of ${ROUTE_STRATEGY_NAMES.join(', ')}`
				);
			}
			const rank = requestOperationAliasRank(parsedKey.rawCapability ?? '');
			const prevRank = ranks.get(parsedKey.key);
			if (prevRank !== undefined && prevRank >= rank) continue;
			ranks.set(parsedKey.key, rank);
			outRules[parsedKey.key] = { strategy };
		}
	}

	if (topStrategy == null && Object.keys(outRules).length === 0) {
		throw new Error('route_policy must include top-level strategy and/or at least one rule');
	}

	const out: Record<string, unknown> = {};
	if (topStrategy != null) out.strategy = topStrategy;
	if (Object.keys(outRules).length > 0) out.rules = outRules;
	return JSON.stringify(out);
}
