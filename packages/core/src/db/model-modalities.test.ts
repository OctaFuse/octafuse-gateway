import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isImageGenerationModel, isTextLlmModel } from './model-modalities';

const zeroTierProfile = JSON.stringify({
	tiers: [{ upto: null, input_price: 0, output_price: 0 }],
});

const imageProfile = JSON.stringify({
	tiers: [{ upto: null, input_price: 0, output_price: 0 }],
	image: { default: 0.04 },
});

describe('isImageGenerationModel', () => {
	it('classifies by output_modalities containing image', () => {
		assert.equal(
			isImageGenerationModel({
				output_modalities: JSON.stringify(['image']),
				pricing_profile: zeroTierProfile,
			}),
			true
		);
		assert.equal(
			isImageGenerationModel({
				output_modalities: ['text', 'image'],
				pricing_profile: imageProfile,
			}),
			true
		);
	});

	it('does not treat multimodal LLM input image as image-generation', () => {
		assert.equal(
			isImageGenerationModel({
				output_modalities: JSON.stringify(['text']),
				pricing_profile: imageProfile,
			}),
			false
		);
		assert.equal(
			isTextLlmModel({
				output_modalities: JSON.stringify(['text']),
				pricing_profile: imageProfile,
			}),
			true
		);
	});

	it('falls back to pricing_profile.image when output modalities missing', () => {
		assert.equal(
			isImageGenerationModel({
				output_modalities: null,
				pricing_profile: imageProfile,
			}),
			true
		);
		assert.equal(
			isImageGenerationModel({
				output_modalities: undefined,
				pricing_profile: zeroTierProfile,
			}),
			false
		);
	});
});
