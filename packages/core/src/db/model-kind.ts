/**
 * 模型类型（Kind）判定的唯一真源。规则说明见 `docs/developers/reference/model-kinds.md`。
 *
 * Kind 由已有字段派生，不单独落库：
 * 1. `output_modalities` 含 `embedding` → embedding
 * 2. `output_modalities` 含 `image` → image（output 缺失时回退旧版 `pricing_profile.image`）
 * 3. 有效 `audio_billing_mode`：`per_character` → tts；`per_second` / `token` → asr
 * 4. 无计费模式时按模态签名兜底：output 仅 audio 且 input 仅 text → tts；
 *    output 仅 text 且 input 含 audio 且只有 audio/text → asr
 * 5. 其余 → llm（多模态 LLM 会接收图片 / 音频，因此不能用 input 含 image/audio 判断）
 *
 * 本文件不依赖 `model-modalities.ts`，避免循环引用；`model-modalities.ts` 会再导出这里的类型与 `isXxxModel`。
 */

import { parsePricingProfile, resolveAudioBillingMode } from './pricing-profile';

export const MODEL_KINDS = ['llm', 'image', 'asr', 'tts', 'embedding'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

/** `GET /v1/models?kind=` 取值：`audio` 为 ASR + TTS 的兼容别名，`all` 不过滤。 */
export const MODEL_KIND_QUERY_FILTERS = ['llm', 'image', 'asr', 'tts', 'audio', 'embedding', 'all'] as const;
export type ModelKindQueryFilter = (typeof MODEL_KIND_QUERY_FILTERS)[number];

/** Kind 判定命中的依据，供排查与文档说明使用。 */
export type ModelKindSource =
	| 'output_modalities'
	| 'billing'
	| 'modality_signature'
	| 'legacy_pricing'
	| 'default';

/** Fields needed to classify catalog models. */
export type ModelKindFields = {
	/** Stored JSON text, or already-parsed modality list */
	output_modalities?: string | string[] | null;
	input_modalities?: string | string[] | null;
	pricing_profile?: string | null;
};

function toModalityList(raw: string | string[] | null | undefined): string[] | null {
	if (raw == null) return null;
	let items: unknown;
	if (Array.isArray(raw)) {
		items = raw;
	} else {
		if (raw.trim() === '') return null;
		try {
			items = JSON.parse(raw) as unknown;
		} catch {
			return null;
		}
	}
	if (!Array.isArray(items)) return null;
	const out: string[] = [];
	for (const item of items) {
		const v = String(item).trim().toLowerCase();
		if (v && !out.includes(v)) out.push(v);
	}
	return out.length > 0 ? out : null;
}

type AudioBillingKind = 'asr' | 'tts' | null;

/** 仅当计费模式与其负载同时合法时才算“有效”，否则交给模态签名兜底。 */
function audioKindFromBilling(profile: ReturnType<typeof parsePricingProfile>): AudioBillingKind {
	switch (profile?.audio_billing_mode) {
		case 'per_second':
			return profile.audio != null ? 'asr' : null;
		case 'token':
			return profile.tiers.length > 0 ? 'asr' : null;
		case 'per_character':
			return profile.audio?.price_per_character != null ? 'tts' : null;
		default:
			return null;
	}
}

function audioKindFromSignature(input: string[] | null, output: string[] | null): AudioBillingKind {
	if (output == null) return null;
	const onlyOutput = (modality: string) => output.length === 1 && output[0] === modality;
	if (onlyOutput('audio') && (input == null || input.every((m) => m === 'text'))) {
		return 'tts';
	}
	if (
		onlyOutput('text') &&
		input != null &&
		input.includes('audio') &&
		input.every((m) => m === 'audio' || m === 'text')
	) {
		return 'asr';
	}
	return null;
}

export function explainModelKind(m: ModelKindFields): { kind: ModelKind; source: ModelKindSource } {
	const output = toModalityList(m.output_modalities);
	if (output?.includes('embedding')) {
		return { kind: 'embedding', source: 'output_modalities' };
	}
	if (output?.includes('image')) {
		return { kind: 'image', source: 'output_modalities' };
	}
	const profile = parsePricingProfile(m.pricing_profile ?? undefined);
	if (output == null && profile?.image != null) {
		return { kind: 'image', source: 'legacy_pricing' };
	}
	const billing = audioKindFromBilling(profile);
	if (billing) {
		return { kind: billing, source: 'billing' };
	}
	const signature = audioKindFromSignature(toModalityList(m.input_modalities), output);
	if (signature) {
		return { kind: signature, source: 'modality_signature' };
	}
	return { kind: 'llm', source: 'default' };
}

export function resolveModelKind(m: ModelKindFields): ModelKind {
	return explainModelKind(m).kind;
}

/** 是否属于 `GET /v1/models?kind=` 过滤条件（`audio` = asr + tts，`all` 不过滤）。 */
export function modelKindMatchesFilter(kind: ModelKind, filter: ModelKindQueryFilter): boolean {
	if (filter === 'all') return true;
	if (filter === 'audio') return kind === 'asr' || kind === 'tts';
	return kind === filter;
}

/**
 * 检查计费模式与模态是否互相矛盾；一致返回 `null`，否则返回英文原因（Admin 保存时原样展示）。
 * 缺失的模态不视为冲突（兼容尚未补全模态的历史数据）。
 */
export function validateModelKindConsistency(m: ModelKindFields): string | null {
	const output = toModalityList(m.output_modalities);
	const input = toModalityList(m.input_modalities);

	if (output?.includes('embedding') && (output.includes('image') || output.includes('audio'))) {
		return 'output_modalities cannot combine embedding with image or audio';
	}

	const profile = parsePricingProfile(m.pricing_profile ?? undefined);
	const mode = profile?.audio_billing_mode;
	if (!mode) return null;

	if (output?.includes('embedding') || output?.includes('image')) {
		return `audio_billing_mode "${mode}" conflicts with output_modalities containing embedding or image`;
	}
	if (mode === 'per_character') {
		if (output != null && !output.includes('audio')) {
			return 'audio_billing_mode "per_character" (TTS) requires output_modalities to include audio';
		}
		return null;
	}
	// per_second | token → ASR
	if (output?.includes('audio')) {
		return `audio_billing_mode "${mode}" (ASR) conflicts with output_modalities containing audio`;
	}
	if (input != null && !input.includes('audio')) {
		return `audio_billing_mode "${mode}" (ASR) requires input_modalities to include audio`;
	}
	return null;
}

export type AudioModelGuardResult = 'ok' | 'wrong_kind' | 'billing_missing';

/**
 * 音频端点入口守卫：分类（Kind）只说明“它是什么模型”，是否可放行还要求计费配置就绪，
 * 否则请求会在没有定价的情况下被受理。ASR 要求 `per_second` / `token`，TTS 要求 `per_character`。
 */
export function checkAudioModelGuard(m: ModelKindFields, expected: 'asr' | 'tts'): AudioModelGuardResult {
	if (resolveModelKind(m) !== expected) return 'wrong_kind';
	const mode = resolveAudioBillingMode(parsePricingProfile(m.pricing_profile ?? undefined));
	if (expected === 'tts') return mode === 'per_character' ? 'ok' : 'billing_missing';
	return mode === 'per_second' || mode === 'token' ? 'ok' : 'billing_missing';
}

/** Whether this catalog model produces embedding vectors. */
export function isEmbeddingModel(m: ModelKindFields): boolean {
	return resolveModelKind(m) === 'embedding';
}

/** Whether this catalog model is an image-generation model (e.g. gpt-image-2). */
export function isImageGenerationModel(m: ModelKindFields): boolean {
	return resolveModelKind(m) === 'image';
}

/** Whether this catalog model is an audio transcription (ASR) model. */
export function isAudioTranscriptionModel(m: ModelKindFields): boolean {
	return resolveModelKind(m) === 'asr';
}

/** Whether this catalog model synthesizes speech (TTS). */
export function isAudioSpeechModel(m: ModelKindFields): boolean {
	return resolveModelKind(m) === 'tts';
}

/** 该目录模型是否属于音频端点模型（ASR 或 TTS）。 */
export function isAudioModel(m: ModelKindFields): boolean {
	const kind = resolveModelKind(m);
	return kind === 'asr' || kind === 'tts';
}

/** False for image-generation / ASR / TTS / embedding models; true for chat / multimodal LLMs and unknown. */
export function isTextLlmModel(m: ModelKindFields): boolean {
	return resolveModelKind(m) === 'llm';
}
