import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	isAudioModel,
	isEmbeddingModel,
	isAudioSpeechModel,
	isAudioTranscriptionModel,
	isImageGenerationModel,
	isTextLlmModel,
} from './model-modalities';

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

describe('audio model kind', () => {
	it('separates ASR duration pricing from TTS character pricing', () => {
		const asr = {
			pricing_profile: JSON.stringify({
				audio_billing_mode: 'per_second',
				audio: { price_per_second: 0.0001 },
			}),
		};
		const tts = {
			input_modalities: ['text'],
			output_modalities: ['audio'],
			pricing_profile: JSON.stringify({
				audio_billing_mode: 'per_character',
				audio: { price_per_character: 0.0001 },
			}),
		};
		assert.equal(isAudioTranscriptionModel(asr), true);
		assert.equal(isAudioModel(asr), true);
		assert.equal(isAudioSpeechModel(asr), false);
		assert.equal(isAudioTranscriptionModel(tts), false);
		assert.equal(isAudioSpeechModel(tts), true);
		assert.equal(isAudioModel(tts), true);
		assert.equal(isTextLlmModel(tts), false);
	});
});

describe('embedding model kind', () => {
	it('detects embedding output and excludes it from other kinds', () => {
		const m = {
			input_modalities: ['text'],
			output_modalities: ['embedding'],
			pricing_profile: zeroTierProfile,
		};
		assert.equal(isEmbeddingModel(m), true);
		assert.equal(isTextLlmModel(m), false);
		assert.equal(isImageGenerationModel(m), false);
		assert.equal(isAudioModel(m), false);
		assert.equal(isEmbeddingModel({ output_modalities: ['text'] }), false);
		assert.equal(isEmbeddingModel({}), false);
	});
});
