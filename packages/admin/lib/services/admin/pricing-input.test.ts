import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coerceRoutePriceOverrideInput } from './pricing-input';

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
