import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	createDefaultAudioCharacterPricingDraft,
	createDefaultAudioPricingDraft,
	createDefaultAudioTokenPricingDraft,
	profileJsonToAudioDraftState,
	imagePricingRowsForMode,
	serializeImagePricingDraft,
	serializeAudioPricingDraft,
	switchAudioPricingDraftMode,
} from './pricing-tiers-draft';

const serialize = (draft: Parameters<typeof serializeAudioPricingDraft>[0]) => {
	const result = serializeAudioPricingDraft(draft);
	assert.ok(result.ok);
	return JSON.parse(result.json!);
};

describe('audio pricing mode drafts', () => {
	it('keeps every token tier and cache price when switching modes', () => {
		const draft = profileJsonToAudioDraftState(
			JSON.stringify({
				audio_billing_mode: 'token',
				tiers: [
					{ upto: 1000, input_price: 0.2, output_price: 0.5, cache_read_price: 0.01 },
					{ upto: null, input_price: 0.4, output_price: 1, cache_write_price: 0.3 },
				],
			})
		);
		const seconds = switchAudioPricingDraftMode(draft, 'per_second');
		assert.equal(serialize(seconds).audio.price_per_second, 0.0001);
		assert.equal(serialize(seconds).tiers, undefined);
		assert.deepEqual(serialize(switchAudioPricingDraftMode(seconds, 'token')), serialize(draft));
	});

	it('retains edited per-second prices and minimums through a token round trip', () => {
		const draft = {
			...createDefaultAudioPricingDraft(),
			price_per_second: '0.000035',
			minimum_seconds: '2.5',
		};
		const token = switchAudioPricingDraftMode(draft, 'token');
		assert.equal(token.tiers.length, 1);
		assert.deepEqual(serialize(switchAudioPricingDraftMode(token, 'per_second')), serialize(draft));
	});

	it('retains free character pricing and its minimum through a token round trip', () => {
		const draft = {
			...createDefaultAudioCharacterPricingDraft(),
			price_per_character: '0',
			minimum_characters: '2000',
		};
		const token = switchAudioPricingDraftMode(draft, 'token');
		assert.deepEqual(
			serialize(switchAudioPricingDraftMode(token, 'per_character')),
			serialize(draft)
		);
	});

	it('keeps TTS pricing blank until the operator supplies a price', () => {
		const draft = switchAudioPricingDraftMode(
			createDefaultAudioTokenPricingDraft(),
			'per_character'
		);
		assert.equal(draft.price_per_character, '');
	});
	it('rejects blank audio prices while accepting explicit zero', () => {
		for (const draft of [
			{ ...createDefaultAudioPricingDraft(), price_per_second: '  ' },
			createDefaultAudioCharacterPricingDraft(),
		]) {
			assert.equal(serializeAudioPricingDraft(draft).ok, false);
			const free = { ...draft, price_per_second: '0', price_per_character: '0' };
			assert.equal(serializeAudioPricingDraft(free).ok, true);
		}
	});
});

describe('image pricing mode drafts', () => {
	it('keeps all token tiers when visiting per-image mode and serializes only the active mode', () => {
		const rows = imagePricingRowsForMode([], 'token');
		const changed = [
			{ ...rows[0], input_price: '0.5', image_output_price: '60' },
			{ ...rows[0], id: 'second', input_price: '1', image_output_price: '120' },
		];
		const hidden = imagePricingRowsForMode(changed, 'per_image');
		assert.equal(hidden, changed);
		assert.deepEqual(imagePricingRowsForMode(hidden, 'token'), changed);
		const result = serializeImagePricingDraft({
			mode: 'per_image',
			tiers: hidden,
			perImage: { default: '0.04', inputDefault: '', uncertainResultPolicy: 'requested' },
		});
		assert.ok(result.ok);
		assert.equal(JSON.parse(result.json!).tiers, undefined);
	});
});
