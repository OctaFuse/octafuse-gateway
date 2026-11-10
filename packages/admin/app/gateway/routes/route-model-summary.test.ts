import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeModelBillingLabel } from './route-model-summary';

const priced = (input: string[], output: string[], pricing: object | null) => ({
	input_modalities: JSON.stringify(input),
	output_modalities: JSON.stringify(output),
	pricing_profile: pricing ? JSON.stringify(pricing) : null,
});
const tiers = [{ upto: null, input_price: 1, output_price: 2 }];
describe('route model billing summary', () => {
	it('distinguishes per-image from token image billing', () => {
		assert.equal(
			routeModelBillingLabel(
				priced(['text'], ['image'], { image_billing_mode: 'per_image', image: { default: 0.1 } })
			),
			'imagePerImage'
		);
		assert.equal(routeModelBillingLabel(priced(['text'], ['image'], { tiers })), 'imageTokens');
	});
	it('does not assume a unit for missing or invalid image pricing', () => {
		assert.equal(routeModelBillingLabel(priced(['text'], ['image'], null)), 'image');
		assert.equal(
			routeModelBillingLabel({ output_modalities: '["image"]', pricing_profile: 'invalid' }),
			'image'
		);
	});
	it('distinguishes audio tokens, seconds and characters', () => {
		assert.equal(
			routeModelBillingLabel(priced(['audio'], ['text'], { audio_billing_mode: 'token', tiers })),
			'asrTokens'
		);
		assert.equal(
			routeModelBillingLabel(
				priced(['audio'], ['text'], { audio_billing_mode: 'per_second', audio: { price_per_second: 0.01 } })
			),
			'asrSeconds'
		);
		assert.equal(
			routeModelBillingLabel(priced(['text'], ['audio'], { audio_billing_mode: 'token', tiers })),
			'ttsTokens'
		);
		assert.equal(
			routeModelBillingLabel(
				priced(['text'], ['audio'], {
					audio_billing_mode: 'per_character',
					audio: { price_per_character: 0.01 },
				})
			),
			'ttsCharacters'
		);
	});
	it('preserves unpriced audio kinds, embedding and language-model context summaries', () => {
		assert.equal(routeModelBillingLabel(priced(['audio'], ['text'], null)), 'asr');
		assert.equal(routeModelBillingLabel(priced(['text'], ['audio'], null)), 'tts');
		assert.equal(routeModelBillingLabel(priced(['text'], ['embedding'], null)), 'embedding');
		assert.equal(routeModelBillingLabel(priced(['text', 'audio'], ['text', 'audio'], null)), null);
	});
});
