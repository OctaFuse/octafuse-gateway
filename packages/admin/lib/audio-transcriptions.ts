/**
 * Shared helpers for Admin Playground / Simulator / Routes
 * (`/v1/audio/transcriptions` multipart).
 */
import {
	isAudioModel,
	type ModelKindFields,
} from "@octafuse/core/db/model-modalities";
import {
	parsePricingProfile,
	profileHasAudioPerCharacterPricing,
	profileHasAudioPerSecondPricing,
	profileHasAudioTokenPricing,
} from "@octafuse/core/db/pricing-profile";
import {
	formatPerCharacterUnit,
	formatPerMillionTokenUnit,
	formatPerSecondUnit,
} from "@/lib/format-gateway-currency";

/** Align with Proxy audio driver limits (admin must not depend on `@octafuse/proxy`). */
export const AUDIO_MAX_BYTES_PER_FILE = 25 * 1024 * 1024;

/** Default JSON fields for transcriptions (audio file uploaded separately as multipart). */
export const AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE = `{
  "model": "<auto>",
  "language": "",
  "response_format": "json"
}`;

/** 默认使用 OpenAI 与 DashScope Qwen TTS 都支持的 WAV，避免模板直接触发上游格式错误。 */
export const AUDIO_SPEECH_BODY_TEMPLATE = `{
  "model": "<auto>",
  "input": "你好，欢迎使用 OctaFuse Gateway。",
  "voice": "alloy",
  "response_format": "wav",
  "speed": 1
}`;

export function isAudioRouteModel(m: ModelKindFields): boolean {
	return isAudioModel(m);
}

/** Validate audio file before send (Playground / Simulator). */
export function validateAudioTranscriptionFile(
	file: File | null | undefined
): { ok: true } | { ok: false; error: string } {
	if (!file) {
		return { ok: false, error: "An audio file is required" };
	}
	if (file.size > AUDIO_MAX_BYTES_PER_FILE) {
		return {
			ok: false,
			error: `audio file must be at most ${AUDIO_MAX_BYTES_PER_FILE} bytes`,
		};
	}
	return { ok: true };
}

export type CatalogAudioPricingDisplay =
	| {
			mode: "per_second";
			pricePerSecond: string;
			minimumSeconds: string;
			unit: string;
	  }
	| {
			mode: "token";
			inputPrice: string;
			outputPrice: string;
			unit: string;
	  }
	| {
			mode: "per_character";
			pricePerCharacter: string;
			minimumCharacters: string;
			unit: string;
	  };

/** Catalog model → 只读单价摘要（Routes 弹窗；ASR 或 TTS）。 */
export function getCatalogAudioPricingDisplay(
	model: { pricing_profile?: string | null } | null | undefined,
	currencyCode = "USD"
): CatalogAudioPricingDisplay | null {
	if (!model?.pricing_profile?.trim()) return null;
	const p = parsePricingProfile(model.pricing_profile);
	if (!p) return null;
	if (profileHasAudioTokenPricing(p) && p.tiers.length > 0) {
		const tier = p.tiers[0]!;
		return {
			mode: "token",
			inputPrice: String(tier.input_price),
			outputPrice: String(tier.output_price),
			unit: formatPerMillionTokenUnit(currencyCode),
		};
	}
	if (profileHasAudioPerSecondPricing(p) && p.audio) {
		return {
			mode: "per_second",
			pricePerSecond: String(p.audio.price_per_second),
			minimumSeconds: String(p.audio.minimum_seconds ?? 1),
			unit: formatPerSecondUnit(currencyCode),
		};
	}
	if (profileHasAudioPerCharacterPricing(p) && p.audio) {
		return {
			mode: "per_character",
			pricePerCharacter: String(p.audio.price_per_character),
			minimumCharacters: String(p.audio.minimum_characters ?? 0),
			unit: formatPerCharacterUnit(currencyCode),
		};
	}
	return null;
}
