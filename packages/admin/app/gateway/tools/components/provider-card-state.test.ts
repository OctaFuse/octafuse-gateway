import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	draftPricesOk,
	draftsForProviderSave,
	priceMultiplier,
	formatPriceSummary,
	isDraftDirty,
	isLossPricing,
	parseDraftMoney,
	resolveCompactStatusBadges,
	resolveProviderCardActions,
	resolveProviderCardStatus,
	showConfiguredDot,
	wouldClearSavedActiveCredentials,
	type ProviderCardStatusFlags,
} from './provider-card-state';

describe('provider-card-state', () => {
	it('parseDraftMoney rejects empty and negative', () => {
		assert.equal(parseDraftMoney(''), null);
		assert.equal(parseDraftMoney('  '), null);
		assert.equal(parseDraftMoney('-1'), null);
		assert.equal(parseDraftMoney('0.003'), 0.003);
	});

	it('draftPricesOk requires all three non-negative numbers', () => {
		assert.equal(draftPricesOk({ metered: '1', standard: '1', charged: '1' }), true);
		assert.equal(draftPricesOk({ metered: '', standard: '1', charged: '1' }), false);
	});

	it('isLossPricing when charged < metered', () => {
		assert.equal(isLossPricing({ metered: '0.003', charged: '0.001' }), true);
		assert.equal(isLossPricing({ metered: '0.001', charged: '0.003' }), false);
		assert.equal(isLossPricing({ metered: 'x', charged: '1' }), false);
	});

	it('isDraftDirty ignores key order', () => {
		assert.equal(isDraftDirty({ a: '1', b: '2' }, { b: '2', a: '1' }), false);
		assert.equal(isDraftDirty({ a: '1' }, { a: '2' }), true);
	});

	it('resolveProviderCardStatus maps flags', () => {
		const status = resolveProviderCardStatus({
			providerId: 'bocha',
			selectedId: 'tavily',
			savedActiveId: 'bocha',
			isConfigured: true,
			isImplemented: true,
			prices: { metered: '0.002', standard: '0.003', charged: '0.001' },
			draft: { apiKey: 'x' },
			savedDraft: { apiKey: 'y' },
		});
		assert.equal(status.isActive, true);
		assert.equal(status.isSelected, false);
		assert.equal(status.isDirty, true);
		assert.equal(status.isConfigured, true);
		assert.equal(status.isLossPricing, true);
	});

	it('resolveProviderCardActions gates save & activate', () => {
		assert.deepEqual(
			resolveProviderCardActions({
				catalogPricesValid: true,
				selectedIsActive: false,
				selectedConfigured: true,
			}),
			{ canSaveConfig: true, canSaveAndActivate: true }
		);
		assert.deepEqual(
			resolveProviderCardActions({
				catalogPricesValid: true,
				selectedIsActive: true,
				selectedConfigured: true,
			}),
			{ canSaveConfig: true, canSaveAndActivate: false }
		);
		assert.deepEqual(
			resolveProviderCardActions({
				catalogPricesValid: true,
				selectedIsActive: false,
				selectedConfigured: false,
			}),
			{ canSaveConfig: true, canSaveAndActivate: false }
		);
		assert.deepEqual(
			resolveProviderCardActions({
				catalogPricesValid: false,
				selectedIsActive: false,
				selectedConfigured: true,
			}),
			{ canSaveConfig: false, canSaveAndActivate: false }
		);
		assert.deepEqual(
			resolveProviderCardActions({
				catalogPricesValid: true,
				selectedIsActive: false,
				selectedConfigured: true,
				selectedImplemented: false,
			}),
			{ canSaveConfig: true, canSaveAndActivate: false }
		);
	});

	it('wouldClearSavedActiveCredentials detects clearing previous active key', () => {
		assert.equal(
			wouldClearSavedActiveCredentials({
				savedActiveId: 'bocha',
				nextActiveId: 'tavily',
				hasCredentialsAfterSave: (id) => id !== 'bocha',
			}),
			true
		);
		assert.equal(
			wouldClearSavedActiveCredentials({
				savedActiveId: 'bocha',
				nextActiveId: 'bocha',
				hasCredentialsAfterSave: () => false,
			}),
			false
		);
		assert.equal(
			wouldClearSavedActiveCredentials({
				savedActiveId: 'bocha',
				nextActiveId: 'tavily',
				hasCredentialsAfterSave: () => true,
			}),
			false
		);
	});

	it('formatPriceSummary joins triple with S/C/M prefixes', () => {
		assert.equal(
			formatPriceSummary({ standard: '0.003', charged: '0.003', metered: '0.001' }),
			'S 0.003 · C 0.003 · M 0.001'
		);
	});

	it('resolveCompactStatusBadges prefers active/unsaved/exception over configured text', () => {
		const base: ProviderCardStatusFlags = {
			isActive: false,
			isSelected: false,
			isDirty: false,
			isConfigured: true,
			isImplemented: true,
			isLossPricing: false,
		};
		assert.deepEqual(resolveCompactStatusBadges(base), []);
		assert.equal(showConfiguredDot(base), true);

		assert.deepEqual(resolveCompactStatusBadges({ ...base, isActive: true }), ['active']);
		assert.equal(showConfiguredDot({ ...base, isActive: true }), false);

		assert.deepEqual(
			resolveCompactStatusBadges({
				...base,
				isDirty: true,
				isConfigured: false,
				isLossPricing: true,
			}),
			['unsaved', 'missing', 'loss']
		);

		assert.deepEqual(
			resolveCompactStatusBadges({
				...base,
				isConfigured: false,
				isImplemented: false,
			}),
			['unavailable']
		);
		assert.equal(showConfiguredDot({ ...base, isConfigured: false, isImplemented: false }), false);
	});
});

describe('single-provider save scope', () => {
	it('keeps sibling drafts out of the saved catalog, including invalid prices and cleared credentials', () => {
		const saved = { a: { apiKey: 'existing', price: '1' }, b: { apiKey: '', price: '2' } };
		const drafts = { a: { apiKey: '', price: '-1' }, b: { apiKey: 'new', price: '3' } };
		const result = draftsForProviderSave(saved, drafts, 'b');
		assert.deepEqual(result, { a: saved.a, b: drafts.b });
		assert.deepEqual(drafts.a, { apiKey: '', price: '-1' });
		result.b.price = '4';
		assert.equal(drafts.b.price, '3');
		assert.equal(saved.b.price, '2');
	});
	it('keeps unsaved siblings dirty after saving the current provider', () => {
		const saved = { a: { price: '1' }, b: { price: '2' } };
		const drafts = { a: { price: '3' }, b: { price: '4' } };
		const nextSaved = draftsForProviderSave(saved, drafts, 'a');
		assert.equal(isDraftDirty(drafts.a, nextSaved.a), false);
		assert.equal(isDraftDirty(drafts.b, nextSaved.b), true);
	});
});

describe('service price multipliers', () => {
	it('shows zero, fractional and greater-than-one factors', () => {
		assert.equal(priceMultiplier('0', '0.001'), 0);
		assert.equal(priceMultiplier('0.001', '0.002'), 0.5);
		assert.equal(priceMultiplier('0.006', '0.002'), 3);
	});
	it('omits undefined and invalid factors', () => {
		for (const [amount, standard] of [
			['0', '0'],
			['1', '0'],
			['', '1'],
			['-1', '1'],
			['1', 'bad'],
			['1e308', '1e-308'],
		])
			assert.equal(priceMultiplier(amount!, standard!), null);
	});
});
