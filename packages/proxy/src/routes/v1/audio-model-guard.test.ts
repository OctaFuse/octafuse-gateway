import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audioModelGuardMessage } from './audio-model-guard';

const tts = JSON.stringify({ audio_billing_mode: 'per_character', audio: { price_per_character: 0.0001 } });
const asr = JSON.stringify({ audio_billing_mode: 'per_second', audio: { price_per_second: 0.0001 } });

describe('audioModelGuardMessage', () => {
	it('passes models with matching kind and ready billing', () => {
		assert.equal(audioModelGuardMessage({ pricing_profile: tts }, 'tts', 'X'), null);
		assert.equal(audioModelGuardMessage({ pricing_profile: asr }, 'asr', 'X'), null);
	});

	it('accepts token-billed speech models and names both modes when billing is missing', () => {
		const tokenTts = {
			input_modalities: ['text'],
			output_modalities: ['audio'],
			pricing_profile: JSON.stringify({
				audio_billing_mode: 'token',
				tiers: [{ upto: null, input_price: 1.5, output_price: 12 }],
			}),
		};
		assert.equal(audioModelGuardMessage(tokenTts, 'tts', 'X'), null);
		const missing = audioModelGuardMessage({ input_modalities: ['text'], output_modalities: ['audio'] }, 'tts', 'X');
		assert.match(missing ?? '', /per_character or token/);
	});

	it('reports wrong kind', () => {
		assert.equal(audioModelGuardMessage({ pricing_profile: asr }, 'tts', 'X'), 'X requires a speech model');
		assert.equal(audioModelGuardMessage({}, 'asr', 'X'), 'X requires a transcription model');
	});

	it('reports missing billing for signature-classified models', () => {
		const message = audioModelGuardMessage(
			{ input_modalities: ['text'], output_modalities: ['audio'] },
			'tts',
			'X',
		);
		assert.match(message ?? '', /no valid audio billing/);
	});
});
