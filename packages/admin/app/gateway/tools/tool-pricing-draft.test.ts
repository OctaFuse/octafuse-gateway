import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	restPricingDraftFromEntry,
	restFactorDraft,
	restPricingDraftChanged,
	restPricingFieldsFromDraft,
} from './tool-pricing-draft';
import { toolCatalogPricingForStorage } from '@octafuse/core/lib/tool-pricing';
const legacy = { standard: 0.01, charged: 0.012, metered: 0.008, cost: 0.012 };
describe('REST factor pricing drafts', () => {
	it('preserves legacy prices until the operator edits pricing, including on credential-only changes', () => {
		const draft = restPricingDraftFromEntry(legacy);
		assert.equal(draft.factorPricing, undefined);
		assert.deepEqual(toolCatalogPricingForStorage(restPricingFieldsFromDraft(draft)!), legacy);
		const factorDraft = restFactorDraft(draft);
		assert.deepEqual(factorDraft, { standard: '0.01', chargedFactor: '1.2', meteredFactor: '0.8' });
		const changed = restPricingDraftChanged(factorDraft);
		assert.deepEqual(toolCatalogPricingForStorage(restPricingFieldsFromDraft(changed)!), {
			pricing: { v: 2, standard: 0.01, chargedFactor: 1.2, meteredFactor: 0.8 },
		});
	});
	it('makes zero-baseline legacy prices require explicit repricing while preserving untouched prices', () => {
		const original = { ...legacy, standard: 0 };
		const draft = restPricingDraftFromEntry(original);
		assert.equal(restFactorDraft(draft).legacyNeedsReview, true);
		assert.deepEqual(toolCatalogPricingForStorage(restPricingFieldsFromDraft(draft)!), original);
		assert.equal(restPricingFieldsFromDraft(restPricingDraftChanged(restFactorDraft(draft))), null);
	});
	it('reloads exact factors and keeps supplier costs when switching to free', () => {
		const pricing = { v: 2 as const, standard: 0.01, chargedFactor: 1.23456789, meteredFactor: 0.8 };
		const draft = restPricingDraftFromEntry({ ...legacy, pricing });
		assert.equal(draft.factorPricing?.chargedFactor, '1.23456789');
		const free = restPricingFieldsFromDraft(
			restPricingDraftChanged({ ...restFactorDraft(draft), chargedFactor: '0' })
		)!;
		assert.equal(free.charged, 0);
		assert.equal(free.metered, 0.008);
	});
	it('blocks partial, negative and overflowing factor edits from being saved', () => {
		assert.equal(restPricingFieldsFromDraft({ standard: '', charged: '', metered: '' }), null);
		for (const chargedFactor of ['', '-1', 'Infinity', 'NaN']) {
			const changed = restPricingDraftChanged({ standard: '0.01', meteredFactor: '0.8', chargedFactor });
			assert.equal(restPricingFieldsFromDraft(changed), null);
		}
	});
});
