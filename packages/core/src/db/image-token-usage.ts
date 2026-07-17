/**
 * OpenAI Images API usage 解析与按 token 分项计费（对齐官方 GPT Image 定价）。
 * 费用 = text_in×input + cached_text×cache_read + image_in×image_input + cached_image_in×image_input_cache + image_out×image_output（$/1M）。
 */
import type { BillingPriceSnapshot } from './pricing-profile';

const TOKENS_PER_MILLION = 1_000_000;

/** 上游 Images `usage` 标准化分项。 */
export type ImageTokenUsage = {
	text_tokens: number;
	/** cached text input（若上游拆出；否则 0） */
	cached_text_tokens: number;
	image_input_tokens: number;
	cached_image_input_tokens: number;
	image_output_tokens: number;
	total_tokens: number;
	/** 原始 usage JSON 字符串 */
	raw_usage: string | null;
};

export const EMPTY_IMAGE_TOKEN_USAGE: ImageTokenUsage = {
	text_tokens: 0,
	cached_text_tokens: 0,
	image_input_tokens: 0,
	cached_image_input_tokens: 0,
	image_output_tokens: 0,
	total_tokens: 0,
	raw_usage: null,
};

function asNonNegInt(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
		return Math.floor(v);
	}
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		if (Number.isFinite(n) && n >= 0) {
			return Math.floor(n);
		}
	}
	return 0;
}

/**
 * 解析 OpenAI Images generations/edits 响应中的 `usage`。
 * 支持 `input_tokens_details` / `output_tokens_details`；缺 details 时用合计字段兜底。
 */
export function parseOpenAiImageUsage(body: unknown): ImageTokenUsage | null {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return null;
	}
	const usage = (body as Record<string, unknown>).usage;
	if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
		return null;
	}
	const u = usage as Record<string, unknown>;
	const inputDetails =
		u.input_tokens_details && typeof u.input_tokens_details === 'object' && !Array.isArray(u.input_tokens_details)
			? (u.input_tokens_details as Record<string, unknown>)
			: null;
	const outputDetails =
		u.output_tokens_details &&
		typeof u.output_tokens_details === 'object' &&
		!Array.isArray(u.output_tokens_details)
			? (u.output_tokens_details as Record<string, unknown>)
			: null;

	let text_tokens = inputDetails ? asNonNegInt(inputDetails.text_tokens) : 0;
	let image_input_tokens = inputDetails ? asNonNegInt(inputDetails.image_tokens) : 0;
	let image_output_tokens = outputDetails ? asNonNegInt(outputDetails.image_tokens) : 0;

	const inputTotal = asNonNegInt(u.input_tokens);
	const outputTotal = asNonNegInt(u.output_tokens);

	if (!inputDetails && inputTotal > 0) {
		// 无拆分时把 input 全部记为 text（generations 常见）
		text_tokens = inputTotal;
	}
	if (!outputDetails && outputTotal > 0) {
		image_output_tokens = outputTotal;
	}

	// 部分响应可能把 cached 放在 details 扩展字段
	const cached_text_tokens = inputDetails
		? asNonNegInt(inputDetails.cached_text_tokens ?? inputDetails.cache_tokens)
		: 0;
	const cached_image_input_tokens = inputDetails
		? asNonNegInt(inputDetails.cached_image_tokens)
		: 0;

	const total_tokens = asNonNegInt(u.total_tokens) || text_tokens + image_input_tokens + image_output_tokens;
	let raw_usage: string | null = null;
	try {
		raw_usage = JSON.stringify(usage);
	} catch {
		raw_usage = null;
	}

	if (
		text_tokens === 0 &&
		image_input_tokens === 0 &&
		image_output_tokens === 0 &&
		total_tokens === 0
	) {
		return { ...EMPTY_IMAGE_TOKEN_USAGE, raw_usage };
	}

	return {
		text_tokens,
		cached_text_tokens,
		image_input_tokens,
		cached_image_input_tokens,
		image_output_tokens,
		total_tokens,
		raw_usage,
	};
}

/** 按 BillingPriceSnapshot 与 ImageTokenUsage 计算原始成本（未乘路由倍率）。 */
export function computeImageTokenMeteredCost(
	usage: ImageTokenUsage,
	prices: BillingPriceSnapshot
): number {
	const textPrice = prices.input_price ?? 0;
	const cachedTextPrice = prices.cache_read_price ?? textPrice;
	const imageInPrice = prices.image_input_price ?? 0;
	const cachedImageInPrice = prices.image_input_cache_price ?? imageInPrice;
	const imageOutPrice = prices.image_output_price ?? 0;

	const uncachedText = Math.max(0, usage.text_tokens - usage.cached_text_tokens);
	const uncachedImageIn = Math.max(0, usage.image_input_tokens - usage.cached_image_input_tokens);

	return (
		(uncachedText * textPrice +
			usage.cached_text_tokens * cachedTextPrice +
			uncachedImageIn * imageInPrice +
			usage.cached_image_input_tokens * cachedImageInPrice +
			usage.image_output_tokens * imageOutPrice) /
		TOKENS_PER_MILLION
	);
}

