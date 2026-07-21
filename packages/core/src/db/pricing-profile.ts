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
 * **Image 双模式**（`image_billing_mode`）：
 * - **`token`**（缺省推断：无 mode 且 tier 含正 `image_*`）：tier `image_*` × 上游 usage 分项（OpenAI GPT Image）；须有非空 `tiers`。
 * - **`per_image`**（须显式 mode + `image` 块）：`image.default` / maps 按 quality×size 选 output 单价；可选 `image.input` 计参考图；`uncertain_result_policy` 控制未确认结果（默认 `requested`）。**不计价 `tiers`**（可省略；历史占位零档仍可解析）。
 * - **无 mode + 仅 legacy `image` 块**：解析可读入 `image`，但 **`resolveImageBillingMode` 返回 `null`（不计费）**；勿因 legacy 块自动恢复 per_image。
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

/** Image 按张计价：`image_billing_mode === 'per_image'` 时使用。 */
export type ImageBillingMode = 'token' | 'per_image';

/** 按张单价一侧（output 或 `image.input` 参考图）。 */
export type ImagePerSidePricing = {
	default: number;
	by_quality?: Record<string, number>;
	by_size?: Record<string, number>;
	by_quality_size?: Record<string, number>;
};

/** 按张 `image` 块：`default` / maps 为 output 侧；`input` 可选。 */
export type ImagePricingConfig = {
	default: number;
	by_quality?: Record<string, number>;
	by_size?: Record<string, number>;
	by_quality_size?: Record<string, number>;
	input?: ImagePerSidePricing;
	/** 上游未确认生成张数时的计费策略；缺省 `requested`。 */
	uncertain_result_policy?: 'requested' | 'zero';
};

export interface ParsedPricingProfile {
	/**
	 * Token / LLM 阶梯价。`image_billing_mode === 'per_image'` 时可为空数组（按张不计价 tiers）。
	 */
	tiers: PricingTierPrices[];
	/** 显式 Image 计费模式；缺省时由 `resolveImageBillingMode` 推断（legacy 仅 image 块 → null）。 */
	image_billing_mode?: ImageBillingMode;
	/** 按张目录价；`per_image` 模式计费时使用。 */
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

/** 是否配置了显式 per_image 按张目录价。 */
export function profileHasImagePerImagePricing(
	profile: ParsedPricingProfile | null | undefined
): boolean {
	if (!profile || profile.image_billing_mode !== 'per_image') {
		return false;
	}
	const d = profile.image?.default;
	return d != null && d >= 0;
}

/**
 * 解析 Image 计费模式：显式 `image_billing_mode` 优先；
 * 缺省时仅当 tier 含正 `image_*` 返回 `token`；否则 `null`（不计费）。
 * legacy 仅有 `image` 块时 **不** 推断为 per_image。
 */
export function resolveImageBillingMode(
	profile: ParsedPricingProfile | null | undefined
): ImageBillingMode | null {
	if (!profile) {
		return null;
	}
	if (profile.image_billing_mode === 'token' || profile.image_billing_mode === 'per_image') {
		return profile.image_billing_mode;
	}
	if (profileHasImageTokenPricing(profile)) {
		return 'token';
	}
	return null;
}

function lookupImageSideUnitPrice(
	cfg: ImagePerSidePricing,
	quality?: string | null,
	size?: string | null
): number {
	const q = quality?.trim().toLowerCase() ?? '';
	const s = size?.trim().toLowerCase() ?? '';
	if (q && s) {
		const qs = cfg.by_quality_size?.[`${q}:${s}`];
		if (qs != null) {
			return qs;
		}
	}
	if (q) {
		const byQ = cfg.by_quality?.[q];
		if (byQ != null) {
			return byQ;
		}
	}
	if (s) {
		const byS = cfg.by_size?.[s];
		if (byS != null) {
			return byS;
		}
	}
	return cfg.default;
}

/**
 * 按张目录选档单价（$/张）。lookup：by_quality_size → by_quality → by_size → default。
 * `side === 'input'` 时使用 `image.input`；缺省 input 侧单价为 0。
 */
export function resolveImageCatalogUnitPrice(
	imageCfg: ImagePricingConfig,
	quality?: string | null,
	size?: string | null,
	side: 'output' | 'input' = 'output'
): number {
	if (side === 'input') {
		if (!imageCfg.input) {
			return 0;
		}
		return lookupImageSideUnitPrice(imageCfg.input, quality, size);
	}
	return lookupImageSideUnitPrice(imageCfg, quality, size);
}

/** 按张 map：宽松读取——跳过非法条目，不因个别脏键整段失败。 */
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

function parseImageSidePricing(raw: unknown): ImagePerSidePricing | null | undefined {
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
	const cfg: ImagePerSidePricing = { default: defaultPrice };
	const byQuality = parseLooseNonNegativePriceMap(o.by_quality);
	if (byQuality) cfg.by_quality = byQuality;
	const bySize = parseLooseNonNegativePriceMap(o.by_size);
	if (bySize) cfg.by_size = bySize;
	const byQualitySize = parseLooseNonNegativePriceMap(o.by_quality_size);
	if (byQualitySize) cfg.by_quality_size = byQualitySize;
	return cfg;
}

/** `image` 块：有合法 default 即视为存在；maps / input / policy 尽力而为。 */
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
	const inputSide = parseImageSidePricing(o.input);
	if (inputSide === null) {
		return null;
	}
	if (inputSide) {
		cfg.input = inputSide;
	}
	const policyRaw = o.uncertain_result_policy;
	if (policyRaw !== undefined && policyRaw !== null) {
		if (policyRaw !== 'requested' && policyRaw !== 'zero') {
			return null;
		}
		cfg.uncertain_result_policy = policyRaw;
	}
	return cfg;
}

