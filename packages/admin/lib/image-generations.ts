/**
 * Shared helpers for Admin Playground / Simulator image APIs
 * (`/images/generations` JSON and `/images/edits` multipart).
 */
import { isImageGenerationModel, type ModelKindFields } from '@octafuse/core/db/model-modalities';

/** OpenAI Images operation: text-to-image vs image edit. */
export type ImageOperation = 'generations' | 'edits';

/** Align with Proxy `openai-images-driver` limits (admin must not depend on `@octafuse/proxy`). */
export const IMAGE_MAX_REFERENCE_COUNT = 5;
export const IMAGE_MAX_BYTES_PER_FILE = 20 * 1024 * 1024;
export const IMAGE_MAX_TOTAL_UPLOAD_BYTES = IMAGE_MAX_REFERENCE_COUNT * IMAGE_MAX_BYTES_PER_FILE;

/** OpenAI `/images/edits`: one file uses `image`; two or more must use `image[]`. */
export type OpenaiEditImageFormField = 'image' | 'image[]';

export function openaiEditImageFormField(count: number): OpenaiEditImageFormField {
	return count > 1 ? 'image[]' : 'image';
}

const IMAGE_SAMPLE_PROMPT = 'a red apple on a white background';
const IMAGE_EDIT_PROMPT = 'make the apple green';
const SEEDREAM_SAMPLE_PROMPT = '一只戴着墨镜的橘猫，坐在海边，日落，超写实。';
const MINIMAX_SAMPLE_PROMPT = 'A red paper lantern over a quiet canal at dusk, cinematic lighting';
const DASHSCOPE_NATIVE_PROMPT = '一只橙色的猫坐在窗边';

export type ImageSampleFamily =
	| 'gpt'
	| 'seedream-lite'
	| 'seedream-pro'
	| 'qwen'
	| 'wan'
	| 'glm'
	| 'grok'
	| 'grok-quality'
	| 'gemini'
	| 'minimax'
	| 'unknown';

export type ImageBodyTemplateInput = {
	protocol: string;
	adapter?: string | null;
	modelId?: string | null;
	providerModelName?: string | null;
	operation?: ImageOperation;
};

/** 用供应商模型名识别族；没有供应商模型名时回退到目录模型 ID。`pro|flash` 归入 Seedream pro。 */
export function imageSampleFamily(input: ImageBodyTemplateInput): ImageSampleFamily {
	const provider = input.providerModelName?.trim() ?? '';
	const name = provider || input.modelId?.trim() || '';
	if (/seedream/i.test(name)) return /pro|flash/i.test(name) ? 'seedream-pro' : 'seedream-lite';
	if (/minimax-image|^image-01/i.test(name)) return 'minimax';
	if (/qwen/i.test(name)) return 'qwen';
	if (/wan2|wanx/i.test(name)) return 'wan';
	if (/grok/i.test(name)) return /quality/i.test(name) ? 'grok-quality' : 'grok';
	if (/gemini|imagen/i.test(name)) return 'gemini';
	if (/glm/i.test(name)) return 'glm';
	if (/gpt-image/i.test(name)) return 'gpt';
	const adapter = input.adapter?.trim() ?? '';
	if (adapter === 'dashscope-image-qwen') return 'qwen';
	if (adapter === 'dashscope-image-wan') return 'wan';
	if (adapter === 'minimax-image') return 'minimax';
	if (adapter === 'volcengine-image') return 'seedream-lite';
	return 'unknown';
}

function prettyJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function openaiImageSample(family: ImageSampleFamily, operation: ImageOperation): Record<string, unknown> {
	const prompt = operation === 'edits' ? IMAGE_EDIT_PROMPT : IMAGE_SAMPLE_PROMPT;
	switch (family) {
		case 'gpt':
			return { model: '<auto>', prompt, n: 1, size: '1024x1024', quality: 'low' };
		case 'seedream-lite':
			return { model: '<auto>', prompt: SEEDREAM_SAMPLE_PROMPT, n: 1, size: '2K', watermark: false };
		case 'seedream-pro':
			return { model: '<auto>', prompt: SEEDREAM_SAMPLE_PROMPT, n: 1, size: '1K', watermark: false };
		case 'qwen':
			return {
				model: '<auto>',
				prompt: IMAGE_SAMPLE_PROMPT,
				n: 1,
				size: '1024*1024',
				parameters: { negative_prompt: 'blurry', seed: 42 },
			};
		case 'wan':
			return { model: '<auto>', prompt: IMAGE_SAMPLE_PROMPT, n: 1, size: '1K' };
		case 'glm':
			return { model: '<auto>', prompt: IMAGE_SAMPLE_PROMPT, n: 1, size: '1280x1280' };
		case 'grok':
			return {
				model: '<auto>',
				prompt: IMAGE_SAMPLE_PROMPT,
				n: 1,
				resolution: '1k',
				aspect_ratio: '1:1',
				quality: 'low',
			};
		case 'grok-quality':
			return { model: '<auto>', prompt: IMAGE_SAMPLE_PROMPT, n: 1, resolution: '1k', aspect_ratio: '1:1' };
		case 'gemini':
			return {
				model: '<auto>',
				prompt: IMAGE_SAMPLE_PROMPT,
				n: 1,
				aspect_ratio: '1:1',
				response_format: 'b64_json',
			};
		case 'minimax':
			return {
				model: '<auto>',
				prompt: MINIMAX_SAMPLE_PROMPT,
				n: 1,
				aspect_ratio: '1:1',
				response_format: 'url',
				prompt_optimizer: true,
				aigc_watermark: false,
			};
		default:
			return { model: '<auto>', prompt: IMAGE_SAMPLE_PROMPT, n: 1 };
	}
}

