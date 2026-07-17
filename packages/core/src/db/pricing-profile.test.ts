import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePricingProfile, profileHasImageTokenPricing } from './pricing-profile';

describe('parsePricingProfile image block', () => {
	it('parses tiers-only profiles', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				tiers: [{ upto: null, input_price: 1, output_price: 2 }],
			})
		);
		assert.ok(p);
		assert.equal(p!.tiers.length, 1);
		assert.equal(p!.image, undefined);
	});

	it('parses legacy image maps without treating them as billable', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				tiers: [{ upto: null, input_price: 0, output_price: 0 }],
				image: {
					default: 0.04,
					by_quality: { low: 0.01, High: 0.17 },
					by_size: { '1024x1024': 0.04 },
					by_quality_size: { 'medium:1024x1024': 0.05 },
				},
			})
		);
		assert.ok(p?.image);
		assert.equal(p!.image!.default, 0.04);
		assert.equal(p!.image!.by_quality?.low, 0.01);
		assert.equal(p!.image!.by_quality?.high, 0.17);
		assert.equal(p!.image!.by_quality_size?.['medium:1024x1024'], 0.05);
		assert.equal(profileHasImageTokenPricing(p), false);
	});

	it('ignores invalid image block and keeps tiers', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				tiers: [{ upto: null, input_price: 0, output_price: 0 }],
				image: { default: -1 },
			})
		);
		assert.ok(p);
		assert.equal(p!.tiers.length, 1);
		assert.equal(p!.image, undefined);
	});
});

describe('profileHasImageTokenPricing', () => {
	it('detects image_* tier prices', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				tiers: [
					{
						upto: null,
						input_price: 5,
						output_price: 0,
						image_output_price: 30,
					},
				],
			})
		);
		assert.equal(profileHasImageTokenPricing(p), true);
	});

	it('rejects negative image_* prices (whole profile invalid)', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				tiers: [
					{
						upto: null,
						input_price: 5,
						output_price: 0,
						image_output_price: -30,
					},
				],
			})
		);
		assert.equal(p, null);
		assert.equal(profileHasImageTokenPricing(p), false);
	});
});
