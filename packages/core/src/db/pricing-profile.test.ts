import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	computeAudioPerCharacterMeteredCost,
	computeAudioPerSecondMeteredCost,
	parsePricingProfile,
	resolveChargedBillingPrices,
	resolveStandardBillingPrices,
	resolveSupplierBillingPrices,
	profileHasAudioPerCharacterPricing,
	profileHasAudioPerSecondPricing,
	profileHasAudioTokenPricing,
	profileHasImagePerImagePricing,
	profileHasImageTokenPricing,
	resolveAudioBillingMode,
	resolveBillableAudioCharacters,
	resolveBillableAudioSeconds,
	resolveImageBillingMode,
	resolveImageCatalogUnitPrice,
} from './pricing-profile';

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
		assert.equal(p!.image_billing_mode, undefined);
	});

	it('parses legacy image maps without inferring per_image billing', () => {
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
		assert.equal(resolveImageBillingMode(p), null);
		assert.equal(profileHasImagePerImagePricing(p), false);
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

describe('parsePricingProfile image_billing_mode', () => {
	it('parses explicit per_image mode with input and uncertain_result_policy', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				image_billing_mode: 'per_image',
				image: {
					default: 0.04,
					input: {
						default: 0.01,
						by_quality_size: { 'high:1024x1024': 0.02 },
					},
					uncertain_result_policy: 'zero',
				},
			})
		);
		assert.ok(p);
		assert.equal(p!.image_billing_mode, 'per_image');
		assert.equal(p!.tiers.length, 0);
		assert.equal(p!.image!.uncertain_result_policy, 'zero');
		assert.equal(p!.image!.input!.default, 0.01);
		assert.equal(profileHasImagePerImagePricing(p), true);
		assert.equal(resolveImageBillingMode(p), 'per_image');
	});

	it('accepts legacy per_image placeholder zero tiers', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				image_billing_mode: 'per_image',
				tiers: [{ upto: null, input_price: 0, output_price: 0 }],
				image: { default: 0.22 },
			})
		);
		assert.ok(p);
		assert.equal(p!.tiers.length, 1);
		assert.equal(resolveImageBillingMode(p), 'per_image');
	});

	it('rejects token/LLM profiles without tiers', () => {
		assert.equal(parsePricingProfile(JSON.stringify({ tiers: [] })), null);
		assert.equal(
			parsePricingProfile(JSON.stringify({ image_billing_mode: 'token', image: { default: 1 } })),
			null
		);
	});

	it('rejects illegal image_billing_mode (whole profile null)', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				image_billing_mode: 'legacy',
				tiers: [{ upto: null, input_price: 1, output_price: 2 }],
			})
		);
		assert.equal(p, null);
	});

	it('token mode with image block still parses (image ignored at billing)', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				image_billing_mode: 'token',
				tiers: [
					{
						upto: null,
						input_price: 5,
						output_price: 0,
						image_output_price: 30,
					},
				],
				image: { default: 0.99 },
			})
		);
		assert.ok(p);
		assert.equal(p!.image_billing_mode, 'token');
		assert.equal(p!.image!.default, 0.99);
		assert.equal(resolveImageBillingMode(p), 'token');
		assert.equal(profileHasImagePerImagePricing(p), false);
	});

	it('per_image mode with positive image_* tiers still parses', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				image_billing_mode: 'per_image',
				tiers: [
					{
						upto: null,
						input_price: 0,
						output_price: 0,
						image_output_price: 30,
					},
				],
				image: { default: 0.05 },
			})
		);
		assert.ok(p);
		assert.equal(resolveImageBillingMode(p), 'per_image');
		assert.equal(profileHasImageTokenPricing(p), true);
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
		assert.equal(resolveImageBillingMode(p), 'token');
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

