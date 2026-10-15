/**
 * Model input/output modalities — aligned with OpenRouter-style capability labels.
 * Stored in `models.input_modalities` / `models.output_modalities` as JSON string arrays.
 *
 * Kind（LLM / image / ASR / TTS / embedding）由字段派生、不单独落库，判定规则见 `model-kind.ts` 与
 * `docs/developers/reference/model-kinds.md`。
 */

export const MODEL_INPUT_MODALITIES = ['text', 'image', 'audio', 'video', 'file'] as const;
export const MODEL_OUTPUT_MODALITIES = ['text', 'image', 'audio', 'embedding'] as const;

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

// Kind 判定（LLM / image / ASR / TTS / embedding）的唯一真源在 model-kind.ts；此处再导出以保持原导入路径可用。
export {
	isAudioModel,
	isAudioSpeechModel,
	isAudioTranscriptionModel,
	isEmbeddingModel,
	isImageGenerationModel,
	isTextLlmModel,
} from './model-kind';
export type { ModelKindFields } from './model-kind';
