import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getModelCardPricing } from './model-utils';
const model = {
	input_modalities: '["text"]',
	output_modalities: '["embedding"]',
	pricing_profile: JSON.stringify({
		tiers: [{ upto: null, input_price: 0.07, output_price: 0.2 }],
	}),
};
describe('model card price semantics', () => {
	it('shows input prices only for embeddings', () => {
		assert.deepEqual(getModelCardPricing(model, 'USD', 'Unavailable'), {
			amount: '$0.07',
			unit: '/M',
			tierCount: 1,
		});
	});
	it('preserves input and output prices for language models', () => {
		assert.equal(
			getModelCardPricing(
				{ ...model, output_modalities: '["text"]' },
				'USD',
				'Unavailable'
			).amount,
			'$0.07 / $0.2'
		);
	});
	it('keeps missing pricing unavailable', () => {
		assert.equal(
			getModelCardPricing(
				{ ...model, pricing_profile: null },
				'USD',
				'Unavailable'
			).amount,
			'Unavailable'
		);
	});
});
