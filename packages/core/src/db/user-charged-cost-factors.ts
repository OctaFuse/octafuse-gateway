/**
 * 用户级 Charged cost factor：`users.charged_cost_factors` JSON
 * `{ "<models.id>": 0.8 }`。与路由 Charged 有效倍率按全局 mode 合成后作用到官方当刻价。
 * 缺键不改金额。
 */
import { roundGatewayMoney } from '../lib/money-precision';
import {
	DEFAULT_USER_CHARGED_COST_FACTOR_MODE,
	type UserChargedCostFactorMode,
} from '../lib/user-charged-cost-factor-mode';

export type UserChargedCostFactors = Record<string, number>;

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

/**
 * 写入校验：对象（非数组）；键非空；值有限且 ≥ 0。`null` / `{}` 落库为 NULL。
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
		const n = typeof rawVal === 'number' ? rawVal : Number(rawVal);
		if (!Number.isFinite(n) || n < 0) {
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
			const n = typeof rawVal === 'number' ? rawVal : Number(rawVal);
			if (!key || !Number.isFinite(n) || n < 0) {
				continue;
			}
			out[key] = n;
		}
		return Object.keys(out).length > 0 ? out : null;
	} catch {
		return null;
	}
}

export function lookupUserChargedCostFactor(
	factors: UserChargedCostFactors | null | undefined,
	modelId: string
): number | null {
	const id = modelId.trim();
	if (!id || !factors) {
		return null;
	}
	const n = factors[id];
	return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
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
};

export function attachUserChargedFactorToPricingAudit(
	pricingAuditJson: string,
	userChargedFactor: number | null,
	extras?: { mode?: UserChargedCostFactorMode; combinedChargedFactor?: number | null }
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
	options?: { warnInvalidJson?: boolean; mode?: UserChargedCostFactorMode }
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
			}),
		};
	}
	const factor = lookupUserChargedCostFactor(parseUserChargedCostFactors(factorsJson), modelId);
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
		}),
	};
}
