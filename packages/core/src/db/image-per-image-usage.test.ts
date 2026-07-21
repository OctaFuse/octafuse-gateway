import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeImagePerImageMeteredCost } from './image-per-image-usage';

describe('computeImagePerImageMeteredCost', () => {
	it('computes output + reference line items', () => {
		const cost = computeImagePerImageMeteredCost({
			outputCount: 2,
			referenceCount: 3,
			outputUnitPrice: 0.05,
			inputUnitPrice: 0.01,
		});
		assert.equal(cost, 0.13);
	});

	it('floors negative counts to zero', () => {
		const cost = computeImagePerImageMeteredCost({
			outputCount: -1,
			referenceCount: 1.9,
			outputUnitPrice: 0.04,
			inputUnitPrice: 0,
		});
		assert.equal(cost, 0);
	});

	it('handles zero unit prices', () => {
		const cost = computeImagePerImageMeteredCost({
			outputCount: 4,
			referenceCount: 2,
			outputUnitPrice: 0,
			inputUnitPrice: 0.02,
		});
		assert.equal(cost, 0.04);
	});
});