function parseImageBillingMode(raw: unknown): ImageBillingMode | null | 'invalid' {
	if (raw === undefined || raw === null) {
		return null;
	}
	if (raw === 'token' || raw === 'per_image') {
		return raw;
	}
	return 'invalid';
}

/**
 * 解析并校验 `pricing_profile` JSON 文本；不合法时返回 `null`（调用方按无 profile 处理，单价按 0）。
 * - Token / LLM：`{ "tiers": [ ... ], "image_billing_mode"?: "token", ... }`（`tiers` 必填非空）
 * - 按张：`{ "image_billing_mode": "per_image", "image": { ... } }`（`tiers` 可省略；若给出须合法）
 * 非法 `image_billing_mode` → 整段 `null`；`image` 非法时忽略该键（仍返回 tiers）。
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
	const modeParsed = parseImageBillingMode(o.image_billing_mode);
	if (modeParsed === 'invalid') {
		return null;
	}

	let tiers: PricingTierPrices[];
	if (modeParsed === 'per_image') {
		if (o.tiers === undefined || o.tiers === null) {
			tiers = [];
		} else if (Array.isArray(o.tiers) && o.tiers.length === 0) {
			tiers = [];
		} else {
			const parsed = parseTiersArray(o.tiers);
			if (!parsed) {
				return null;
			}
			tiers = parsed;
		}
	} else {
		const parsed = parseTiersArray(o.tiers);
		if (!parsed) {
			return null;
		}
		tiers = parsed;
	}

	const result: ParsedPricingProfile = { tiers };
	if (modeParsed === 'token' || modeParsed === 'per_image') {
		result.image_billing_mode = modeParsed;
	}
	if (o.image === undefined) {
		return result;
	}
	const image = parseImagePricingConfig(o.image);
	// 非法 / null image：忽略，避免历史脏数据拖垮整个 profile
	if (image == null) {
		return result;
	}
	result.image = image;
	return result;
}

const ZERO_TIER_PRICES: PricingTierPrices = {
	upto: null,
	label: null,
	input_price: 0,
	output_price: 0,
	cache_read_price: null,
	cache_write_price: null,
	image_input_price: null,
	image_input_cache_price: null,
	image_output_price: null,
};

/**
 * 按 `basis_tokens`（通常为上游 usage 的 `input_tokens`）选档：有限 `upto` 升序，命中第一个 `basis <= upto`；
 * 遇末档 **`upto === null`**（无限上界）则命中该档；否则若 `basis` 大于所有有限上界，使用最后一档。
 * `tiers` 为空（per_image-only profile）时返回零单价档，避免误走 Chat token 计费崩溃。
 */
export function pickPricingTier(basisTokens: number, profile: ParsedPricingProfile): PricingTierPrices {
	if (!profile.tiers.length) {
		return ZERO_TIER_PRICES;
	}
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
