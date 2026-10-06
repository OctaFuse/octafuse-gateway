/**
 * 用户级 Charged cost factor：`users.charged_cost_factors` JSON。
 * 值为数字时覆盖该模型全部分组；值为对象时按 route group 精确匹配，`"*"` 为未命中分组的兜底。
 * 与路由 Charged 有效倍率按全局 mode 合成后作用到官方当刻价。未命中不改金额。
 */
import { roundGatewayMoney } from '../lib/money-precision';
import {
	DEFAULT_USER_CHARGED_COST_FACTOR_MODE,
	type UserChargedCostFactorMode,
} from '../lib/user-charged-cost-factor-mode';

/** 分组对象里表示「该模型其余分组」的键。 */
export const USER_CHARGED_FACTOR_ANY_GROUP = '*';

/** 请求未带 `model:group` 时的计费分组，与选路一致。 */
export const DEFAULT_USER_CHARGED_FACTOR_ROUTE_GROUP = 'default';

/** 数字 = 全部分组；对象 = 分组名（小写）或 `*` → 倍率。 */
export type UserChargedCostFactorValue = number | Record<string, number>;

export type UserChargedCostFactors = Record<string, UserChargedCostFactorValue>;

export type UserChargedCostFactorMatch = {
	factor: number;
	/**
	 * 命中的分组键。模型级数字（全部分组）或未命中为 `null`；
	 * 分组对象命中具体分组时为该分组名，命中兜底时为 `*`。
	 */
	routeGroup: string | null;
};

export type ApplyUserChargedCostFactorOptions = {
	mode?: UserChargedCostFactorMode;
	routeEffectiveFactor?: number;
};

