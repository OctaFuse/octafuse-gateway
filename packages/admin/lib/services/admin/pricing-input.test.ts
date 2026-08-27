import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	assertRoutePriceOverrideMatchesCatalog,
	coerceModelPricingProfileInput,
	coerceRoutePriceOverrideInput,
	routePriceOverrideHasScheduleWindows,
} from './pricing-input';

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

	it('accepts a valid catalog schedule on the model profile', () => {
		const json = coerceModelPricingProfileInput({
			tiers: [{ upto: null, input_price: 4.5, output_price: 13.5 }],
			schedule: [{ start: '00:30', end: '08:30', factor: 0.5 }],
		});
		assert.ok(json);
		const obj = JSON.parse(json!) as { schedule: unknown[] };
		assert.equal(obj.schedule.length, 1);
	});

	it('rejects overlapping catalog schedule windows', () => {
		assert.throws(
			() =>
				coerceModelPricingProfileInput({
					tiers: [{ upto: null, input_price: 1, output_price: 2 }],
					schedule: [
						{ start: '00:00', end: '12:00', factor: 0.5 },
						{ start: '08:00', end: '18:00', factor: 1.2 },
					],
				}),
			(error: unknown) =>
				error instanceof Error &&
				'status' in error &&
				(error as { status: unknown }).status === 400
		);
	});
});

describe('assertRoutePriceOverrideMatchesCatalog', () => {
	const catalog = JSON.stringify({
		tiers: [{ upto: null, input_price: 1, output_price: 2 }],
		schedule: [
			{ start: '00:30', end: '08:30', factor: 0.5 },
			{ start: '09:00', end: '12:00', factor: 1.6, days: [1, 2, 3, 4, 5] },
		],
	});

	it('treats empty route schedule as no time-window multipliers', () => {
		assert.equal(routePriceOverrideHasScheduleWindows(null), false);
		assert.equal(routePriceOverrideHasScheduleWindows('{}'), false);
		assert.equal(
			routePriceOverrideHasScheduleWindows(JSON.stringify({ charged_factor: 1.2 })),
			false
		);
		assert.equal(
			routePriceOverrideHasScheduleWindows(
				JSON.stringify({ schedule: { charged: [{ start: '00:00', end: '08:00', factor: 1 }] } })
			),
			true
		);
	});

	it('allows free route windows when the model has no catalog schedule', () => {
		assert.doesNotThrow(() =>
			assertRoutePriceOverrideMatchesCatalog(
				JSON.stringify({ tiers: [{ upto: null, input_price: 1, output_price: 2 }] }),
				JSON.stringify({
					schedule: { charged: [{ start: '01:00', end: '02:00', factor: 2 }] },
				})
			)
		);
	});

	it('rejects a route that is missing a catalog window', () => {
		assert.throws(
			() =>
				assertRoutePriceOverrideMatchesCatalog(
					catalog,
					JSON.stringify({
						schedule: {
							mode: 'override',
							charged: [{ start: '00:30', end: '08:30', factor: 1 }],
							metered: [
								{ start: '00:30', end: '08:30', factor: 1 },
								{ start: '09:00', end: '12:00', factor: 1, days: [1, 2, 3, 4, 5] },
							],
						},
					})
				),
			(error: unknown) =>
				error instanceof Error &&
				'status' in error &&
				(error as { status: unknown }).status === 400 &&
				error.message.includes('schedule.charged missing')
		);
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

	it('keeps legacy schedule JSON without mode', () => {
		assert.equal(
			coerceRoutePriceOverrideInput({
				charged_factor: 1,
				schedule: { charged: [{ start: '09:00', end: '12:00', factor: 2 }] },
			}),
			JSON.stringify({
				charged_factor: 1,
				schedule: { charged: [{ start: '09:00', end: '12:00', factor: 2 }] },
			})
		);
	});

	it('round-trips schedule.mode override', () => {
		assert.equal(
			coerceRoutePriceOverrideInput({
				charged_factor: 1,
				metered_factor: 1,
				schedule: {
					mode: 'override',
					charged: [{ start: '09:00', end: '12:00', factor: 2 }],
					metered: [{ start: '09:00', end: '12:00', factor: 2 }],
				},
			}),
			JSON.stringify({
				charged_factor: 1,
				metered_factor: 1,
				schedule: {
					mode: 'override',
					charged: [{ start: '09:00', end: '12:00', factor: 2 }],
					metered: [{ start: '09:00', end: '12:00', factor: 2 }],
				},
			})
		);
	});

	it('round-trips schedule window days', () => {
		assert.equal(
			coerceRoutePriceOverrideInput({
				charged_factor: 1,
				schedule: {
					mode: 'override',
					charged: [{ start: '00:00', end: '24:00', factor: 1.2, days: [1, 2, 3, 4, 5] }],
				},
			}),
			JSON.stringify({
				charged_factor: 1,
				schedule: {
					mode: 'override',
					charged: [{ start: '00:00', end: '24:00', factor: 1.2, days: [1, 2, 3, 4, 5] }],
				},
			})
		);
	});

	it('rejects unknown schedule.mode', () => {
		assert.throws(
			() =>
				coerceRoutePriceOverrideInput({
					schedule: { mode: 'divide', charged: [{ start: '09:00', end: '12:00', factor: 2 }] },
				}),
			(error: unknown) =>
				error instanceof Error &&
				'status' in error &&
				(error as { status: unknown }).status === 400
		);
	});
});
