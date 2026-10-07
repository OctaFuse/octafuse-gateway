/**
 * OpenAI Images → 火山方舟 / BytePlus `POST /images/generations` 的请求与响应映射。
 * Proxy 驱动和 Admin 调试台共用。流式只走原生透传，这里固定非流式 JSON。
 */
import { VOLCENGINE_MAX_SEQUENTIAL_IMAGES, isVolcengineSingleImageModel } from './volcengine-native';

export class VolcengineOpenAiClientError extends Error {
	readonly status = 400;
	constructor(message: string) {
		super(message);
		this.name = 'VolcengineOpenAiClientError';
	}
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function imageCount(value: unknown): number {
	if (value == null || value === '') return 1;
	const raw = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (
		typeof raw !== 'number' ||
		!Number.isInteger(raw) ||
		raw < 1 ||
		raw > VOLCENGINE_MAX_SEQUENTIAL_IMAGES
	) {
		throw new VolcengineOpenAiClientError(
			`n must be an integer between 1 and ${VOLCENGINE_MAX_SEQUENTIAL_IMAGES}`,
		);
	}
	return raw;
}

function responseFormat(value: unknown): 'url' | 'b64_json' {
	if (value == null || value === '') return 'url';
	if (typeof value !== 'string') {
		throw new VolcengineOpenAiClientError('response_format must be url or b64_json');
	}
	const format = value.trim().toLowerCase();
	if (format === 'url' || format === 'b64_json') return format;
	throw new VolcengineOpenAiClientError('response_format must be url or b64_json');
}

function optionalString(value: unknown, field: string): string | undefined {
	if (value == null || value === '') return undefined;
	if (typeof value !== 'string') throw new VolcengineOpenAiClientError(`${field} must be a string`);
	const trimmed = value.trim().toLowerCase();
	return trimmed || undefined;
}

/** OpenAI `auto` 交给方舟按模型默认值处理；方舟只在图层拆分里接受 `auto`。 */
function imageSize(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (!trimmed || trimmed.toLowerCase() === 'auto') return undefined;
	return trimmed;
}

/** 方舟只有 5.0 pro / flash 支持透明背景，且只用于图生图。 */
function background(value: unknown): 'transparent' | 'opaque' | undefined {
	const v = optionalString(value, 'background');
	if (v === undefined || v === 'auto') return undefined;
	if (v === 'transparent' || v === 'opaque') return v;
	throw new VolcengineOpenAiClientError('background must be transparent, opaque, or auto');
}

/** 方舟只出 png / jpeg；OpenAI 的 webp 没有对应项。 */
function outputFormat(value: unknown): 'png' | 'jpeg' | undefined {
	const v = optionalString(value, 'output_format');
	if (v === undefined) return undefined;
	if (v === 'png') return 'png';
	if (v === 'jpeg' || v === 'jpg') return 'jpeg';
	throw new VolcengineOpenAiClientError('output_format must be png or jpeg');
}

function referenceImage(value: unknown): string | string[] | undefined {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed || undefined;
	}
	if (!Array.isArray(value)) return undefined;
	const items = value
		.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
		.map((item) => item.trim());
	if (items.length === 0) return undefined;
	return items.length === 1 ? items[0] : items;
}

/**
 * OpenAI Images generations → 方舟生图。
 * `n=1` 不带组图字段（方舟默认单图，5.0 pro / flash 也不接受该字段）；
 * `n` 为 2–15 时打开组图并把 `max_images` 设为 `n`，5.0 pro / flash 不支持组图。
 * `quality`、`stream` 不转发；`size=auto` 与 `background=auto` 交给方舟默认值。`image` 原样作为参考图。
 */
export function buildVolcengineImageBodyFromOpenAi(
	model: string,
	body: Record<string, unknown>,
): Record<string, unknown> {
	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (!prompt) throw new VolcengineOpenAiClientError('prompt is required');
	const n = imageCount(body.n);
	if (n > 1 && isVolcengineSingleImageModel(model)) {
		throw new VolcengineOpenAiClientError(
			`n must be 1 for ${model}: Seedream 5.0 pro / flash do not support group generation`,
		);
	}
	const upstream: Record<string, unknown> = {
		model,
		prompt,
		response_format: responseFormat(body.response_format),
	};
	if (n > 1) {
		upstream.sequential_image_generation = 'auto';
		upstream.sequential_image_generation_options = { max_images: n };
	}
	const size = imageSize(body.size);
	if (size) upstream.size = size;
	const bg = background(body.background);
	if (bg) upstream.background = bg;
	const format = outputFormat(body.output_format);
	if (format) upstream.output_format = format;
	if (typeof body.watermark === 'boolean') upstream.watermark = body.watermark;
	const image = referenceImage(body.image);
	if (image !== undefined) upstream.image = image;
	if (
		body.optimize_prompt_options != null &&
		typeof body.optimize_prompt_options === 'object' &&
		!Array.isArray(body.optimize_prompt_options)
	) {
		upstream.optimize_prompt_options = body.optimize_prompt_options;
	}
	return upstream;
}

export type VolcengineOpenAiImageItem = ({ url: string } | { b64_json: string }) & Record<string, unknown>;

/**
 * 成功项保留方舟原字段（`size`、`output_format`，图层拆分的 `z_index`、`bounding_box` 等），
 * 只把 `url` / `b64_json` 去掉首尾空白。失败项返回 null。
 */
function succeededImage(item: unknown): VolcengineOpenAiImageItem | null {
	const row = asObject(item);
	if (!row) return null;
	const { error: _error, url: rawUrl, b64_json: rawB64, ...rest } = row;
	const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
	if (url) return { ...rest, url };
	const b64 = typeof rawB64 === 'string' ? rawB64.trim() : '';
	if (b64) return { ...rest, b64_json: b64 };
	return null;
}

/** 方舟生图 JSON → OpenAI `{ created, data, usage }`。失败项从 `data` 去掉，`usage` 保持方舟原样。 */
export function volcengineImageResponseToOpenAi(payload: unknown): {
	created: number;
	data: VolcengineOpenAiImageItem[];
	usage?: Record<string, unknown>;
} {
	const root = asObject(payload);
	const createdRaw = root?.created;
	const created =
		typeof createdRaw === 'number' && Number.isFinite(createdRaw)
			? Math.floor(createdRaw)
			: Math.floor(Date.now() / 1000);
	const data = Array.isArray(root?.data)
		? root.data.map(succeededImage).filter((item): item is VolcengineOpenAiImageItem => item != null)
		: [];
	const usage = asObject(root?.usage);
	return usage ? { created, data, usage: { ...usage } } : { created, data };
}

/** 全部失败时给客户端的说明。优先 `data[].error.message`，再看顶层 `error.message`。 */
export function firstVolcengineImageFailureMessage(payload: unknown): string | null {
	const root = asObject(payload);
	const data = Array.isArray(root?.data) ? root.data : [];
	for (const item of data) {
		const message = asObject(asObject(item)?.error)?.message;
		if (typeof message === 'string' && message.trim() !== '') return message.trim();
	}
	const top = asObject(root?.error)?.message;
	if (typeof top === 'string' && top.trim() !== '') return top.trim();
	return null;
}
