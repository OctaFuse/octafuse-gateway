/**
 * OpenAI Images → Gemini `generateContent` 生图的请求与响应映射。
 * Proxy 驱动和 Admin 调试台共用。只出非流式 JSON；流式请走 Gemini 原生透传。
 */
import { parseGeminiImageUsage, type ImageTokenUsage } from './db/image-token-usage';
import { geminiImageBillingSize, isGeminiInlineImagePart } from './gemini-image-native';

export class GeminiOpenAiImageClientError extends Error {
	readonly status = 400;
	constructor(message: string) {
		super(message);
		this.name = 'GeminiOpenAiImageClientError';
	}
}

/** 各 Gemini 生图型号都支持的宽高比。`WxH` 换算到其中最接近的一档。 */
export const GEMINI_IMAGE_ASPECT_RATIOS = [
	'1:1',
	'2:3',
	'3:2',
	'3:4',
	'4:3',
	'4:5',
	'5:4',
	'9:16',
	'16:9',
	'21:9',
] as const;

const GEMINI_IMAGE_SIZE_TIERS: Record<string, string> = {
	'512': '512',
	'0.5k': '512',
	'1k': '1K',
	'2k': '2K',
	'4k': '4K',
};

/** 长边不超过这些像素时分别落到 1K / 2K，再大用 4K。OpenAI 的 1536x1024 仍算 1K。 */
const GEMINI_1K_MAX_LONG_SIDE = 1600;
const GEMINI_2K_MAX_LONG_SIDE = 3200;

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function ratioValue(ratio: string): number {
	const [w, h] = ratio.split(':').map(Number);
	return (w ?? 1) / (h ?? 1);
}

function nearestAspectRatio(width: number, height: number): string {
	const target = Math.log(width / height);
	let best: string = GEMINI_IMAGE_ASPECT_RATIOS[0];
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const ratio of GEMINI_IMAGE_ASPECT_RATIOS) {
		const distance = Math.abs(Math.log(ratioValue(ratio)) - target);
		if (distance < bestDistance) {
			best = ratio;
			bestDistance = distance;
		}
	}
	return best;
}

function sizeTierForLongSide(longSide: number): string {
	if (longSide <= GEMINI_1K_MAX_LONG_SIDE) return '1K';
	if (longSide <= GEMINI_2K_MAX_LONG_SIDE) return '2K';
	return '4K';
}

export type GeminiImageConfigFromSize = { aspectRatio?: string; imageSize?: string };

/**
 * OpenAI `size` → Gemini `imageConfig`。
 * - `WxH`：宽高比取最接近的一档，分辨率按长边落到 1K / 2K / 4K。
 * - `512` / `1K` / `2K` / `4K`：只设分辨率，比例交给上游默认。
 * - 缺省或 `auto`：都不设。
 */
export function geminiImageConfigFromOpenAiSize(size: unknown): GeminiImageConfigFromSize {
	if (size == null || size === '') return {};
	if (typeof size !== 'string') throw new GeminiOpenAiImageClientError('size must be a string');
	const raw = size.trim();
	if (raw === '' || raw.toLowerCase() === 'auto') return {};
	const tier = GEMINI_IMAGE_SIZE_TIERS[raw.toLowerCase()];
	if (tier) return { imageSize: tier };
	const match = /^(\d{2,5})\s*[x*×]\s*(\d{2,5})$/i.exec(raw);
	if (match) {
		const width = Number(match[1]);
		const height = Number(match[2]);
		if (width > 0 && height > 0) {
			return {
				aspectRatio: nearestAspectRatio(width, height),
				imageSize: sizeTierForLongSide(Math.max(width, height)),
			};
		}
	}
	throw new GeminiOpenAiImageClientError('size must be WIDTHxHEIGHT, auto, 512, 1K, 2K, or 4K');
}

/** 预检用分辨率档。客户端额外字段里的 `generationConfig.imageConfig.imageSize` 优先，其次换算 `size`。 */
export function geminiOpenAiImageBillingSize(size: unknown, extras: Record<string, unknown> = {}): string {
	const fromExtras = geminiImageBillingSize(extras);
	if (fromExtras !== 'auto') return fromExtras;
	try {
		return geminiImageConfigFromOpenAiSize(size).imageSize?.toLowerCase() ?? 'auto';
	} catch {
		return 'auto';
	}
}

function imageCount(value: unknown): void {
	if (value == null || value === '') return;
	const raw = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (raw !== 1) throw new GeminiOpenAiImageClientError('n must be 1');
}

function responseFormat(value: unknown): void {
	if (value == null || value === '') return;
	if (typeof value !== 'string' || value.trim().toLowerCase() !== 'b64_json') {
		throw new GeminiOpenAiImageClientError('response_format must be b64_json: Gemini returns image bytes, not URLs');
	}
}

function dataUrlPart(value: string): Record<string, unknown> {
	const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value);
	if (!match) {
		throw new GeminiOpenAiImageClientError('image must be a base64 data URL (data:image/png;base64,...)');
	}
	const mimeType = match[1]!.trim().toLowerCase();
	if (!mimeType.startsWith('image/')) {
		throw new GeminiOpenAiImageClientError('image must be an image data URL');
	}
	return { inlineData: { mimeType, data: match[2]!.trim() } };
}