describe('resolveImageCatalogUnitPrice', () => {
	const cfg = {
		default: 0.04,
		by_quality: { low: 0.01, medium: 0.05 },
		by_size: { '1024x1024': 0.04 },
		by_quality_size: { 'high:1536x1024': 0.165 },
		input: {
			default: 0,
			by_quality_size: { 'high:1024x1024': 0.02 },
		},
	};

	it('lookup order: by_quality_size → by_quality → by_size → default', () => {
		assert.equal(resolveImageCatalogUnitPrice(cfg, 'high', '1536x1024'), 0.165);
		assert.equal(resolveImageCatalogUnitPrice(cfg, 'medium', '1024x1024'), 0.05);
		assert.equal(resolveImageCatalogUnitPrice(cfg, 'low', '512x512'), 0.01);
		assert.equal(resolveImageCatalogUnitPrice(cfg, 'auto', '2048x2048'), 0.04);
	});

	it('normalizes quality/size case and whitespace', () => {
		assert.equal(resolveImageCatalogUnitPrice(cfg, '  High ', '1536X1024'), 0.165);
	});

	it('input side uses image.input; missing input → 0', () => {
		assert.equal(resolveImageCatalogUnitPrice(cfg, 'high', '1024x1024', 'input'), 0.02);
		assert.equal(
			resolveImageCatalogUnitPrice({ default: 0.04 }, 'high', '1024x1024', 'input'),
			0
		);
	});
});

describe('parsePricingProfile audio_billing_mode', () => {
	it('parses explicit per_second mode without tiers', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				audio_billing_mode: 'per_second',
				audio: { price_per_second: 0.0001, minimum_seconds: 1 },
			})
		);
		assert.ok(p);
		assert.equal(p!.audio_billing_mode, 'per_second');
		assert.equal(p!.tiers.length, 0);
		assert.equal(p!.audio!.price_per_second, 0.0001);
		assert.equal(profileHasAudioPerSecondPricing(p), true);
		assert.equal(resolveAudioBillingMode(p), 'per_second');
	});

	it('rejects negative price_per_second by ignoring audio block', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				audio_billing_mode: 'per_second',
				audio: { price_per_second: -1 },
				tiers: [{ upto: null, input_price: 0, output_price: 0 }],
			})
		);
		assert.ok(p);
		assert.equal(p!.audio, undefined);
		assert.equal(resolveAudioBillingMode(p), null);
	});

	it('computes billable seconds with minimum', () => {
		assert.equal(resolveBillableAudioSeconds(0.2, { price_per_second: 0.1, minimum_seconds: 1 }), 1);
		assert.equal(resolveBillableAudioSeconds(3.5, { price_per_second: 0.1 }), 3.5);
		assert.equal(computeAudioPerSecondMeteredCost({ durationSeconds: 0.5, pricePerSecond: 0.006 / 60 }), 0.006 / 60);
	});

	it('parses explicit token mode with tiers', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				audio_billing_mode: 'token',
				tiers: [{ upto: null, input_price: 1.25, output_price: 5 }],
			})
		);
		assert.ok(p);
		assert.equal(p!.audio_billing_mode, 'token');
		assert.equal(p!.tiers[0]!.input_price, 1.25);
		assert.equal(profileHasAudioTokenPricing(p), true);
		assert.equal(resolveAudioBillingMode(p), 'token');
		assert.equal(profileHasAudioPerSecondPricing(p), false);
	});

	it('parses TTS per_character mode and computes its minimum charge', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				audio_billing_mode: 'per_character',
				audio: { price_per_character: 0.0002, minimum_characters: 10 },
			})
		);
		assert.ok(p);
		assert.equal(p!.audio_billing_mode, 'per_character');
		assert.equal(p!.tiers.length, 0);
		assert.equal(profileHasAudioPerCharacterPricing(p), true);
		assert.equal(resolveAudioBillingMode(p), 'per_character');
		assert.equal(resolveBillableAudioCharacters(3, p!.audio), 10);
		assert.equal(
			computeAudioPerCharacterMeteredCost({
				characters: 3,
				pricePerCharacter: 0.0002,
				minimumCharacters: 10,
			}),
			0.002
		);
	});
});