function dashscopeNativeSample(family: ImageSampleFamily): Record<string, unknown> {
	const size = family === 'wan' ? '1K' : family === 'qwen' ? '1024*1024' : undefined;
	return {
		model: '<auto>',
		input: { messages: [{ role: 'user', content: [{ text: DASHSCOPE_NATIVE_PROMPT }] }] },
		parameters: size ? { size, n: 1 } : { n: 1 },
	};
}

function volcengineNativeSample(family: ImageSampleFamily): Record<string, unknown> {
	return {
		model: '<auto>',
		prompt: SEEDREAM_SAMPLE_PROMPT,
		size: family === 'seedream-pro' ? '1K' : '2K',
		response_format: 'url',
		watermark: false,
		stream: false,
		sequential_image_generation: 'disabled',
	};
}

/** MiniMax 文生图 / 图生图共用 POST /v1/image_generation。 */
export const MINIMAX_IMAGE_BODY_TEMPLATE = `{
  "model": "<auto>",
  "prompt": "A red paper lantern over a quiet canal at dusk, cinematic lighting",
  "aspect_ratio": "1:1",
  "response_format": "url",
  "n": 1
}`;

/**
 * 按模型族生成生图请求样例。尺寸取该型号官方支持的最低档。
 * OpenAI 入口只放该族的官方字段；原生透传按同一族选尺寸。
 */
export function imageBodyTemplateFor(input: ImageBodyTemplateInput): string {
	const protocol = input.protocol.trim().toLowerCase();
	const adapter = input.adapter?.trim() ?? '';
	const operation = input.operation ?? 'generations';
	const family = imageSampleFamily(input);
	if (protocol === 'volcengine' && adapter !== 'volcengine-image') {
		return prettyJson(volcengineNativeSample(family));
	}
	if (protocol === 'minimax' && adapter !== 'minimax-image') {
		return MINIMAX_IMAGE_BODY_TEMPLATE;
	}
	if (
		protocol === 'dashscope' &&
		adapter !== 'dashscope-image-qwen' &&
		adapter !== 'dashscope-image-wan'
	) {
		return prettyJson(dashscopeNativeSample(family));
	}
	return prettyJson(openaiImageSample(family, operation));
}

/** 火山方舟 / BytePlus Seedream 原生生图默认样例（未识别型号时用 lite 最低档 `2K`）。 */
export const VOLCENGINE_IMAGE_BODY_TEMPLATE = imageBodyTemplateFor({ protocol: 'volcengine' });

export function isImageRouteModel(m: ModelKindFields): boolean {
	return isImageGenerationModel(m);
}

/** Validate reference image files before send (Playground / Simulator). */
export function validateEditImageFiles(
	files: File[]
): { ok: true } | { ok: false; error: string } {
	if (files.length === 0) {
		return { ok: false, error: 'At least one reference image is required' };
	}
	if (files.length > IMAGE_MAX_REFERENCE_COUNT) {
		return {
			ok: false,
			error: `At most ${IMAGE_MAX_REFERENCE_COUNT} reference images are allowed`,
		};
	}
	let total = 0;
	for (const file of files) {
		if (file.size > IMAGE_MAX_BYTES_PER_FILE) {
			return {
				ok: false,
				error: `each image must be at most ${IMAGE_MAX_BYTES_PER_FILE} bytes`,
			};
		}
		total += file.size;
		if (total > IMAGE_MAX_TOTAL_UPLOAD_BYTES) {
			return {
				ok: false,
				error: `total image upload must be at most ${IMAGE_MAX_TOTAL_UPLOAD_BYTES} bytes`,
			};
		}
	}
	return { ok: true };
}

/** Read a File as a data URL (for Playground JSON → server multipart). */
export function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === 'string') resolve(reader.result);
			else reject(new Error('Failed to read file as data URL'));
		};
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
		reader.readAsDataURL(file);
	});
}

