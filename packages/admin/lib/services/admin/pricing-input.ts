/**
 * 管理 API：`pricing_profile` / `price_override` 内嵌 profile 的规范化与校验（与 `@octafuse/core` 解析一致）。
 */
import { parsePricingProfile } from '@octafuse/core/db/pricing-profile';
import { badRequest } from './errors';

/**
 * 将请求体中的 `pricing_profile` 规范为可写入 `models.pricing_profile` 的 JSON 文本；空表示清除或未设置。
 * @throws `badRequest` 非空但无法解析为合法 profile
 */
export function coerceModelPricingProfileInput(raw: unknown): string | null {
	if (raw === undefined || raw === null) {
		return null;
	}
	if (typeof raw === 'string') {
		const t = raw.trim();
		if (t === '') {
			return null;
		}
		if (!parsePricingProfile(t)) {
			throw badRequest(
				'pricing_profile: invalid JSON or unsupported shape (expected `{ "tiers": [...] }`)'
			);
		}
		return t;
	}
	if (typeof raw === 'object' && !Array.isArray(raw)) {
		const t = JSON.stringify(raw);
		if (!parsePricingProfile(t)) {
			throw badRequest('pricing_profile: object does not form a valid pricing profile');
		}
		return t;
	}
	throw badRequest('pricing_profile must be a JSON string, object, null, or omitted');
}

/**
 * 规范化 `model_routes.price_override`：整段 JSON 字符串；校验嵌套 **`metered`** / **`charged`** profile（若存在）；并规范化可选 **`charged_factor`** / **`metered_factor`**（非负数字）。
 * @throws `badRequest`
 */
export function coerceRoutePriceOverrideInput(raw: unknown): string | null {
	if (raw === undefined || raw === null) {
		return null;
	}
	let obj: Record<string, unknown>;
	if (typeof raw === 'string') {
		const t = raw.trim();
		if (t === '') {
			return null;
		}
		try {
			obj = JSON.parse(t) as Record<string, unknown>;
		} catch {
			throw badRequest('price_override must be valid JSON');
		}
	} else if (typeof raw === 'object' && !Array.isArray(raw)) {
		obj = { ...(raw as Record<string, unknown>) };
	} else {
		throw badRequest('price_override must be a JSON object or JSON string');
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
		throw badRequest('price_override root must be a JSON object');
	}

	if (Object.prototype.hasOwnProperty.call(obj, 'user')) {
		throw badRequest('price_override: unsupported key "user"; use "charged"');
	}

	const metered = obj.metered;
	if (metered !== undefined && metered !== null) {
		if (typeof metered === 'string') {
			const inner = metered.trim();
			if (inner === '') {
				delete obj.metered;
			} else if (!parsePricingProfile(inner)) {
				throw badRequest('price_override.metered: invalid profile JSON');
			} else {
				obj.metered = JSON.parse(inner) as Record<string, unknown>;
			}
		} else if (typeof metered === 'object' && !Array.isArray(metered)) {
			const inner = JSON.stringify(metered);
			if (!parsePricingProfile(inner)) {
				throw badRequest('price_override.metered: invalid profile object');
			}
			obj.metered = JSON.parse(inner) as Record<string, unknown>;
		} else {
			throw badRequest('price_override.metered must be a string or object');
		}
	}

	const charged = obj.charged;
	if (charged !== undefined && charged !== null) {
		if (typeof charged === 'string') {
			const inner = charged.trim();
			if (inner === '') {
				delete obj.charged;
			} else if (!parsePricingProfile(inner)) {
				throw badRequest('price_override.charged: invalid profile JSON');
			} else {
				obj.charged = JSON.parse(inner) as Record<string, unknown>;
			}
		} else if (typeof charged === 'object' && !Array.isArray(charged)) {
			const inner = JSON.stringify(charged);
			if (!parsePricingProfile(inner)) {
				throw badRequest('price_override.charged: invalid profile object');
			}
			obj.charged = JSON.parse(inner) as Record<string, unknown>;
		} else {
			throw badRequest('price_override.charged must be a string or object');
		}
	}

	for (const k of ['input_price', 'output_price', 'cache_read_price', 'cache_write_price'] as const) {
		delete obj[k];
	}
	const pf = obj.provider_factor;
	if (typeof pf === 'string' && pf.trim() !== '') {
		const n = parseFloat(pf.trim());
		if (Number.isFinite(n)) {
			obj.provider_factor = n;
		} else {
			delete obj.provider_factor;
		}
	} else if (pf !== undefined && pf !== null && typeof pf !== 'number') {
		delete obj.provider_factor;
	}

	const normalizeOptionalNonNegativeFactor = (key: 'charged_factor' | 'metered_factor'): void => {
		const v = obj[key];
		if (v === undefined || v === null) {
			return;
		}
		if (typeof v === 'string' && v.trim() !== '') {
			const n = parseFloat(v.trim());
			if (Number.isFinite(n) && n >= 0) {
				obj[key] = n;
			} else {
				delete obj[key];
			}
		} else if (typeof v === 'number') {
			if (Number.isFinite(v) && v >= 0) {
				obj[key] = v;
			} else {
				delete obj[key];
			}
		} else {
			delete obj[key];
		}
	};
	normalizeOptionalNonNegativeFactor('charged_factor');
	normalizeOptionalNonNegativeFactor('metered_factor');

	if (Object.keys(obj).length === 0) {
		return null;
	}
	return JSON.stringify(obj);
}

/**
 * After `coerceRoutePriceOverrideInput`, require nested **`metered`** and **`charged`** profiles,
 * each parsing as a valid pricing profile with at least one tier.
 * @throws `badRequest`
 */
export function assertRoutePriceOverrideHasMeteredAndCharged(normalizedJson: string | null): void {
	if (!normalizedJson?.trim()) {
		throw badRequest(
			'price_override is required and must include valid "metered" and "charged" profiles with at least one tier each'
		);
	}
	let obj: Record<string, unknown>;
	try {
		obj = JSON.parse(normalizedJson) as Record<string, unknown>;
	} catch {
		throw badRequest('price_override must be valid JSON');
	}
	for (const side of ['metered', 'charged'] as const) {
		const raw = obj[side];
		if (raw == null) {
			throw badRequest(`price_override.${side} is required`);
		}
		const inner = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw);
		if (!inner) {
			throw badRequest(`price_override.${side} is required`);
		}
		const p = parsePricingProfile(inner);
		if (!p || p.tiers.length === 0) {
			throw badRequest(`price_override.${side} must be a valid pricing profile with at least one tier`);
		}
	}
}