describe('resolveImageBillingMode compatibility', () => {
	it('old profile: no mode + image_* → token', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				tiers: [{ upto: null, input_price: 1, output_price: 0, image_input_price: 8 }],
			})
		);
		assert.equal(resolveImageBillingMode(p), 'token');
	});

	it('old profile: no mode + legacy image only → null (no billing)', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				tiers: [{ upto: null, input_price: 0, output_price: 0 }],
				image: { default: 0.04 },
			})
		);
		assert.equal(resolveImageBillingMode(p), null);
	});
});

describe('parsePricingProfile catalog schedule', () => {
	it('defaults to empty schedule when omitted', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				tiers: [{ upto: null, input_price: 4.5, output_price: 13.5 }],
			})
		);
		assert.ok(p);
		assert.deepEqual(p!.schedule, []);
	});

	it('parses official windows including weekday-only', () => {
		const p = parsePricingProfile(
			JSON.stringify({
				tiers: [{ upto: null, input_price: 4.5, output_price: 13.5 }],
				schedule: [
					{ start: '00:30', end: '08:30', factor: 0.5 },
					{ start: '09:00', end: '12:00', factor: 1.6, days: [1, 2, 3, 4, 5] },
				],
			})
		);
		assert.ok(p);
		assert.equal(p!.schedule.length, 2);
		assert.equal(p!.schedule[0]!.factor, 0.5);
		assert.deepEqual(p!.schedule[1]!.days, [1, 2, 3, 4, 5]);
	});

	it('rejects overlapping windows and invalid shapes by failing the whole profile', () => {
		assert.equal(
			parsePricingProfile(
				JSON.stringify({
					tiers: [{ upto: null, input_price: 1, output_price: 2 }],
					schedule: [
						{ start: '00:00', end: '12:00', factor: 0.5 },
						{ start: '08:00', end: '18:00', factor: 1.2 },
					],
				})
			),
			null
		);
		assert.equal(
			parsePricingProfile(
				JSON.stringify({
					tiers: [{ upto: null, input_price: 1, output_price: 2 }],
					schedule: [{ start: '24:00', end: '08:00', factor: 0.5 }],
				})
			),
			null
		);
		assert.equal(
			parsePricingProfile(
				JSON.stringify({
					tiers: [{ upto: null, input_price: 1, output_price: 2 }],
					schedule: [{ start: '09:00', end: '09:00', factor: 1 }],
				})
			),
			null
		);
		assert.equal(
			parsePricingProfile(
				JSON.stringify({
					tiers: [{ upto: null, input_price: 1, output_price: 2 }],
					schedule: 'not-an-array',
				})
			),
			null
		);
	});
});

describe('resolve*BillingPrices catalog schedule factor', () => {
	const profile = JSON.stringify({
		tiers: [{ upto: null, input_price: 4, output_price: 12, cache_read_price: 0.4 }],
	});

	it('scales standard / supplier / charged after tier pick', () => {
		const standard = resolveStandardBillingPrices({
			basisInputTokens: 100,
			modelPricingProfileJson: profile,
			catalogScheduleFactor: 0.5,
		});
		const supplier = resolveSupplierBillingPrices({
			basisInputTokens: 100,
			modelPricingProfileJson: profile,
			catalogScheduleFactor: 0.5,
		});
		const charged = resolveChargedBillingPrices({
			basisInputTokens: 100,
			modelPricingProfileJson: profile,
			catalogScheduleFactor: 0.5,
		});
		assert.equal(standard.prices.input_price, 2);
		assert.equal(standard.prices.output_price, 6);
		assert.equal(standard.prices.cache_read_price, 0.2);
		assert.equal(supplier.prices.input_price, 2);
		assert.equal(charged.prices.input_price, 2);
	});
});
