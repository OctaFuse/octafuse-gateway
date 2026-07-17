/**
 * Model input/output modalities — aligned with OpenRouter-style capability labels.
 * Stored in `models.input_modalities` / `models.output_modalities` as JSON string arrays.
 *
 * Kind (LLM vs image-generation) is derived — no separate DB column:
 * - Image generation: `output_modalities` includes `image`
 * - Fallback when output modalities missing: `pricing_profile.image` present
 * - Do **not** use `input_modalities` containing `image` (multimodal LLMs also accept images)
 */

import { parsePricingProfile } from './pricing-profile';

export const MODEL_INPUT_MODALITIES = ['text', 'image', 'audio', 'video', 'file'] as const;
export const MODEL_OUTPUT_MODALITIES = ['text', 'image', 'audio'] as const;

export type ModelInputModality = (typeof MODEL_INPUT_MODALITIES)[number];
export type ModelOutputModality = (typeof MODEL_OUTPUT_MODALITIES)[number];

const INPUT_SET = new Set<string>(MODEL_INPUT_MODALITIES);
const OUTPUT_SET = new Set<string>(MODEL_OUTPUT_MODALITIES);

const RELEASED_AT_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeModalityList(
	raw: unknown,
	allowed: Set<string>,
	label: string
): string[] | null {
	if (raw == null) return null;
	if (!Array.isArray(raw)) {
		throw new Error(`${label} must be an array`);
	}
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		const v = String(item).trim().toLowerCase();
		if (!v) continue;
		if (!allowed.has(v)) {
			throw new Error(`${label}: invalid modality "${item}"`);
		}
		if (!seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out.length > 0 ? out : null;
}

/** Parse stored JSON text to sorted modality array; invalid JSON returns null. */
export function parseModelModalitiesJson(raw: string | null | undefined): string[] | null {
	if (raw == null || raw.trim() === '') return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return null;
		const out: string[] = [];
		for (const item of parsed) {
			const v = String(item).trim().toLowerCase();
			if (v) out.push(v);
		}
		return out.length > 0 ? out.sort() : null;
	} catch {
		return null;
	}
}

export function coerceModelInputModalitiesInput(raw: unknown): string | null {
	if (raw == null || raw === '') return null;
	const list = normalizeModalityList(raw, INPUT_SET, 'input_modalities');
	return list ? JSON.stringify(list) : null;
}

export function coerceModelOutputModalitiesInput(raw: unknown): string | null {
	if (raw == null || raw === '') return null;
	const list = normalizeModalityList(raw, OUTPUT_SET, 'output_modalities');
	return list ? JSON.stringify(list) : null;
}

/** Validate `YYYY-MM-DD` release date; empty clears. */
export function coerceModelReleasedAtInput(raw: unknown): string | null {
	if (raw == null || raw === '') return null;
	const v = String(raw).trim();
	if (!RELEASED_AT_RE.test(v)) {
		throw new Error('released_at must be YYYY-MM-DD');
	}
	const [y, m, d] = v.split('-').map((x) => Number(x));
	const dt = new Date(Date.UTC(y, m - 1, d));
	if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
		throw new Error('released_at is not a valid calendar date');
	}
	return v;
}

/** Compare two modality JSON strings (order-insensitive). */
export function modelModalitiesJsonEqual(a: string | null | undefined, b: string | null | undefined): boolean {
	const pa = parseModelModalitiesJson(a ?? null);
	const pb = parseModelModalitiesJson(b ?? null);
	if (pa == null && pb == null) return true;
	if (pa == null || pb == null) return false;
	if (pa.length !== pb.length) return false;
	for (let i = 0; i < pa.length; i++) {
		if (pa[i] !== pb[i]) return false;
	}
	return true;
}

/** Fields needed to classify catalog models as LLM vs image-generation. */
export type ModelKindFields = {
	/** Stored JSON text, or already-parsed modality list */
	output_modalities?: string | string[] | null;
	pricing_profile?: string | null;
};

function normalizeOutputModalitiesList(
	raw: string | string[] | null | undefined
): string[] | null {
	if (raw == null) return null;
	if (Array.isArray(raw)) {
		const out: string[] = [];
		for (const item of raw) {
			const v = String(item).trim().toLowerCase();
			if (v) out.push(v);
		}
		return out.length > 0 ? out : null;
	}
	return parseModelModalitiesJson(raw);
}

/**
 * Whether this catalog model is an image-generation model (e.g. gpt-image-2).
 * Prefer `output_modalities` containing `image`; only fall back to `pricing_profile.image`
 * when output modalities are missing.
 */
export function isImageGenerationModel(m: ModelKindFields): boolean {
	const output = normalizeOutputModalitiesList(m.output_modalities);
	if (output != null) {
		return output.includes('image');
	}
	const profile = parsePricingProfile(m.pricing_profile ?? undefined);
	return profile?.image != null;
}

/** Text for image-generation models; true for chat / multimodal LLMs and unknown. */
export function isTextLlmModel(m: ModelKindFields): boolean {
	return !isImageGenerationModel(m);
}
