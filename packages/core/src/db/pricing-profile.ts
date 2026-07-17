/**
 * `models.pricing_profile`（目录标准价）解析与选档。
 * 路由侧金额 = 目录选档单价 × `price_override` 的 base factor × 每日 `schedule` 倍率（见 `pricing-schedule.ts`）。
 * `price_override` 内历史 nested `metered` / `charged` tiers **不计价**（运行时忽略）。
 * 单价数值币种见 `system_config.BILLING_CURRENCY`（ISO 4217，默认 USD），与 `api_keys` 预算同币。
 *
 * **Token 形状**：`{ "tiers": [ { "upto", "label", "input_price", "output_price", "cache_read_price"?, "cache_write_price"?, "image_input_price"?, "image_input_cache_price"?, "image_output_price"? } ] }`。
 * 单档固定价：仅一档，末档 **`upto` 为 JSON `null`** 表示输入 token 上界无限。
 * 多档阶梯：非末档 `upto` 为有限数字 **≥ 0**；末档 **`upto` 为 `null`**（无限上界）或有限上界；选档 basis 为上游 **`input_tokens`**。
 *
 * **图片 token 计价（OpenAI GPT Image）**：用 tier 上 `image_*` 单价 × 上游 `usage` 分项（text / image input / image output）。
 *
 * **Legacy `image` 块**：历史按张配置；**不计费**。解析时仍可读入供 Kind 兜底等，Admin 不再写入。
 */

/** 每百万 token 单价快照（与 `usage-tracker.computeMeteredCost` / image token 计费对齐）。 */
export type BillingPriceSnapshot = {
	input_price: number | null;
	output_price: number | null;
	cache_read_price: number | null;
	cache_write_price: number | null;
	/** Image API：参考图 / edits 的 image input（$/1M） */
	image_input_price: number | null;
	/** Image API：cached image input（$/1M） */
	image_input_cache_price: number | null;
	/** Image API：生成图的 image output（$/1M） */
	image_output_price: number | null;
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
	image_input_price: number | null;
	image_input_cache_price: number | null;
	image_output_price: number | null;
}

/**
 * Legacy 按张块（仅历史数据 / Kind 兜底；**不计费**）。
 * @deprecated 勿再写入；Image 请用 tier `image_*` 单价。
 */
export type ImagePricingConfig = {
	default: number;
	by_quality?: Record<string, number>;
	by_size?: Record<string, number>;
	by_quality_size?: Record<string, number>;
};

export interface ParsedPricingProfile {
	tiers: PricingTierPrices[];
	/**
	 * Legacy 按张块（若存在）。**不参与扣费**；仅 Kind 判定等只读用途。
	 * @deprecated
	 */
	image?: ImagePricingConfig | null;
}

/** 单次计费侧解析结果，写入 `api_key_request_logs.pricing_audit.snapshot` 子树。 */
export type PriceResolutionAuditSide = {
	path: 'profile' | 'missing_profile';
	/** 目录选档后乘路由倍率；`model` 仅用于 standard（无路由倍率）。 */
	source?: 'model_x_factor' | 'model';
	basis_tokens?: number;
	prices?: BillingPriceSnapshot;
	base_factor?: number;
	schedule?: {
		timezone: string;
		local_time: string;
		evaluated_at_utc: string;
		factor: number;
		window: { start: string; end: string; factor: number } | null;
	};
	effective_factor?: number;
};

const ZERO_BILLING_SNAPSHOT: BillingPriceSnapshot = {
	input_price: 0,
	output_price: 0,
	cache_read_price: 0,
	cache_write_price: 0,
	image_input_price: 0,
	image_input_cache_price: 0,
	image_output_price: 0,
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

/** 可选单价：空 → null；有限非负 → number；负数 → `'invalid'`（整段 profile 拒绝）。 */
function asNonNegativeOptionalPrice(v: unknown): number | null | 'invalid' {
	if (v === undefined || v === null || v === '') {
		return null;
	}
	const n = asFiniteNumber(v);
	if (n == null) {
		return 'invalid';
	}
	if (n < 0) {
		return 'invalid';
	}
	return n;
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
 * @deprecated Nested `charged` tiers are ignored at billing time; kept for Admin display of legacy JSON.
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
 * @deprecated Nested `metered` tiers are ignored at billing time; kept for Admin display of legacy JSON.
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
		const image_input_price = asNonNegativeOptionalPrice(row.image_input_price);
		const image_input_cache_price = asNonNegativeOptionalPrice(row.image_input_cache_price);
		const image_output_price = asNonNegativeOptionalPrice(row.image_output_price);
		// 显式负数视为非法 profile（避免负单价抵扣预算）
		if (
			image_input_price === 'invalid' ||
			image_input_cache_price === 'invalid' ||
			image_output_price === 'invalid'
		) {
			return null;
		}
		tiers.push({
			upto,
			label: tierLabelFromRow(row),
			input_price,
			output_price,
			cache_read_price: asOptionalPrice(row.cache_read_price),
			cache_write_price: asOptionalPrice(row.cache_write_price),
			image_input_price,
			image_input_cache_price,
			image_output_price,
		});
	}
	return tiers;
}