function referenceParts(value: unknown): Record<string, unknown>[] {
	if (value == null || value === '') return [];
	const items = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
	if (!items) throw new GeminiOpenAiImageClientError('image must be a data URL string or an array of data URLs');
	return items
		.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
		.map((item) => dataUrlPart(item.trim()));
}

/**
 * OpenAI Images generations → Gemini `generateContent`。
 * prompt 与参考图（`image` 里的 data URL）放进同一条 user 消息。
 * `quality`、`background`、`style`、`output_format` 上游没有对应字段，不转发。
 */
export function buildGeminiImageBodyFromOpenAi(body: Record<string, unknown>): Record<string, unknown> {
	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (!prompt) throw new GeminiOpenAiImageClientError('prompt is required');
	imageCount(body.n);
	responseFormat(body.response_format);
	const imageConfig = geminiImageConfigFromOpenAiSize(body.size);
	const generationConfig: Record<string, unknown> = { responseModalities: ['TEXT', 'IMAGE'] };
	if (imageConfig.aspectRatio || imageConfig.imageSize) generationConfig.imageConfig = { ...imageConfig };
	return {
		contents: [{ role: 'user', parts: [{ text: prompt }, ...referenceParts(body.image)] }],
		generationConfig,
	};
}

export type GeminiOpenAiImageResponse = {
	created: number;
	data: Array<{ b64_json: string }>;
	output_format?: string;
	usage?: {
		input_tokens: number;
		input_tokens_details: { text_tokens: number; image_tokens: number; cached_tokens: number };
		output_tokens: number;
		output_tokens_details: { text_tokens: number; image_tokens: number };
		total_tokens: number;
	};
};

function outputFormatFromMime(mime: unknown): string | undefined {
	if (typeof mime !== 'string') return undefined;
	const subtype = mime.trim().toLowerCase().replace(/^image\//, '');
	if (subtype === 'png' || subtype === 'webp') return subtype;
	if (subtype === 'jpeg' || subtype === 'jpg') return 'jpeg';
	return undefined;
}

function openAiUsage(usage: ImageTokenUsage): NonNullable<GeminiOpenAiImageResponse['usage']> {
	const input = usage.text_tokens + usage.image_input_tokens;
	const output = usage.text_output_tokens + usage.image_output_tokens;
	return {
		input_tokens: input,
		input_tokens_details: {
			text_tokens: usage.text_tokens,
			image_tokens: usage.image_input_tokens,
			cached_tokens: usage.cached_text_tokens + usage.cached_image_input_tokens,
		},
		output_tokens: output,
		output_tokens_details: {
			text_tokens: usage.text_output_tokens,
			image_tokens: usage.image_output_tokens,
		},
		total_tokens: Math.max(usage.total_tokens, input + output),
	};
}

/** Gemini `usageMetadata` 换成计费用的 token 分项。 */
export function geminiImageUsageFromResponse(payload: unknown): ImageTokenUsage | null {
	const root = asObject(payload);
	return parseGeminiImageUsage(root?.usageMetadata ?? root?.usage_metadata ?? null);
}

/** Gemini 生图 JSON → OpenAI `{ created, data[{ b64_json }], usage }`。thought 图和文本 part 不进 `data`。 */
export function geminiImageResponseToOpenAi(payload: unknown): GeminiOpenAiImageResponse {
	const root = asObject(payload);
	const data: Array<{ b64_json: string }> = [];
	let outputFormat: string | undefined;
	const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
	for (const candidate of candidates) {
		const parts = asObject(asObject(candidate)?.content)?.parts;
		if (!Array.isArray(parts)) continue;
		for (const part of parts) {
			if (!isGeminiInlineImagePart(part)) continue;
			const row = asObject(part)!;
			const inline = (asObject(row.inlineData) ?? asObject(row.inline_data))!;
			data.push({ b64_json: String(inline.data).trim() });
			outputFormat ??= outputFormatFromMime(inline.mimeType ?? inline.mime_type);
		}
	}
	const usage = geminiImageUsageFromResponse(payload);
	return {
		created: Math.floor(Date.now() / 1000),
		data,
		...(outputFormat ? { output_format: outputFormat } : {}),
		...(usage ? { usage: openAiUsage(usage) } : {}),
	};
}

/** 没出图时给客户端的说明：先看 promptFeedback，再看 finishReason 与文本回复。 */
export function geminiImageFailureMessage(payload: unknown): string {
	const root = asObject(payload);
	const blockReason = asObject(root?.promptFeedback)?.blockReason;
	if (typeof blockReason === 'string' && blockReason.trim() !== '') {
		return `Gemini blocked the prompt (${blockReason.trim()})`;
	}
	const candidate = Array.isArray(root?.candidates) ? asObject(root.candidates[0]) : null;
	const finishReason = typeof candidate?.finishReason === 'string' ? candidate.finishReason.trim() : '';
	const parts = asObject(candidate?.content)?.parts;
	const text = Array.isArray(parts)
		? parts
				.map((part) => asObject(part))
				.filter((part) => part && part.thought !== true && typeof part.text === 'string')
				.map((part) => String(part!.text).trim())
				.filter(Boolean)
				.join(' ')
		: '';
	const detail = [finishReason ? `finishReason=${finishReason}` : '', text.slice(0, 300)].filter(Boolean).join(': ');
	return detail ? `Gemini returned no image (${detail})` : 'Gemini returned no image';
}
