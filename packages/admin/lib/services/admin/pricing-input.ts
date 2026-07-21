/**
 * 管理 API：`pricing_profile` / `price_override` 的规范化与校验（与 `@octafuse/core` 解析一致）。
 */
import {
	parsePricingProfile,
	type ImagePricingConfig,
	type ParsedPricingProfile,
} from '@octafuse/core/db/pricing-profile';
import { coerceRoutePricingScheduleInput } from '@octafuse/core/db/pricing-schedule';
import { badRequest } from './errors';

function serializeImagePricingConfig(image: ImagePricingConfig): Record<string, unknown> {
	const out: Record<string, unknown> = { default: image.default };
	if (image.by_quality) {
		out.by_quality = image.by_quality;
	}
	if (image.by_size) {
		out.by_size = image.by_size;
	}
	if (image.by_quality_size) {
		out.by_quality_size = image.by_quality_size;
	}
	if (image.input) {
		const input: Record<string, unknown> = { default: image.input.default };
		if (image.input.by_quality) {
			input.by_quality = image.input.by_quality;
		}
		if (image.input.by_size) {
			input.by_size = image.input.by_size;
		}
		if (image.input.by_quality_size) {
			input.by_quality_size = image.input.by_quality_size;
		}
		out.input = input;
	}
	if (image.uncertain_result_policy && image.uncertain_result_policy !== 'requested') {
		out.uncertain_result_policy = image.uncertain_result_policy;
	}
	return out;
}

/** per_image 权威形状：无 `tiers`（历史占位零档写入时剥离）。 */
function canonicalizePerImageProfile(profile: ParsedPricingProfile): string {
	return JSON.stringify({
		image_billing_mode: 'per_image',
		image: serializeImagePricingConfig(profile.image!),
	});
}

function assertImageBillingProfileConstraints(profile: ParsedPricingProfile): void {
	const mode = profile.image_billing_mode;
	if (mode === 'token') {
		const imgDefault = profile.image?.default;
		if (imgDefault != null && Number.isFinite(imgDefault) && imgDefault >= 0) {
			throw badRequest(
				'pricing_profile: image_billing_mode "token" cannot include image.default (per-image catalog price)'
			);
		}
	}
	if (mode === 'per_image') {
		const d = profile.image?.default;
		if (d == null || !Number.isFinite(d) || d < 0) {
			throw badRequest(
				'pricing_profile: image_billing_mode "per_image" requires image.default >= 0'
			);
		}
		for (let i = 0; i < profile.tiers.length; i++) {
			const tier = profile.tiers[i]!;
			for (const [field, val] of [
				['image_input_price', tier.image_input_price],
				['image_input_cache_price', tier.image_input_cache_price],
				['image_output_price', tier.image_output_price],
			] as const) {
				if (val != null && val > 0) {
					throw badRequest(
						`pricing_profile: image_billing_mode "per_image" cannot have positive tier ${field} (tier ${i + 1}: ${val}); use image.default / image.input instead`
					);
				}
			}
		}
	}
}

function validatePricingProfileJson(json: string): string {
	const profile = parsePricingProfile(json);
	if (!profile) {
		throw badRequest(
			'pricing_profile: invalid JSON or unsupported shape (expected `{ "tiers": [...] }` or `{ "image_billing_mode": "per_image", "image": { ... } }`)'
		);
	}
	assertImageBillingProfileConstraints(profile);
	if (profile.image_billing_mode === 'per_image') {
		return canonicalizePerImageProfile(profile);
	}
	return json;
}

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
		return validatePricingProfileJson(t);
	}
	if (typeof raw === 'object' && !Array.isArray(raw)) {
		const t = JSON.stringify(raw);
		return validatePricingProfileJson(t);
	}
	throw badRequest('pricing_profile must be a JSON string, object, null, or omitted');
}

function normalizeOptionalNonNegativeFactor(
	obj: Record<string, unknown>,
	key: 'charged_factor' | 'metered_factor' | 'provider_factor'
): void {
	const v = obj[key];
	if (v === undefined || v === null) {
		delete obj[key];
		return;
	}
	if (typeof v === 'string') {
		const text = v.trim();
		if (text === '') {
			delete obj[key];
			return;
		}
		const n = Number(text);
		if (Number.isFinite(n) && n >= 0) {
			obj[key] = n;
			return;
		}
	}
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
		obj[key] = v;
		return;
	}
	throw badRequest(`price_override.${key} must be a number ≥ 0`);
}

/**
 * 规范化 `model_routes.price_override`：整段 JSON 字符串。
 * Canonical：`charged_factor` / `metered_factor` / 可选 `schedule`。
 * 剥离 nested `metered` / `charged` tiers 与扁平单价键（不计价）。
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
		throw badRequest('price_override: unsupported key "user"; use "charged_factor"');
	}

	// Nested tiers are deprecated and ignored at billing time — strip on write.
	delete obj.metered;
	delete obj.charged;
	for (const k of ['input_price', 'output_price', 'cache_read_price', 'cache_write_price'] as const) {
		delete obj[k];
	}

	normalizeOptionalNonNegativeFactor(obj, 'provider_factor');
	normalizeOptionalNonNegativeFactor(obj, 'charged_factor');
	normalizeOptionalNonNegativeFactor(obj, 'metered_factor');

	if (obj.schedule !== undefined) {
		const coerced = coerceRoutePricingScheduleInput(obj.schedule);
		if (!coerced.ok) {
			throw badRequest(coerced.message);
		}
		const { charged, metered } = coerced.schedule;
		if (charged.length === 0 && metered.length === 0) {
			delete obj.schedule;
		} else {
			obj.schedule = {
				...(charged.length > 0 ? { charged } : {}),
				...(metered.length > 0 ? { metered } : {}),
			};
		}
	}

	if (Object.keys(obj).length === 0) {
		return null;
	}
	return JSON.stringify(obj);
}

/**
 * After `coerceRoutePriceOverrideInput`, require non-negative `charged_factor` / `metered_factor`
 * (defaulting missing values to 1 when persisting is caller's choice; here we accept omit = 1).
 * @throws `badRequest`
 */
export function assertRoutePriceOverrideFactors(normalizedJson: string | null): void {
	if (!normalizedJson?.trim()) {
		// Empty override means all factors default to 1 at runtime — allowed.
		return;
	}
	let obj: Record<string, unknown>;
	try {
		obj = JSON.parse(normalizedJson) as Record<string, unknown>;
	} catch {
		throw badRequest('price_override must be valid JSON');
	}
	for (const key of ['charged_factor', 'metered_factor'] as const) {
		const v = obj[key];
		if (v === undefined || v === null) {
			continue;
		}
		if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
			throw badRequest(`price_override.${key} must be a number ≥ 0`);
		}
	}
	if (obj.schedule !== undefined) {
		const coerced = coerceRoutePricingScheduleInput(obj.schedule);
		if (!coerced.ok) {
			throw badRequest(coerced.message);
		}
	}
}

/**
 * @deprecated Use `assertRoutePriceOverrideFactors`. Nested metered/charged tiers are no longer required.
 */
export function assertRoutePriceOverrideHasMeteredAndCharged(normalizedJson: string | null): void {
	assertRoutePriceOverrideFactors(normalizedJson);
}
