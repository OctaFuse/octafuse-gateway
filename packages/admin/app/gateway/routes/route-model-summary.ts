import { resolveModelKind, type ModelKindFields } from '@octafuse/core/db/model-kind';
import {
	parsePricingProfile,
	profileHasImagePerImagePricing,
	resolveAudioBillingMode,
} from '@octafuse/core/db/pricing-profile';

/** Derive unit labels from configured billing, never from the media kind alone. */
export function routeModelBillingLabel(model: ModelKindFields): string | null {
	const kind = resolveModelKind(model);
	const profile = parsePricingProfile(model.pricing_profile);
	if (kind === 'image') {
		if (profileHasImagePerImagePricing(profile)) return 'imagePerImage';
		return profile?.tiers.length ? 'imageTokens' : 'image';
	}
	if (kind === 'asr' || kind === 'tts') {
		const mode = resolveAudioBillingMode(profile);
		return mode === 'token'
			? `${kind}Tokens`
			: mode === 'per_second'
			? 'asrSeconds'
			: mode === 'per_character'
			? 'ttsCharacters'
			: kind;
	}
	return kind === 'embedding' ? 'embedding' : null;
}
