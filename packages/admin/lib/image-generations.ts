/**
 * Shared helpers for Admin Playground / Simulator image-generation (JSON generations only).
 */
import { isImageGenerationModel, type ModelKindFields } from '@octafuse/core/db/model-modalities';

/** Default request body for `POST …/images/generations` (model field overwritten at send). */
export const IMAGE_GENERATIONS_BODY_TEMPLATE = `{
  "model": "<auto>",
  "prompt": "a red apple on a white background",
  "n": 1,
  "size": "1024x1024",
  "quality": "low"
}`;

export function isImageRouteModel(m: ModelKindFields): boolean {
	return isImageGenerationModel(m);
}

export type ImagePreviewItem =
	| { kind: 'b64'; src: string }
	| { kind: 'url'; src: string };

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
	if (!Array.isArray(data)) return empty;

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
