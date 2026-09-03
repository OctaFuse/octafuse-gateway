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

/** Default request body for `POST …/images/generations` (model field overwritten at send). */
export const IMAGE_GENERATIONS_BODY_TEMPLATE = `{
  "model": "<auto>",
  "prompt": "a red apple on a white background",
  "n": 1,
  "size": "1024x1024",
  "quality": "low"
}`;

/**
 * Default JSON fields for images/edits (reference images are uploaded separately as multipart files).
 * model field overwritten at send.
 */
export const IMAGE_EDITS_BODY_TEMPLATE = `{
  "model": "<auto>",
  "prompt": "make the apple green",
  "n": 1,
  "size": "1024x1024",
  "quality": "low"
}`;

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
	const images: ImagePreviewItem[] = Array.isArray(data)
		? collectOpenAiImagePreviews(data)
		: collectDashScopeImagePreviews(parsed as Record<string, unknown>);

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
