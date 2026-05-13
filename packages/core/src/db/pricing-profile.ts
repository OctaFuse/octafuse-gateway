/**
 * `models.pricing_profile`（目录标准价）与 `model_routes.price_override` 内 **`metered`** / **`charged`** 嵌套 profile 的解析与选档。
 * 校验与 `JSON.parse` 行为以 D1 / SQLite 存 TEXT、Worker 侧解析为准。
 * 单价数值币种见 `system_config.BILLING_CURRENCY`（ISO 4217，默认 USD），与 `api_keys` 预算同币。
 *
 * **形状**：`{ "tiers": [ { "upto", "label", "input_price", "output_price", "cache_read_price"?, "cache_write_price"? } ] }`。
 * 单档固定价：仅一档，末档 **`upto` 为 JSON `null`** 表示输入 token 上界无限。
 * 多档阶梯：非末档 `upto` 为有限数字 **≥ 0**；末档 **`upto` 为 `null`**（无限上界）或有限上界；选档 basis 为上游 **`input_tokens`**。
 */

/** 每百万 token 单价快照（与 `usage-tracker.computeMeteredCost` 对齐）。 */
export type BillingPriceSnapshot = {
	input_price: number | null;
	output_price: number | null;
	cache_read_price: number | null;
	cache_write_price: number | null;
};

/**
 * 单档价格。`upto` 为该档输入 token 上界（含）；**`null` 仅末档**表示无限上界。
 * 非末档须为有限数字；超过所有有限上界时落在末档（末档可为有限或 `null`）。
 */
export interface PricingTierPrices {
	upto: number | null;
	label: string | null;
	input_price: number;
	output_price: number;
	cache_read_price: number | null;
	cache_write_price: number | null;
}

export interface ParsedPricingProfile {
	tiers: PricingTierPrices[];
}

/** 单次计费侧解析结果，写入 `api_key_request_logs.pricing_audit.snapshot` 子树。 */
export type PriceResolutionAuditSide = {
	path: 'profile' | 'missing_profile';
	source?: 'route_nested' | 'model';
	basis_tokens?: number;
	prices?: BillingPriceSnapshot;
};

const ZERO_BILLING_SNAPSHOT: BillingPriceSnapshot = {
	input_price: 0,
	output_price: 0,
	cache_read_price: 0,
	cache_write_price: 0,
};

function asFiniteNumber(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) {
		return v;
	}
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		if (Number.isFinite(n)) {
			return n;
		}
	}
	return null;
}

function asOptionalPrice(v: unknown): number | null {
	return asFiniteNumber(v);
}

function tierLabelFromRow(row: Record<string, unknown>): string | null {
	const raw = row.label;
	if (raw == null) {
		return null;
	}
	if (typeof raw === 'string' && raw.trim() !== '') {
		return raw.trim();
	}
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return String(raw);
	}
	return null;
}

/**
 * 从 `model_routes.price_override` 取 **`charged`** 嵌套 profile（字符串或对象），用于用户预算 `charged_cost`。
 */