/** 是否配置了 Image token 分项单价（OpenAI GPT Image 路径）。 */
export function profileHasImageTokenPricing(
	profile: ParsedPricingProfile | null | undefined
): boolean {
	if (!profile?.tiers?.length) {
		return false;
	}
	for (const t of profile.tiers) {
		if (
			(t.image_output_price != null && t.image_output_price > 0) ||
			(t.image_input_price != null && t.image_input_price > 0)
		) {
			return true;
		}
	}
	return false;
}

/**
 * Legacy 按张 map：宽松读取——跳过非法条目，不因个别脏键整段失败。
 * 仅供 Kind 兜底展示；不计费。
 */
function parseLooseNonNegativePriceMap(raw: unknown): Record<string, number> | undefined {
	if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		const key = String(k).trim().toLowerCase();
		if (!key) continue;
		const n = asFiniteNumber(v);
		if (n == null || n < 0) continue;
		out[key] = n;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Legacy `image` 块：有合法 default 即视为存在（Kind 兜底）；maps 尽力而为。 */
function parseImagePricingConfig(raw: unknown): ImagePricingConfig | null | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (raw === null) {
		return null;
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return null;
	}
	const o = raw as Record<string, unknown>;
	const defaultPrice = asFiniteNumber(o.default);
	if (defaultPrice == null || defaultPrice < 0) {
		return null;
	}
	const cfg: ImagePricingConfig = { default: defaultPrice };
	const byQuality = parseLooseNonNegativePriceMap(o.by_quality);
	if (byQuality) cfg.by_quality = byQuality;
	const bySize = parseLooseNonNegativePriceMap(o.by_size);
	if (bySize) cfg.by_size = bySize;
	const byQualitySize = parseLooseNonNegativePriceMap(o.by_quality_size);
	if (byQualitySize) cfg.by_quality_size = byQualitySize;
	return cfg;
}

/**
 * 解析并校验 `pricing_profile` JSON 文本；不合法时返回 `null`（调用方按无 profile 处理，单价按 0）。
 * 接受 **`{ "tiers": [ ... ], "image"?: { ... } }`**；`image` 非法时忽略该键（仍返回 tiers），不计费。
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
	if (o.image === undefined) {
		return { tiers };
	}
	const image = parseImagePricingConfig(o.image);
	// 非法 / null image：忽略，避免历史脏数据拖垮整个 profile
	if (image == null) {
		return { tiers };
	}
	return { tiers, image };
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
	source: 'model_x_factor' | 'model'
): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	const tier = pickPricingTier(basisInputTokens, parsed);
	const prices: BillingPriceSnapshot = {
		input_price: tier.input_price,
		output_price: tier.output_price,
		cache_read_price: tier.cache_read_price,
		cache_write_price: tier.cache_write_price,
		image_input_price: tier.image_input_price,
		image_input_cache_price: tier.image_input_cache_price,
		image_output_price: tier.image_output_price,
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

function resolveCatalogBillingPrices(options: {
	basisInputTokens: number;
	modelPricingProfileJson: string | null | undefined;
	source: 'model_x_factor' | 'model';
}): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	if (options.modelPricingProfileJson?.trim()) {
		const parsed = parsePricingProfile(options.modelPricingProfileJson.trim());
		if (parsed) {
			return materializeFromParsed(options.basisInputTokens, parsed, options.source);
		}
	}
	return {
		prices: ZERO_BILLING_SNAPSHOT,
		audit: {
			path: 'missing_profile',
			source: options.source === 'model_x_factor' ? 'model_x_factor' : 'model',
			basis_tokens: options.basisInputTokens,
			prices: ZERO_BILLING_SNAPSHOT,
		},
	};
}

/**
 * 供应侧基数单价：始终来自 `models.pricing_profile`（忽略 route nested `metered`）。
 * 调用方再乘 `metered_factor × schedule.metered`。
 */
export function resolveSupplierBillingPrices(options: {
	basisInputTokens: number;
	/** @deprecated Ignored; nested metered tiers are not used for billing. */
	routePriceOverrideJson?: string | null | undefined;
	/** @deprecated Ignored. */
	routeNestedMeteredProfileJson?: string | null | undefined;
	modelPricingProfileJson: string | null | undefined;
}): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	return resolveCatalogBillingPrices({
		basisInputTokens: options.basisInputTokens,
		modelPricingProfileJson: options.modelPricingProfileJson,
		source: 'model_x_factor',
	});
}

/**
 * 标准价侧单价：仅 `models.pricing_profile`；无合法 profile 时单价为 0。
 */
export function resolveStandardBillingPrices(options: {
	basisInputTokens: number;
	modelPricingProfileJson: string | null | undefined;
}): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	return resolveCatalogBillingPrices({
		basisInputTokens: options.basisInputTokens,
		modelPricingProfileJson: options.modelPricingProfileJson,
		source: 'model',
	});
}

/**
 * 用户预算侧基数单价：始终来自 `models.pricing_profile`（忽略 route nested `charged`）。
 * 调用方再乘 `charged_factor × schedule.charged`。
 */
export function resolveChargedBillingPrices(options: {
	basisInputTokens: number;
	/** @deprecated Ignored; nested charged tiers are not used for billing. */
	routePriceOverrideJson?: string | null | undefined;
	/** @deprecated Ignored. */
	routeNestedChargedProfileJson?: string | null | undefined;
	modelPricingProfileJson: string | null | undefined;
}): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	return resolveCatalogBillingPrices({
		basisInputTokens: options.basisInputTokens,
		modelPricingProfileJson: options.modelPricingProfileJson,
		source: 'model_x_factor',
	});
}
