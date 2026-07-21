/**
 * 管理 UI：定价 profile 摘要、列表排序键、请求日志 `pricing_audit` 可读摘要。
 * 单价单位文案中的币别与 `system_config.BILLING_CURRENCY` 对齐（调用方传入 ISO 码，默认 USD）。
 */
import {
	parsePricingProfile,
	profileHasImagePerImagePricing,
	profileHasImageTokenPricing,
	resolveImageBillingMode,
	type PricingTierPrices,
} from '@octafuse/core/db/pricing-profile';

import { getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';

export type CatalogPricingFields = {
	pricing_profile?: string | null;
};

/** Optional UI labels from `useTranslations('pricing')`. */
export type PricingLabels = {
	noData: string;
	tieredSingle: string;
	tieredMulti: string;
	/** Image token catalog, e.g. `image tokens · text {text} / img-in {imageIn} / img-out {imageOut} {unit}` */
	imageTokens: string;
	/** Per-image catalog, e.g. `{price}/image` */
	imagePerImage: string;
	inheritsCatalog: string;
	invalidPriceOverrideJson: string;
	invalidPriceOverrideRoot: string;
	noMeteredOverride: string;
	providerFactorOnly: string;
	meteredOverrideSingle: string;
	meteredOverrideMulti: string;
	chargedOverrideSingle: string;
	chargedOverrideMulti: string;
	chargedOnlySingle: string;
	chargedOnlyMulti: string;
};

const DEFAULT_PRICING_LABELS: PricingLabels = {
	noData: '—',
	tieredSingle: 'tiered · in/out {input} / {output} {unit}',
	tieredMulti: 'tiered · {count} tier(s) · from {minIn} {unit} in',
	imageTokens: 'image tokens · text {text} / img-in {imageIn} / img-out {imageOut} {unit}',
	imagePerImage: '{price} {unit}',
	inheritsCatalog: 'Inherits catalog · metered uses model pricing_profile',
	invalidPriceOverrideJson: 'Invalid price_override JSON',
	invalidPriceOverrideRoot: 'Invalid price_override root',
	noMeteredOverride:
		'Inherits catalog · price_override has no metered override (uses model profile)',
	providerFactorOnly:
		'Inherits catalog · stored provider_factor ×{factor} (not used for metered until tiers exist)',
	meteredOverrideSingle: 'Metered override · 1 tier · in {price} {unit}',
	meteredOverrideMulti: 'Metered override · {count} tiers · from {minIn} {unit} in',
	chargedOverrideSingle: 'Charged override · 1 tier · in {price} {unit}',
	chargedOverrideMulti: 'Charged override · {count} tiers · from {minIn} {unit} in',
	chargedOnlySingle:
		'Charged override · 1 tier · in {price} {unit} · metered inherits catalog',
	chargedOnlyMulti:
		'Charged override · {count} tiers · from {minIn} {unit} in · metered inherits catalog',
};

function formatLabel(
	template: string,
	vars: Record<string, string | number>
): string {
	return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}

function billingPerMUnit(currencyCode: string): string {
	const c = (currencyCode || 'USD').trim().toUpperCase();
	const code = /^[A-Z]{3}$/.test(c) ? c : 'USD';
	return `${getGatewayCurrencySymbol(code)}/M`;
}

function billingPerImageUnit(currencyCode: string): string {
	const c = (currencyCode || 'USD').trim().toUpperCase();
	const code = /^[A-Z]{3}$/.test(c) ? c : 'USD';
	return `${getGatewayCurrencySymbol(code)}/image`;
}

/**
 * 列表 / 路由页分组排序键：
 * - Image token 价 → image_output_price
 * - 否则 → 最低档 input（无 profile 则殿后）
 */
export function catalogInputPriceSortKey(m: CatalogPricingFields): number {
	const p = parsePricingProfile(m.pricing_profile ?? undefined);
	if (!p) return Number.NEGATIVE_INFINITY;
	if (profileHasImagePerImagePricing(p) && p.image?.default != null) {
		return p.image.default;
	}
	if (profileHasImageTokenPricing(p)) {
		const outs = p.tiers
			.map((t) => t.image_output_price)
			.filter((n): n is number => n != null && Number.isFinite(n));
		if (outs.length > 0) return Math.min(...outs);
	}
	if (p.tiers.length > 0) {
		return Math.min(...p.tiers.map((t) => t.input_price));
	}
	return Number.NEGATIVE_INFINITY;
}

/** 模型目录表「定价」列一行摘要 */
export function formatCatalogPricingSummary(
	m: CatalogPricingFields,
	currencyCode = 'USD',
	labels: PricingLabels = DEFAULT_PRICING_LABELS
): string {
	const p = parsePricingProfile(m.pricing_profile ?? undefined);
	if (!p) {
		return labels.noData;
	}
	if (profileHasImagePerImagePricing(p) && p.image?.default != null) {
		const sym = getGatewayCurrencySymbol((currencyCode || 'USD').trim().toUpperCase());
		return formatLabel(labels.imagePerImage, {
			price: `${sym}${p.image.default}`,
			unit: billingPerImageUnit(currencyCode),
		});
	}
	if (profileHasImageTokenPricing(p) && p.tiers.length > 0) {
		const t = p.tiers[0]!;
		return formatLabel(labels.imageTokens, {
			text: t.input_price,
			imageIn: t.image_input_price ?? 0,
			imageOut: t.image_output_price ?? 0,
			unit: billingPerMUnit(currencyCode),
		});
	}
	if (p.tiers.length === 0) {
		return labels.noData;
	}
	const u = billingPerMUnit(currencyCode);
	const minIn = Math.min(...p.tiers.map((t) => t.input_price));
	if (p.tiers.length === 1) {
		const t = p.tiers[0]!;
		return formatLabel(labels.tieredSingle, {
			input: t.input_price,
			output: t.output_price,
			unit: u,
		});
	}
	return formatLabel(labels.tieredMulti, {
		count: p.tiers.length,
		minIn,
		unit: u,
	});
}

/** Gateway Models 表格：每档一行展示用（无合法 profile 时 `getCatalogPricingTierRows` 返回空数组） */
export type CatalogPricingTierDisplayRow = {
	rangeLine: string;
	inputOutputLine: string;
	cacheLine: string | null;
	pricesLine: string;
};

function formatOptionalPricePerM(n: number | null): string {
	if (n == null) {
		return '—';
	}
	return String(n);
}

function formatTierInputRange(previousUpto: number | null, upto: number | null): string {
	const lower = previousUpto == null ? '0' : previousUpto.toLocaleString();
	const upper = upto == null ? '∞' : upto.toLocaleString();
	const close = upto == null ? ')' : ']';
	return previousUpto == null ? `[${lower}, ${upper}${close}` : `(${lower}, ${upper}${close}`;
}

function tierToDisplayRow(
	t: PricingTierPrices,
	previousUpto: number | null,
	currencyCode: string
): CatalogPricingTierDisplayRow {
	const rangeLine = formatTierInputRange(previousUpto, t.upto);
	const inputOutputLine = `${t.input_price} / ${t.output_price}`;
	const u = billingPerMUnit(currencyCode);
	let cacheLine: string | null = null;
	let pricesLine = `in/out ${t.input_price} / ${t.output_price} ${u}`;
	if (t.cache_read_price != null || t.cache_write_price != null) {
		cacheLine = `${formatOptionalPricePerM(t.cache_read_price)} / ${formatOptionalPricePerM(t.cache_write_price)}`;
		pricesLine += ` · cache r/w ${cacheLine} ${u}`;
	}
	return { rangeLine, inputOutputLine, cacheLine, pricesLine };
}

/**
 * 解析 `pricing_profile` 为逐档展示行（与计费选档顺序一致：按 JSON 数组顺序）。
 */
export function getCatalogPricingTierRows(
	m: CatalogPricingFields,
	currencyCode = 'USD'
): CatalogPricingTierDisplayRow[] {
	const p = parsePricingProfile(m.pricing_profile ?? undefined);
	if (!p || p.tiers.length === 0) {
		return [];
	}
	return p.tiers.map((t, i) => tierToDisplayRow(t, i === 0 ? null : p.tiers[i - 1]!.upto, currencyCode));
}

/** 路由弹窗等只读区：按张价摘要行 */
export type CatalogImagePricingDisplayRow = {
	label: string;
	priceLine: string;
};

/** Image token 分项单价（$/1M） */
export type CatalogImageTokenRatesDisplay = {
	unit: string;
	textInput: string;
	cachedText: string;
	imageInput: string;
	cachedImageInput: string;
	imageOutput: string;
};

/** 路由 / Models 只读：Image 目录权威价（token 分项或 per_image 单价） */
export type CatalogImagePricingDisplay = {
	unit: string;
	billingKind: 'image_tokens' | 'image_per_image';
	tokenRates?: CatalogImageTokenRatesDisplay;
	/** 摘要行（token：img-out /1M；per_image：default /image） */
	defaultLine: string;
	/** per_image 权威 output 单价 */
	perImageDefault?: string;
	/** per_image 可选 input 参考图单价 */
	perImageInputDefault?: string | null;
	uncertainResultPolicy?: 'requested' | 'zero';
	fallbackRows: CatalogImagePricingDisplayRow[];
};

/**
 * Image 目录只读展示：
 * - **per_image**：权威 `image.default`（及可选 input）
 * - **token**：目录 token 分项价（不计 quality×size 估算）
 */
export function getCatalogImagePricingDisplay(
	m: CatalogPricingFields,
	currencyCode = 'USD'
): CatalogImagePricingDisplay | null {
	const p = parsePricingProfile(m.pricing_profile ?? undefined);
	if (!p) return null;

	const perImageUnit = billingPerImageUnit(currencyCode);
	const mode = resolveImageBillingMode(p);

	if (mode === 'per_image' && profileHasImagePerImagePricing(p) && p.image) {
		const defaultPrice = String(p.image.default);
		const inputDefault =
			p.image.input?.default != null ? String(p.image.input.default) : null;
		return {
			unit: perImageUnit,
			billingKind: 'image_per_image',
			defaultLine: `${defaultPrice} ${perImageUnit}`,
			perImageDefault: defaultPrice,
			perImageInputDefault: inputDefault,
			uncertainResultPolicy: p.image.uncertain_result_policy ?? 'requested',
			fallbackRows: [],
		};
	}

	if (!profileHasImageTokenPricing(p) || p.tiers.length === 0) return null;

	const perMUnit = billingPerMUnit(currencyCode);
	const t = p.tiers[0]!;
	const imageOut = t.image_output_price != null ? String(t.image_output_price) : '—';
	return {
		unit: perMUnit,
		billingKind: 'image_tokens',
		tokenRates: {
			unit: perMUnit,
			textInput: String(t.input_price),
			cachedText: t.cache_read_price != null ? String(t.cache_read_price) : '—',
			imageInput: t.image_input_price != null ? String(t.image_input_price) : '—',
			cachedImageInput:
				t.image_input_cache_price != null ? String(t.image_input_cache_price) : '—',
			imageOutput: imageOut,
		},
		defaultLine: `${imageOut} ${perMUnit}`,
		fallbackRows: [],
	};
}

/**
 * @deprecated 使用 {@link getCatalogImagePricingDisplay}；保留给旧调用方扁平列表。
 */
export function getCatalogImagePricingRows(
	m: CatalogPricingFields,
	currencyCode = 'USD'
): CatalogImagePricingDisplayRow[] {
	const display = getCatalogImagePricingDisplay(m, currencyCode);
	if (!display) return [];
	return [{ label: 'default', priceLine: display.defaultLine }, ...display.fallbackRows];
}

/**
 * 管理端辅助：目录各档 × `charged_factor`（展示用；与运行时 charged 基数一致，未含 schedule）。
 * `chargedFactor` 非有限数时返回空数组。
 */
export function getUserChargedCatalogTierRows(
	m: CatalogPricingFields,
	chargedFactor: number | null,
	currencyCode = 'USD'
): CatalogPricingTierDisplayRow[] {
	if (chargedFactor == null || !Number.isFinite(chargedFactor)) {
		return [];
	}
	const p = parsePricingProfile(m.pricing_profile ?? undefined);
	if (!p || p.tiers.length === 0) {
		return [];
	}
	const f = chargedFactor;
	return p.tiers.map((t, i) => {
		const scaled: PricingTierPrices = {
			upto: t.upto,
			label: null,
			input_price: Number((t.input_price * f).toFixed(6)),
			output_price: Number((t.output_price * f).toFixed(6)),
			cache_read_price:
				t.cache_read_price != null ? Number((t.cache_read_price * f).toFixed(6)) : null,
			cache_write_price:
				t.cache_write_price != null ? Number((t.cache_write_price * f).toFixed(6)) : null,
			image_input_price:
				t.image_input_price != null ? Number((t.image_input_price * f).toFixed(6)) : null,
			image_input_cache_price:
				t.image_input_cache_price != null
					? Number((t.image_input_cache_price * f).toFixed(6))
					: null,
			image_output_price:
				t.image_output_price != null ? Number((t.image_output_price * f).toFixed(6)) : null,
		};
		return tierToDisplayRow(scaled, i === 0 ? null : p.tiers[i - 1]!.upto, currencyCode);
	});
}

/** 整格 `title` 用：多档换行拼接 */
export function formatCatalogPricingTierRowsTooltip(m: CatalogPricingFields, currencyCode = 'USD'): string {
	const rows = getCatalogPricingTierRows(m, currencyCode);
	if (rows.length === 0) {
		return '—';
	}
	return rows.map((r) => `${r.rangeLine}\n${r.pricesLine}`).join('\n\n');
}

export type RoutePriceOverrideCardHint = {
	/** UI 样式：`inherit` 灰字；`override` 强调 metered 覆盖；`warning` 解析异常 */
	variant: 'inherit' | 'override' | 'warning';
	text: string;
};

/**
 * 路由列表卡片：定价一行文案（目录 × charged/metered factor；可选 schedule）。
 */
export function getRoutePriceOverrideCardHint(
	priceOverrideJson: string | null | undefined,
	_currencyCode = 'USD',
	labels: PricingLabels = DEFAULT_PRICING_LABELS
): RoutePriceOverrideCardHint {
	const raw = priceOverrideJson?.trim();
	if (!raw) {
		return {
			variant: 'inherit',
			text: labels.inheritsCatalog,
		};
	}
	let obj: Record<string, unknown>;
	try {
		obj = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return { variant: 'warning', text: labels.invalidPriceOverrideJson };
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
		return { variant: 'warning', text: labels.invalidPriceOverrideRoot };
	}
	const charged = parseChargedFactorFromPriceOverride(raw) ?? 1;
	const metered = parseMeteredFactorFromPriceOverride(raw) ?? 1;
	const hasSchedule =
		obj.schedule != null && typeof obj.schedule === 'object' && !Array.isArray(obj.schedule);
	const text = `Catalog × Ch ${charged} · M ${metered}${hasSchedule ? ' · schedule' : ''}`;
	if (Number.isFinite(charged) && Number.isFinite(metered)) {
		return { variant: 'override', text };
	}
	return {
		variant: 'inherit',
		text: labels.inheritsCatalog,
	};
}

function readNumericFromPriceOverrideRoot(
	priceOverrideJson: string | null | undefined,
	key: string
): number | null {
	if (!priceOverrideJson?.trim()) {
		return null;
	}
	try {
		const o = JSON.parse(priceOverrideJson) as Record<string, unknown>;
		const v = o[key];
		if (typeof v === 'number' && Number.isFinite(v)) {
			return v;
		}
		if (typeof v === 'string' && v.trim() !== '') {
			const n = parseFloat(v.trim());
			if (Number.isFinite(n)) {
				return n;
			}
		}
	} catch {
		// ignore
	}
	return null;
}

/** 路由卡片 / 调试：`price_override.charged_factor`（相对目录标准价的倍率）。 */
export function parseChargedFactorFromPriceOverride(
	priceOverrideJson: string | null | undefined
): number | null {
	return readNumericFromPriceOverrideRoot(priceOverrideJson, 'charged_factor');
}

/**
 * 路由卡片：`price_override.metered_factor`；旧数据可能仅有 `provider_factor`，作回退。
 */
export function parseMeteredFactorFromPriceOverride(
	priceOverrideJson: string | null | undefined
): number | null {
	const m = readNumericFromPriceOverrideRoot(priceOverrideJson, 'metered_factor');
	if (m != null) {
		return m;
	}
	return readNumericFromPriceOverrideRoot(priceOverrideJson, 'provider_factor');
}

/** 路由卡片上 `price_override` 一行摘要（仅含合法嵌套 `metered` tiers 时非空；兼容旧调用方） */
export function formatRoutePriceOverrideSummary(
	priceOverrideJson: string | null | undefined,
	currencyCode = 'USD',
	labels?: PricingLabels
): string {
	const h = getRoutePriceOverrideCardHint(priceOverrideJson, currencyCode, labels);
	return h.variant === 'override' ? h.text : '';
}

/** `api_key_request_logs.pricing_audit` 展示用短文案 */
export function summarizePricingAuditJson(raw: string | null | undefined): string | null {
	if (!raw?.trim()) {
		return null;
	}
	try {
		const o = JSON.parse(raw) as Record<string, unknown>;
		const parts: string[] = [];
		if (typeof o.v === 'number') {
			parts.push(`v${o.v}`);
		}
		if (o.kind === 'image_tokens') {
			parts.push('image_tokens');
			const tokens = o.tokens as Record<string, unknown> | undefined;
			if (tokens && typeof tokens === 'object') {
				const text = typeof tokens.text === 'number' ? tokens.text : 0;
				const imgIn = typeof tokens.image_input === 'number' ? tokens.image_input : 0;
				const imgOut = typeof tokens.image_output === 'number' ? tokens.image_output : 0;
				parts.push(`text/img-in/img-out ${text}/${imgIn}/${imgOut}`);
			}
			if (typeof o.quality === 'string' && typeof o.size === 'string') {
				parts.push(`${o.quality}×${o.size}`);
			}
		}
		if (o.kind === 'image_per_image') {
			parts.push('image_per_image');
			const inN = typeof o.input_image_count === 'number' ? o.input_image_count : 0;
			const outN = typeof o.output_image_count === 'number' ? o.output_image_count : 0;
			parts.push(`${inN} in / ${outN} out`);
			const outPrice = typeof o.output_unit_price === 'number' ? o.output_unit_price : null;
			const inPrice = typeof o.input_unit_price === 'number' ? o.input_unit_price : null;
			if (outPrice != null) {
				parts.push(`out ${outPrice}/img`);
			}
			if (inPrice != null && inPrice > 0) {
				parts.push(`in ${inPrice}/img`);
			}
			if (typeof o.result_confirmed === 'boolean') {
				parts.push(o.result_confirmed ? 'confirmed' : 'uncertain');
			}
			if (typeof o.uncertain_result_policy === 'string') {
				parts.push(`policy ${o.uncertain_result_policy}`);
			}
		}
		if (
			typeof o.v === 'number' &&
			(o.v === 3 || o.v === 4) &&
			o.snapshot &&
			typeof o.snapshot === 'object'
		) {
			const snap = o.snapshot as Record<string, unknown>;
			const uc = snap.user_charge as Record<string, unknown> | undefined;
			if (uc && typeof uc.source === 'string') {
				parts.push(`charged ${uc.source}`);
			}
			if (uc && typeof uc.effective_factor === 'number') {
				parts.push(`×${uc.effective_factor}`);
			}
		}
		if (typeof o.basis_tokens === 'number') {
			parts.push(`basis ${o.basis_tokens.toLocaleString()} in`);
		}
		return parts.length > 0 ? parts.join(' · ') : null;
	} catch {
		return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
	}
}
