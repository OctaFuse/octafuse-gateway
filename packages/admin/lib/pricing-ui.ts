/**
 * 管理 UI：定价 profile 摘要、列表排序键、请求日志 `pricing_audit` 可读摘要。
 * 单价单位文案中的币别与 `system_config.BILLING_CURRENCY` 对齐（调用方传入 ISO 码，默认 USD）。
 */
import {
	extractMeteredProfileFromPriceOverrideJson,
	extractChargedProfileFromPriceOverrideJson,
	parsePricingProfile,
	type PricingTierPrices,
} from '@octafuse/core/db/pricing-profile';

import { getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';

export type CatalogPricingFields = {
	pricing_profile?: string | null;
};

function billingPerMUnit(currencyCode: string): string {
	const c = (currencyCode || 'USD').trim().toUpperCase();
	const code = /^[A-Z]{3}$/.test(c) ? c : 'USD';
	return `${getGatewayCurrencySymbol(code)}/M`;
}

/** 列表 / 路由页分组排序：按 profile 最低档 input（无 profile 则殿后） */
export function catalogInputPriceSortKey(m: CatalogPricingFields): number {
	const p = parsePricingProfile(m.pricing_profile ?? undefined);
	if (p && p.tiers.length > 0) {
		return Math.min(...p.tiers.map((t) => t.input_price));
	}
	return Number.NEGATIVE_INFINITY;
}

/** 模型目录表「定价」列一行摘要 */
export function formatCatalogPricingSummary(m: CatalogPricingFields, currencyCode = 'USD'): string {
	const p = parsePricingProfile(m.pricing_profile ?? undefined);
	if (!p || p.tiers.length === 0) {
		return '—';
	}
	const u = billingPerMUnit(currencyCode);
	const minIn = Math.min(...p.tiers.map((t) => t.input_price));
	if (p.tiers.length === 1) {
		const t = p.tiers[0]!;
		return `tiered · in/out ${t.input_price} / ${t.output_price} ${u}`;
	}
	return `tiered · ${p.tiers.length} tier(s) · from ${minIn} ${u} in`;
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

/**
 * 路由 `price_override.charged` 各档展示行（无则空数组）。
 */
export function getRouteChargedProfileTierRows(
	priceOverrideJson: string | null | undefined,
	currencyCode = 'USD'
): CatalogPricingTierDisplayRow[] {
	const nested = extractChargedProfileFromPriceOverrideJson(priceOverrideJson);
	return getCatalogPricingTierRows({ pricing_profile: nested }, currencyCode);
}

/**
 * 管理端辅助：目录各档 × `charged_factor`（仅展示；**不**等于运行时 `charged_cost`，后者见 `price_override.charged` / 目录 profile）。
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
 * 路由列表卡片：定价一行文案（无嵌套 tiers 时明确「继承目录」，有 tiers 时强调 metered 覆盖）。
 */
export function getRoutePriceOverrideCardHint(
	priceOverrideJson: string | null | undefined,
	currencyCode = 'USD'
): RoutePriceOverrideCardHint {
	const u = billingPerMUnit(currencyCode);
	const raw = priceOverrideJson?.trim();
	if (!raw) {
		return {
			variant: 'inherit',
			text: 'Inherits catalog · metered uses model pricing_profile',
		};
	}
	let obj: Record<string, unknown>;
	try {
		obj = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return { variant: 'warning', text: 'Invalid price_override JSON' };
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
		return { variant: 'warning', text: 'Invalid price_override root' };
	}
	const nested = extractMeteredProfileFromPriceOverrideJson(raw);
	const p = parsePricingProfile(nested ?? undefined);
	if (p && p.tiers.length > 0) {
		const minIn = Math.min(...p.tiers.map((t) => t.input_price));
		let text: string;
		if (p.tiers.length === 1) {
			text = `Metered override · 1 tier · in ${p.tiers[0]!.input_price} ${u}`;
		} else {
			text = `Metered override · ${p.tiers.length} tiers · from ${minIn} ${u} in`;
		}
		const ucNested = extractChargedProfileFromPriceOverrideJson(raw);
		const ucParsed = parsePricingProfile(ucNested ?? undefined);
		if (ucParsed && ucParsed.tiers.length > 0) {
			const ucMin = Math.min(...ucParsed.tiers.map((t) => t.input_price));
			text +=
				ucParsed.tiers.length === 1
					? ` · Charged override · 1 tier · in ${ucParsed.tiers[0]!.input_price} ${u}`
					: ` · Charged override · ${ucParsed.tiers.length} tiers · from ${ucMin} ${u} in`;
		}
		return { variant: 'override', text };
	}
	const ucNestedOnly = extractChargedProfileFromPriceOverrideJson(raw);
	const ucOnly = parsePricingProfile(ucNestedOnly ?? undefined);
	if (ucOnly && ucOnly.tiers.length > 0) {
		const ucMin = Math.min(...ucOnly.tiers.map((t) => t.input_price));
		const text =
			ucOnly.tiers.length === 1
				? `Charged override · 1 tier · in ${ucOnly.tiers[0]!.input_price} ${u} · metered inherits catalog`
				: `Charged override · ${ucOnly.tiers.length} tiers · from ${ucMin} ${u} in · metered inherits catalog`;
		return { variant: 'override', text };
	}
	const pf = obj.provider_factor;
	let pfNum: number | null = null;
	if (typeof pf === 'number' && Number.isFinite(pf)) {
		pfNum = pf;
	} else if (typeof pf === 'string' && pf.trim() !== '') {
		const n = parseFloat(pf.trim());
		if (Number.isFinite(n)) {
			pfNum = n;
		}
	}
	const keys = Object.keys(obj).filter((k) => obj[k] !== undefined && obj[k] !== null);
	const onlyFactor =
		keys.length === 1 && keys[0] === 'provider_factor' && pfNum != null;
	if (onlyFactor) {
		return {
			variant: 'inherit',
			text: `Inherits catalog · stored provider_factor ×${pfNum} (not used for metered until tiers exist)`,
		};
	}
	if (keys.length > 0) {
		return {
			variant: 'inherit',
			text: 'Inherits catalog · price_override has no metered override (uses model profile)',
		};
	}
	return {
		variant: 'inherit',
		text: 'Inherits catalog · metered uses model pricing_profile',
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
	currencyCode = 'USD'
): string {
	const h = getRoutePriceOverrideCardHint(priceOverrideJson, currencyCode);
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
		if (typeof o.v === 'number' && o.v === 3 && o.snapshot && typeof o.snapshot === 'object') {
			const snap = o.snapshot as Record<string, unknown>;
			const uc = snap.user_charge as Record<string, unknown> | undefined;
			if (uc && typeof uc.source === 'string') {
				parts.push(`charged ${uc.source}`);
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