export function extractChargedProfileFromPriceOverrideJson(raw: string | null | undefined): string | null {
	if (raw == null || String(raw).trim() === '') {
		return null;
	}
	try {
		const o = JSON.parse(raw) as Record<string, unknown>;
		const p = o.charged;
		if (typeof p === 'string' && p.trim() !== '') {
			return p;
		}
		if (p && typeof p === 'object' && !Array.isArray(p)) {
			return JSON.stringify(p);
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * 从 `model_routes.price_override` 取 **`metered`** 嵌套 profile（字符串或对象），用于供应侧 `metered_cost`。
 */
export function extractMeteredProfileFromPriceOverrideJson(raw: string | null | undefined): string | null {
	if (raw == null || String(raw).trim() === '') {
		return null;
	}
	try {
		const o = JSON.parse(raw) as Record<string, unknown>;
		const p = o.metered;
		if (typeof p === 'string' && p.trim() !== '') {
			return p;
		}
		if (p && typeof p === 'object' && !Array.isArray(p)) {
			return JSON.stringify(p);
		}
		return null;
	} catch {
		return null;
	}
}

/** 选档排序：有限 `upto` 升序，**`null`（无限）永远在最后**。 */
function compareTierUpto(a: PricingTierPrices, b: PricingTierPrices): number {
	const au = a.upto;
	const bu = b.upto;
	if (au === null && bu === null) {
		return 0;
	}
	if (au === null) {
		return 1;
	}
	if (bu === null) {
		return -1;
	}
	return au - bu;
}

function parseTiersArray(raw: unknown): PricingTierPrices[] | null {
	if (!Array.isArray(raw) || raw.length === 0) {
		return null;
	}
	const n = raw.length;
	const tiers: PricingTierPrices[] = [];
	for (let i = 0; i < n; i++) {
		const item = raw[i];
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			return null;
		}
		const row = item as Record<string, unknown>;
		const isLast = i === n - 1;
		const rawUpto = row.upto;
		let upto: number | null;

		if (rawUpto === null && isLast) {
			upto = null;
		} else if (rawUpto === null && !isLast) {
			return null;
		} else {
			const num = asFiniteNumber(rawUpto);
			if (num == null || num < 0) {
				return null;
			}
			upto = num;
		}

		const input_price = asFiniteNumber(row.input_price);
		const output_price = asFiniteNumber(row.output_price);
		if (input_price == null || output_price == null) {
			return null;
		}
		tiers.push({
			upto,
			label: tierLabelFromRow(row),
			input_price,
			output_price,
			cache_read_price: asOptionalPrice(row.cache_read_price),
			cache_write_price: asOptionalPrice(row.cache_write_price),
		});
	}
	return tiers;
}

/**
 * 解析并校验 `pricing_profile` JSON 文本；不合法时返回 `null`（调用方按无 profile 处理，单价按 0）。
 * 仅接受 **`{ "tiers": [ ... ] }`**。
 */
export function parsePricingProfile(jsonText: string | null | undefined): ParsedPricingProfile | null {
	if (jsonText == null || String(jsonText).trim() === '') {
		return null;
	}
	let root: unknown;
	try {
		root = JSON.parse(jsonText) as unknown;
	} catch {
		return null;
	}
	if (!root || typeof root !== 'object' || Array.isArray(root)) {
		return null;
	}
	const o = root as Record<string, unknown>;
	const tiers = parseTiersArray(o.tiers);
	if (!tiers) {
		return null;
	}
	return { tiers };
}

/**
 * 按 `basis_tokens`（通常为上游 usage 的 `input_tokens`）选档：有限 `upto` 升序，命中第一个 `basis <= upto`；
 * 遇末档 **`upto === null`**（无限上界）则命中该档；否则若 `basis` 大于所有有限上界，使用最后一档。
 */
export function pickPricingTier(basisTokens: number, profile: ParsedPricingProfile): PricingTierPrices {
	const sorted = [...profile.tiers].sort(compareTierUpto);
	for (const t of sorted) {
		if (t.upto === null) {
			return t;
		}
		if (basisTokens <= t.upto) {
			return t;
		}
	}
	return sorted[sorted.length - 1]!;
}

function materializeFromParsed(
	basisInputTokens: number,
	parsed: ParsedPricingProfile,
	source: 'route_nested' | 'model'
): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	const tier = pickPricingTier(basisInputTokens, parsed);
	const prices: BillingPriceSnapshot = {
		input_price: tier.input_price,
		output_price: tier.output_price,
		cache_read_price: tier.cache_read_price,
		cache_write_price: tier.cache_write_price,
	};
	return {
		prices,
		audit: {
			path: 'profile',
			source,
			basis_tokens: basisInputTokens,
			prices,
		},
	};
}

/**
 * 供应侧单价：优先路由 `price_override.metered`，其次 `models.pricing_profile`；均无合法 profile 时单价为 0。
 * @param options.routeNestedMeteredProfileJson 若路由层已解析嵌套 profile（与 `extractMeteredProfileFromPriceOverrideJson` 结果一致），可传入以避免对整段 `price_override` 再 `JSON.parse`；仍可与 `routePriceOverrideJson` 同时存在，本字段优先。
 */
export function resolveSupplierBillingPrices(options: {
	basisInputTokens: number;
	routePriceOverrideJson: string | null | undefined;
	/** 来自 `model_routes.price_override` 内嵌 `metered` 的 JSON 字符串（已由路由层解析时传入） */
	routeNestedMeteredProfileJson?: string | null | undefined;
	modelPricingProfileJson: string | null | undefined;
}): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	const nested =
		typeof options.routeNestedMeteredProfileJson === 'string' &&
		options.routeNestedMeteredProfileJson.trim() !== ''
			? options.routeNestedMeteredProfileJson.trim()
			: null;
	const routeSub = nested ?? extractMeteredProfileFromPriceOverrideJson(options.routePriceOverrideJson);
	const tryOrder: Array<{ json: string; source: 'route_nested' | 'model' }> = [];
	if (routeSub) {
		tryOrder.push({ json: routeSub, source: 'route_nested' });
	}
	if (options.modelPricingProfileJson?.trim()) {
		tryOrder.push({ json: options.modelPricingProfileJson.trim(), source: 'model' });
	}
	for (const c of tryOrder) {
		const parsed = parsePricingProfile(c.json);
		if (!parsed) {
			continue;
		}
		return materializeFromParsed(options.basisInputTokens, parsed, c.source);
	}
	return {
		prices: ZERO_BILLING_SNAPSHOT,
		audit: {
			path: 'missing_profile',
			source: 'model',
			basis_tokens: options.basisInputTokens,
			prices: ZERO_BILLING_SNAPSHOT,
		},
	};
}