export type NormalizeUserChargedCostFactorsResult =
	| { ok: true; value: UserChargedCostFactors | null; json: string | null }
	| { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRouteEffectiveFactor(raw: number | undefined): number {
	return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 1;
}

function parseNonNegativeFactor(raw: unknown): number | null {
	const n = typeof raw === 'number' ? raw : Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 与选路相同：trim 后小写比较；`*` 保留为通配键。 */
export function canonicalUserChargedFactorGroup(raw: string): string {
	const key = raw.trim();
	if (key === USER_CHARGED_FACTOR_ANY_GROUP) return USER_CHARGED_FACTOR_ANY_GROUP;
	return key.toLowerCase();
}

function requestedRouteGroup(routeGroup: string | null | undefined): string {
	const group = routeGroup?.trim();
	return group ? group.toLowerCase() : DEFAULT_USER_CHARGED_FACTOR_ROUTE_GROUP;
}

type NormalizeGroupMapResult =
	| { ok: true; value: UserChargedCostFactorValue | null }
	| { ok: false; message: string };

/** 空对象丢弃；仅 `*` 时折叠成数字；分组键 trim 后小写，大小写重复则拒绝。 */
function normalizeGroupFactorMap(modelId: string, raw: Record<string, unknown>): NormalizeGroupMapResult {
	const groups: Record<string, number> = {};
	for (const [rawKey, rawVal] of Object.entries(raw)) {
		const key = rawKey.trim();
		if (!key) {
			return { ok: false, message: `charged_cost_factors["${modelId}"] keys must be non-empty route groups` };
		}
		const canonical = canonicalUserChargedFactorGroup(key);
		if (Object.prototype.hasOwnProperty.call(groups, canonical)) {
			return {
				ok: false,
				message: `charged_cost_factors["${modelId}"] has duplicate route group "${canonical}"`,
			};
		}
		const n = parseNonNegativeFactor(rawVal);
		if (n == null) {
			return {
				ok: false,
				message: `charged_cost_factors["${modelId}"]["${canonical}"] must be a finite number >= 0`,
			};
		}
		groups[canonical] = n;
	}
	const keys = Object.keys(groups);
	if (keys.length === 0) return { ok: true, value: null };
	if (keys.length === 1 && keys[0] === USER_CHARGED_FACTOR_ANY_GROUP) {
		return { ok: true, value: groups[USER_CHARGED_FACTOR_ANY_GROUP]! };
	}
	return { ok: true, value: groups };
}

/** 运行时容错：非法分组项丢弃；仅 `*` 时折叠成数字。 */
function parseGroupFactorMap(raw: Record<string, unknown>): UserChargedCostFactorValue | null {
	const groups: Record<string, number> = {};
	for (const [rawKey, rawVal] of Object.entries(raw)) {
		const key = rawKey.trim();
		if (!key) continue;
		const canonical = canonicalUserChargedFactorGroup(key);
		if (Object.prototype.hasOwnProperty.call(groups, canonical)) continue;
		const n = parseNonNegativeFactor(rawVal);
		if (n == null) continue;
		groups[canonical] = n;
	}
	const keys = Object.keys(groups);
	if (keys.length === 0) return null;
	if (keys.length === 1 && keys[0] === USER_CHARGED_FACTOR_ANY_GROUP) {
		return groups[USER_CHARGED_FACTOR_ANY_GROUP]!;
	}
	return groups;
}

/**
 * 写入校验：对象（非数组）；模型键非空；倍率有限且 ≥ 0。
 * 值可以是数字（全部分组）或 `{ "<route_group>" | "*": number }`。
 * `null` / `{}` 落库为 NULL。仅含 `*` 的对象折叠成数字。
 */
export function normalizeUserChargedCostFactorsInput(input: unknown): NormalizeUserChargedCostFactorsResult {
	if (input === undefined) {
		return { ok: false, message: 'charged_cost_factors is required when provided' };
	}
	if (input === null) {
		return { ok: true, value: null, json: null };
	}
	let obj: Record<string, unknown>;
	if (typeof input === 'string') {
		const trimmed = input.trim();
		if (trimmed === '' || trimmed === 'null') {
			return { ok: true, value: null, json: null };
		}
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (!isPlainObject(parsed)) {
				return { ok: false, message: 'charged_cost_factors must be a JSON object' };
			}
			obj = parsed;
		} catch {
			return { ok: false, message: 'charged_cost_factors must be valid JSON' };
		}
	} else if (isPlainObject(input)) {
		obj = input;
	} else {
		return { ok: false, message: 'charged_cost_factors must be a JSON object or null' };
	}

	const out: UserChargedCostFactors = {};
	for (const [rawKey, rawVal] of Object.entries(obj)) {
		const key = rawKey.trim();
		if (!key) {
			return { ok: false, message: 'charged_cost_factors keys must be non-empty model ids' };
		}
		if (isPlainObject(rawVal)) {
			const groups = normalizeGroupFactorMap(key, rawVal);
			if (!groups.ok) return groups;
			if (groups.value != null) out[key] = groups.value;
			continue;
		}
		const n = parseNonNegativeFactor(rawVal);
		if (n == null) {
			return { ok: false, message: `charged_cost_factors["${key}"] must be a finite number >= 0` };
		}
		out[key] = n;
	}
	if (Object.keys(out).length === 0) {
		return { ok: true, value: null, json: null };
	}
	return { ok: true, value: out, json: JSON.stringify(out) };
}

/**
 * 运行时解析：损坏或非法时返回 null（视为无折扣），不抛错。
 */
export function parseUserChargedCostFactors(json: string | null | undefined): UserChargedCostFactors | null {
	if (json == null || json.trim() === '') {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(json);
		if (!isPlainObject(parsed)) {
			return null;
		}
		const out: UserChargedCostFactors = {};
		for (const [rawKey, rawVal] of Object.entries(parsed)) {
			const key = rawKey.trim();
			if (!key) continue;
			if (isPlainObject(rawVal)) {
				const groups = parseGroupFactorMap(rawVal);
				if (groups != null) out[key] = groups;
				continue;
			}
			const n = parseNonNegativeFactor(rawVal);
			if (n == null) continue;
			out[key] = n;
		}
		return Object.keys(out).length > 0 ? out : null;
	} catch {
		return null;
	}
}

/**
 * 查找顺序：该分组键 → `*` → 模型级数字。未传分组时按 `default`。
 * 模型级数字的 `routeGroup` 为 `null`。
 */
export function resolveUserChargedCostFactorMatch(
	factors: UserChargedCostFactors | null | undefined,
	modelId: string,
	routeGroup?: string | null
): UserChargedCostFactorMatch | null {
	const id = modelId.trim();
	if (!id || !factors) return null;
	const entry = factors[id];
	if (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0) {
		return { factor: entry, routeGroup: null };
	}
	if (!isPlainObject(entry)) return null;
	const group = requestedRouteGroup(routeGroup);
	const specific = entry[group];
	if (typeof specific === 'number' && Number.isFinite(specific) && specific >= 0) {
		return { factor: specific, routeGroup: group };
	}
	const anyGroup = entry[USER_CHARGED_FACTOR_ANY_GROUP];
	if (typeof anyGroup === 'number' && Number.isFinite(anyGroup) && anyGroup >= 0) {
		return { factor: anyGroup, routeGroup: USER_CHARGED_FACTOR_ANY_GROUP };
	}
	return null;
}

export function lookupUserChargedCostFactor(
	factors: UserChargedCostFactors | null | undefined,
	modelId: string,
	routeGroup?: string | null
): number | null {
	return resolveUserChargedCostFactorMatch(factors, modelId, routeGroup)?.factor ?? null;
}

/** 该模型是否配置了任意分组（或全部分组）的用户倍率。 */
export function modelHasUserChargedCostFactor(
	factors: UserChargedCostFactors | null | undefined,
	modelId: string
): boolean {
	const id = modelId.trim();
	if (!id || !factors || !Object.prototype.hasOwnProperty.call(factors, id)) return false;
	const entry = factors[id];
	if (typeof entry === 'number') return Number.isFinite(entry) && entry >= 0;
	if (!isPlainObject(entry)) return false;
	return Object.values(entry).some((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
}

/**
 * 真正落到官方当刻价上的 Charged 倍率。用户未配置该模型时返回 `null`。
 */
export function resolveCombinedChargedFactor(
	routeEffectiveFactor: number,
	userFactor: number | null | undefined,
	mode: UserChargedCostFactorMode = DEFAULT_USER_CHARGED_COST_FACTOR_MODE
): number | null {
	if (userFactor == null) {
		return null;
	}
	const routeEff = normalizeRouteEffectiveFactor(routeEffectiveFactor);
	if (mode === 'min') {
		return Math.min(routeEff, userFactor);
	}
	return routeEff * userFactor;
}

/** 路由 charged 已 round 后，按 mode 与用户倍率合成。 */
export function applyUserChargedCostFactor(
	routeCharged: number,
	factor: number | null | undefined,
	options?: ApplyUserChargedCostFactorOptions
): number {
	const roundedRoute = roundGatewayMoney(routeCharged);
	if (factor == null) {
		return roundedRoute;
	}
	const mode = options?.mode ?? DEFAULT_USER_CHARGED_COST_FACTOR_MODE;
	if (mode === 'min') {
		const routeEff = normalizeRouteEffectiveFactor(options?.routeEffectiveFactor);
		const applied = Math.min(routeEff, factor);
		if (routeEff <= 0) {
			return 0;
		}
		if (applied === routeEff) {
			return roundedRoute;
		}
		return roundGatewayMoney(roundedRoute * (applied / routeEff));
	}
	return roundGatewayMoney(roundedRoute * factor);
}

export type UserChargedFactorAuditFields = {
	userChargedFactor: number | null;
	mode?: UserChargedCostFactorMode;
	combinedChargedFactor?: number | null;
	matchedRouteGroup?: string | null;
};

export function attachUserChargedFactorToPricingAudit(
	pricingAuditJson: string,
	userChargedFactor: number | null,
	extras?: {
		mode?: UserChargedCostFactorMode;
		combinedChargedFactor?: number | null;
		/** 命中的分组键；模型级数字或未命中为 null */
		matchedRouteGroup?: string | null;
	}
): string {
	try {
		const parsed: unknown = JSON.parse(pricingAuditJson);
		if (!isPlainObject(parsed)) {
			return pricingAuditJson;
		}
		parsed.user_charged_factor = userChargedFactor;
		if (extras?.mode) {
			parsed.user_charged_factor_mode = extras.mode;
		}
		if (extras && 'combinedChargedFactor' in extras) {
			parsed.combined_charged_factor = extras.combinedChargedFactor ?? null;
		}
		if (extras && 'matchedRouteGroup' in extras) {
			parsed.user_charged_factor_route_group = extras.matchedRouteGroup ?? null;
		}
		const snapshot = parsed.snapshot;
		if (isPlainObject(snapshot)) {
			const userCharge = snapshot.user_charge;
			if (isPlainObject(userCharge)) {
				userCharge.user_charged_factor = userChargedFactor;
				if (extras?.mode) {
					userCharge.user_charged_factor_mode = extras.mode;
				}
				if (extras && 'combinedChargedFactor' in extras) {
					userCharge.combined_charged_factor = extras.combinedChargedFactor ?? null;
				}
				if (extras && 'matchedRouteGroup' in extras) {
					userCharge.user_charged_factor_route_group = extras.matchedRouteGroup ?? null;
				}
			}
		}
		return JSON.stringify(parsed);
	} catch {
		return pricingAuditJson;
	}
}

export function applyUserChargedCostToBreakdown<
	T extends { chargedCost: number; pricingAuditJson: string; chargedFactor?: number },
>(
	breakdown: T,
	factorsJson: string | null | undefined,
	modelId: string,
	options?: { warnInvalidJson?: boolean; mode?: UserChargedCostFactorMode; routeGroup?: string | null }
): T {
	const mode = options?.mode ?? DEFAULT_USER_CHARGED_COST_FACTOR_MODE;
	const routeEffectiveFactor = normalizeRouteEffectiveFactor(breakdown.chargedFactor);
	if (factorsJson != null && factorsJson.trim() !== '' && parseUserChargedCostFactors(factorsJson) == null) {
		if (options?.warnInvalidJson !== false) {
			console.warn(
				`[Gateway Billing] invalid users.charged_cost_factors ignored model_id=${modelId}`
			);
		}
		return {
			...breakdown,
			pricingAuditJson: attachUserChargedFactorToPricingAudit(breakdown.pricingAuditJson, null, {
				mode,
				combinedChargedFactor: null,
				matchedRouteGroup: null,
			}),
		};
	}
	const match = resolveUserChargedCostFactorMatch(
		parseUserChargedCostFactors(factorsJson),
		modelId,
		options?.routeGroup
	);
	const factor = match?.factor ?? null;
	const combinedChargedFactor = resolveCombinedChargedFactor(routeEffectiveFactor, factor, mode);
	return {
		...breakdown,
		chargedCost: applyUserChargedCostFactor(breakdown.chargedCost, factor, {
			mode,
			routeEffectiveFactor,
		}),
		pricingAuditJson: attachUserChargedFactorToPricingAudit(breakdown.pricingAuditJson, factor, {
			mode,
			combinedChargedFactor,
			matchedRouteGroup: match?.routeGroup ?? null,
		}),
	};
}
