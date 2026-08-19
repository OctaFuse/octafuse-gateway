/**
 * 用户级 Charged cost factor：`users.charged_cost_factors` JSON
 * `{ "<models.id>": 0.8 }`。仅在路由 Charged cost 算完后再乘；缺键不改金额。
 */
import { roundGatewayMoney } from '../lib/money-precision';

export type UserChargedCostFactors = Record<string, number>;

export type NormalizeUserChargedCostFactorsResult =
	| { ok: true; value: UserChargedCostFactors | null; json: string | null }
	| { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
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

/** 路由 charged 已 round 后，若 factor 存在再乘并 round。 */
export function applyUserChargedCostFactor(routeCharged: number, factor: number | null | undefined): number {
	if (factor == null) {
		return roundGatewayMoney(routeCharged);
	}
	return roundGatewayMoney(roundGatewayMoney(routeCharged) * factor);
}

export function attachUserChargedFactorToPricingAudit(
	pricingAuditJson: string,
	userChargedFactor: number | null
): string {
	try {
		const parsed: unknown = JSON.parse(pricingAuditJson);
		if (!isPlainObject(parsed)) {
			return pricingAuditJson;
		}
		parsed.user_charged_factor = userChargedFactor;
		const snapshot = parsed.snapshot;
		if (isPlainObject(snapshot)) {
			const userCharge = snapshot.user_charge;
			if (isPlainObject(userCharge)) {
				userCharge.user_charged_factor = userChargedFactor;
			}
		}
		return JSON.stringify(parsed);
	} catch {
		return pricingAuditJson;
	}
}

export function applyUserChargedCostToBreakdown<T extends { chargedCost: number; pricingAuditJson: string }>(
	breakdown: T,
	factorsJson: string | null | undefined,
	modelId: string,
	options?: { warnInvalidJson?: boolean }
): T {
	if (factorsJson != null && factorsJson.trim() !== '' && parseUserChargedCostFactors(factorsJson) == null) {
		if (options?.warnInvalidJson !== false) {
			console.warn(
				`[Gateway Billing] invalid users.charged_cost_factors ignored model_id=${modelId}`
			);
		}
		return {
			...breakdown,
			pricingAuditJson: attachUserChargedFactorToPricingAudit(breakdown.pricingAuditJson, null),
		};
	}
	const factor = lookupUserChargedCostFactor(parseUserChargedCostFactors(factorsJson), modelId);
	return {
		...breakdown,
		chargedCost: applyUserChargedCostFactor(breakdown.chargedCost, factor),
		pricingAuditJson: attachUserChargedFactorToPricingAudit(breakdown.pricingAuditJson, factor),
	};
}
