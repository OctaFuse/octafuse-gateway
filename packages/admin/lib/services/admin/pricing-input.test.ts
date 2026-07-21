import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coerceModelPricingProfileInput, coerceRoutePriceOverrideInput } from './pricing-input';

describe('coerceModelPricingProfileInput', () => {
	it('rejects token mode with image.default', () => {
		assert.throws(
			() =>
				coerceModelPricingProfileInput({
					image_billing_mode: 'token',
					tiers: [
						{
							upto: null,
							input_price: 5,
							output_price: 0,
							image_output_price: 30,
						},
					],
					image: { default: 0.05 },
				}),
			(error: unknown) =>
				error instanceof Error &&
				'status' in error &&
				(error as { status: unknown }).status === 400 &&
				error.message.includes('image_billing_mode "token"')
		);
	});

	it('requires image.default for per_image mode', () => {
		assert.throws(
			() =>
				coerceModelPricingProfileInput({
					image_billing_mode: 'per_image',
				}),
			(error: unknown) =>
				error instanceof Error &&
				'status' in error &&
				(error as { status: unknown }).status === 400 &&
				error.message.includes('image.default')
		);
	});

	it('rejects positive tier image_* under per_image mode', () => {
		assert.throws(
			() =>
				coerceModelPricingProfileInput({
					image_billing_mode: 'per_image',
					tiers: [
						{
							upto: null,
							input_price: 0,
							output_price: 0,
							image_output_price: 13.43,
						},
					],
					image: { default: 0.22 },
				}),
			(error: unknown) =>
				error instanceof Error &&
				'status' in error &&
				(error as { status: unknown }).status === 400 &&
				error.message.includes('image_output_price')
		);
	});

	it('accepts valid per_image profile and strips placeholder tiers', () => {
		const json = coerceModelPricingProfileInput({
			image_billing_mode: 'per_image',
			tiers: [{ upto: null, input_price: 0, output_price: 0 }],
			image: { default: 0.22, uncertain_result_policy: 'requested' },
		});
		assert.ok(json);
		const obj = JSON.parse(json!) as Record<string, unknown>;
		assert.equal(obj.image_billing_mode, 'per_image');
		assert.equal(obj.tiers, undefined);
		assert.deepEqual(obj.image, { default: 0.22 });
	});

	it('accepts legacy profile without image_billing_mode', () => {
		const json = coerceModelPricingProfileInput({
			tiers: [{ upto: null, input_price: 2, output_price: 12 }],
			image: { default: 0.05 },
		});
		assert.ok(json);
	});
});

describe('coerceRoutePriceOverrideInput', () => {
	it('normalizes complete non-negative numeric strings', () => {
		assert.equal(
			coerceRoutePriceOverrideInput({ charged_factor: '0.5', metered_factor: '1.25' }),
			JSON.stringify({ charged_factor: 0.5, metered_factor: 1.25 })
		);
	});

	it('rejects negative, malformed, and non-numeric factor values', () => {
		for (const value of [-1, '0abc', '1foo', true]) {
			assert.throws(
				() => coerceRoutePriceOverrideInput({ charged_factor: value }),
				(error: unknown) =>
					error instanceof Error &&
					'status' in error &&
					(error as { status: unknown }).status === 400
			);
		}
	});

	it('keeps the intentional legacy-tier removal on write', () => {
		assert.equal(
			coerceRoutePriceOverrideInput({
				charged: { tiers: [{ upto: null, input_price: 9, output_price: 9 }] },
				metered: { tiers: [{ upto: null, input_price: 8, output_price: 8 }] },
				charged_factor: 1.1,
			}),
			JSON.stringify({ charged_factor: 1.1 })
		);
	});

	it('rejects 24:00 as a schedule start', () => {
		assert.throws(
			() =>
				coerceRoutePriceOverrideInput({
					schedule: { charged: [{ start: '24:00', end: '00:00', factor: 1 }] },
				}),
			(error: unknown) =>
				error instanceof Error &&
				'status' in error &&
				(error as { status: unknown }).status === 400
		);
	});
});
