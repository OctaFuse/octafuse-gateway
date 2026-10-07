/**
 * OpenAI Images → 火山方舟 / BytePlus `POST /images/generations` 的请求与响应映射。
 * Proxy 驱动和 Admin 调试台共用。流式只走原生透传，这里固定非流式 JSON。
 */
import { VOLCENGINE_MAX_SEQUENTIAL_IMAGES } from './volcengine-native';

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
 * `n=1` 关闭组图；`n` 为 2–15 时打开组图并把 `max_images` 设为 `n`。
 * `quality`、`background`、`stream` 不转发。`image` 原样作为参考图。
 */
export function buildVolcengineImageBodyFromOpenAi(
	model: string,
	body: Record<string, unknown>,
): Record<string, unknown> {
	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (!prompt) throw new VolcengineOpenAiClientError('prompt is required');
	const n = imageCount(body.n);
	const upstream: Record<string, unknown> = {
		model,
		prompt,
		response_format: responseFormat(body.response_format),
		sequential_image_generation: n === 1 ? 'disabled' : 'auto',
	};
	if (n > 1) {
		upstream.sequential_image_generation_options = { max_images: n };
	}
	if (typeof body.size === 'string' && body.size.trim() !== '') {
		upstream.size = body.size.trim();
	}
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

function succeededImage(item: unknown): { url: string } | { b64_json: string } | null {
	const row = asObject(item);
	if (!row) return null;
	const url = typeof row.url === 'string' ? row.url.trim() : '';
	if (url) return { url };
	const b64 = typeof row.b64_json === 'string' ? row.b64_json.trim() : '';
	if (b64) return { b64_json: b64 };
	return null;
}

/** 方舟生图 JSON → OpenAI `{ created, data, usage }`。失败项从 `data` 去掉。 */
export function volcengineImageResponseToOpenAi(payload: unknown): {
	created: number;
	data: Array<{ url: string } | { b64_json: string }>;
	usage?: { generated_images: number };
} {
	const root = asObject(payload);
	const createdRaw = root?.created;
	const created =
		typeof createdRaw === 'number' && Number.isFinite(createdRaw)
			? Math.floor(createdRaw)
			: Math.floor(Date.now() / 1000);
	const data = Array.isArray(root?.data)
		? root.data.map(succeededImage).filter((item): item is { url: string } | { b64_json: string } => item != null)
		: [];
	const generated = asObject(root?.usage)?.generated_images;
	const usage =
		typeof generated === 'number' && Number.isFinite(generated) && generated >= 0
			? { generated_images: Math.floor(generated) }
			: undefined;
	return usage ? { created, data, usage } : { created, data };
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