export type ImagePreviewItem =
	| { kind: 'b64'; src: string }
	| { kind: 'url'; src: string };

function asPreviewObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function collectOpenAiImagePreviews(data: unknown[]): ImagePreviewItem[] {
	const images: ImagePreviewItem[] = [];
	for (const item of data) {
		if (!item || typeof item !== 'object') continue;
		const row = item as { b64_json?: unknown; url?: unknown };
		if (typeof row.b64_json === 'string' && row.b64_json.trim()) {
			const b64 = row.b64_json.trim();
			const src = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
			images.push({ kind: 'b64', src });
			continue;
		}
		if (typeof row.url === 'string' && row.url.trim()) {
			images.push({ kind: 'url', src: row.url.trim() });
		}
	}
	return images;
}

/** DashScope multimodal-generation: `output.choices[].message.content[].image`. */
function collectDashScopeImagePreviews(parsed: Record<string, unknown>): ImagePreviewItem[] {
	const output = asPreviewObject(parsed.output);
	const choices = Array.isArray(output?.choices) ? output.choices : [];
	const images: ImagePreviewItem[] = [];
	for (const choice of choices) {
		const message = asPreviewObject(asPreviewObject(choice)?.message);
		const content = Array.isArray(message?.content) ? message.content : [];
		for (const part of content) {
			const image = asPreviewObject(part)?.image;
			if (typeof image !== 'string' || !image.trim()) continue;
			const src = image.trim();
			images.push(src.startsWith('data:') ? { kind: 'b64', src } : { kind: 'url', src });
		}
	}
	return images;
}

/** MiniMax image_generation：`data.image_urls` 或 `data.image_base64`。 */
export function collectMiniMaxImagePreviews(parsed: Record<string, unknown>): ImagePreviewItem[] {
	const data = asPreviewObject(parsed.data);
	if (!data) return [];
	const images: ImagePreviewItem[] = [];
	const urls = Array.isArray(data.image_urls) ? data.image_urls : [];
	for (const url of urls) {
		if (typeof url !== 'string' || !url.trim()) continue;
		images.push({ kind: 'url', src: url.trim() });
	}
	const encoded = Array.isArray(data.image_base64) ? data.image_base64 : [];
	for (const raw of encoded) {
		if (typeof raw !== 'string' || !raw.trim()) continue;
		const value = raw.trim();
		images.push({
			kind: 'b64',
			src: value.startsWith('data:') ? value : `data:image/jpeg;base64,${value}`,
		});
	}
	return images;
}

export type ParsedImagesGenerationsResponse = {
	images: ImagePreviewItem[];
	count: number;
	/** Short usage line for Admin panels (image count + optional quality/size from request). */
	usageHint: string | null;
};

/**
 * Parse OpenAI-compatible images generations JSON into preview URLs / data URLs.
 */
export function parseImagesGenerationsResponse(
	jsonText: string,
	requestMeta?: { quality?: string; size?: string; n?: number }
): ParsedImagesGenerationsResponse {
	const empty: ParsedImagesGenerationsResponse = { images: [], count: 0, usageHint: null };
	const trimmed = jsonText.trim();
	if (!trimmed) return empty;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed) as unknown;
	} catch {
		return empty;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
	const data = (parsed as { data?: unknown }).data;
	const record = parsed as Record<string, unknown>;
	const images: ImagePreviewItem[] = Array.isArray(data)
		? collectOpenAiImagePreviews(data)
		: (() => {
				const miniMax = collectMiniMaxImagePreviews(record);
				return miniMax.length > 0 ? miniMax : collectDashScopeImagePreviews(record);
			})();

	const count = images.length;
	if (count === 0) return empty;

	const parts = [`${count} image${count === 1 ? '' : 's'}`];
	if (requestMeta?.quality) parts.push(`quality=${requestMeta.quality}`);
	if (requestMeta?.size) parts.push(`size=${requestMeta.size}`);
	if (requestMeta?.n != null && Number.isFinite(requestMeta.n)) {
		parts.push(`n=${requestMeta.n}`);
	}

	return {
		images,
		count,
		usageHint: parts.join(' · '),
	};
}

/** Extract quality/size/n from a request body object for usage hints. */
export function imageRequestMetaFromBody(body: Record<string, unknown>): {
	quality?: string;
	size?: string;
	n?: number;
} {
	const quality = typeof body.quality === 'string' ? body.quality : undefined;
	const size = typeof body.size === 'string' ? body.size : undefined;
	const nRaw = body.n;
	const n =
		typeof nRaw === 'number' && Number.isFinite(nRaw)
			? nRaw
			: typeof nRaw === 'string' && nRaw.trim() !== '' && Number.isFinite(Number(nRaw))
				? Number(nRaw)
				: undefined;
	return { quality, size, n };
}