/**
 * 官方计算器输出侧估算美元（image output only）÷ $30/1M → 预估 image output tokens。
 * 用于预检与 Admin 估算表；`auto` / 未知 quality×size 取表内上界（偏保守）。
 * 核对来源：OpenAI Image generation Calculating costs（GPT Image 2）。
 */
export const GPT_IMAGE_2_ESTIMATED_OUTPUT_TOKENS: Record<string, number> = {
	'low:1024x1024': 200,
	'low:1024x1536': 167,
	'low:1536x1024': 167,
	'low:auto': 200,
	'medium:1024x1024': 1767,
	'medium:1024x1536': 1367,
	'medium:1536x1024': 1367,
	'medium:auto': 1767,
	'high:1024x1024': 7033,
	'high:1024x1536': 5500,
	'high:1536x1024': 5500,
	'high:auto': 7033,
	'auto:1024x1024': 1767,
	'auto:1024x1536': 1367,
	'auto:1536x1024': 1367,
	'auto:auto': 1767,
};

const KNOWN_QUALITIES = ['low', 'medium', 'high'] as const;
const KNOWN_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const;

/** 预检：短 prompt 文本余量 */
export const IMAGE_PRECHECK_TEXT_TOKEN_HEADROOM = 2_000;
/** 预检：每张 edits 参考图 image input 余量 */
export const IMAGE_PRECHECK_IMAGE_INPUT_TOKEN_HEADROOM = 4_000;
/** 与 Proxy edits 上限对齐（见 openai-images-driver IMAGE_MAX_REFERENCE_COUNT） */
export const IMAGE_PRECHECK_MAX_REFERENCE_COUNT = 5;

function maxEstimatedOutputTokensInTable(): number {
	let max = 0;
	for (const v of Object.values(GPT_IMAGE_2_ESTIMATED_OUTPUT_TOKENS)) {
		if (v > max) max = v;
	}
	return max > 0 ? max : 7033;
}

/**
 * 预检用 image output tokens：精确命中表项则用之；
 * `auto` 或未知 quality/size 取表内对应维度上界（真正保守）。
 */
export function estimateImageOutputTokensForPrecheck(
	quality?: string | null,
	size?: string | null
): number {
	const qRaw = (quality?.trim().toLowerCase() || 'auto') || 'auto';
	const sRaw = (size?.trim().toLowerCase() || 'auto') || 'auto';
	const exact = GPT_IMAGE_2_ESTIMATED_OUTPUT_TOKENS[`${qRaw}:${sRaw}`];
	if (exact != null && qRaw !== 'auto' && sRaw !== 'auto') {
		return exact;
	}

	const qualities: readonly string[] =
		qRaw === 'auto' || !KNOWN_QUALITIES.includes(qRaw as (typeof KNOWN_QUALITIES)[number])
			? KNOWN_QUALITIES
			: [qRaw];
	const sizes: readonly string[] =
		sRaw === 'auto' || !KNOWN_SIZES.includes(sRaw as (typeof KNOWN_SIZES)[number])
			? KNOWN_SIZES
			: [sRaw];

	let max = 0;
	for (const q of qualities) {
		for (const s of sizes) {
			const v = GPT_IMAGE_2_ESTIMATED_OUTPUT_TOKENS[`${q}:${s}`];
			if (v != null && v > max) max = v;
		}
	}
	return max > 0 ? max : maxEstimatedOutputTokensInTable();
}

/** 构建预检用的 ImageTokenUsage（偏保守上界）。 */
export function buildImagePrecheckUsage(options: {
	quality?: string | null;
	size?: string | null;
	/** generations=false → edits，加 image input 余量 */
	isEdit?: boolean;
	imageCount?: number;
	/** edits 参考图张数；缺省按上限 5 保守估算 */
	referenceCount?: number;
}): ImageTokenUsage {
	const n = Math.max(1, Math.floor(options.imageCount ?? 1));
	const perImageOut = estimateImageOutputTokensForPrecheck(options.quality, options.size);
	const refs = options.isEdit
		? Math.min(
				IMAGE_PRECHECK_MAX_REFERENCE_COUNT,
				Math.max(
					1,
					Math.floor(
						options.referenceCount != null && Number.isFinite(options.referenceCount)
							? options.referenceCount
							: IMAGE_PRECHECK_MAX_REFERENCE_COUNT
					)
				)
			)
		: 0;
	const imageIn = refs * IMAGE_PRECHECK_IMAGE_INPUT_TOKEN_HEADROOM;
	return {
		text_tokens: IMAGE_PRECHECK_TEXT_TOKEN_HEADROOM,
		cached_text_tokens: 0,
		image_input_tokens: imageIn,
		cached_image_input_tokens: 0,
		image_output_tokens: perImageOut * n,
		total_tokens: IMAGE_PRECHECK_TEXT_TOKEN_HEADROOM + imageIn + perImageOut * n,
		raw_usage: null,
	};
}