/**
 * 标准价侧单价：仅 `models.pricing_profile`；无合法 profile 时单价为 0。
 */
export function resolveStandardBillingPrices(options: {
	basisInputTokens: number;
	modelPricingProfileJson: string | null | undefined;
}): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	if (options.modelPricingProfileJson?.trim()) {
		const parsed = parsePricingProfile(options.modelPricingProfileJson.trim());
		if (parsed) {
			return materializeFromParsed(options.basisInputTokens, parsed, 'model');
		}
	}
	return {
		prices: ZERO_BILLING_SNAPSHOT,
		audit: {
			path: 'missing_profile',
			source: 'model',
			basis_tokens: options.basisInputTokens,
			prices: ZERO_BILLING_SNAPSHOT,
		},
	};
}

/**
 * 用户预算侧单价（`charged_cost` 用）：优先路由 `price_override.charged`，否则 `models.pricing_profile`；均无合法 profile 时单价为 0。
 * @param options.routeNestedChargedProfileJson 若路由层已解析嵌套 profile，可传入以避免对整段 `price_override` 再 `JSON.parse`。
 */
export function resolveChargedBillingPrices(options: {
	basisInputTokens: number;
	routePriceOverrideJson: string | null | undefined;
	routeNestedChargedProfileJson?: string | null | undefined;
	modelPricingProfileJson: string | null | undefined;
}): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	const nested =
		typeof options.routeNestedChargedProfileJson === 'string' &&
		options.routeNestedChargedProfileJson.trim() !== ''
			? options.routeNestedChargedProfileJson.trim()
			: null;
	const routeSub = nested ?? extractChargedProfileFromPriceOverrideJson(options.routePriceOverrideJson);
	const tryOrder: Array<{ json: string; source: 'route_nested' | 'model' }> = [];
	if (routeSub) {
		tryOrder.push({ json: routeSub, source: 'route_nested' });
	}
	if (options.modelPricingProfileJson?.trim()) {
		tryOrder.push({ json: options.modelPricingProfileJson.trim(), source: 'model' });
	}
	for (const c of tryOrder) {
		const parsed = parsePricingProfile(c.json);
		if (!parsed) {
			continue;
		}
		return materializeFromParsed(options.basisInputTokens, parsed, c.source);
	}
	return {
		prices: ZERO_BILLING_SNAPSHOT,
		audit: {
			path: 'missing_profile',
			source: 'model',
			basis_tokens: options.basisInputTokens,
			prices: ZERO_BILLING_SNAPSHOT,
		},
	};
}
