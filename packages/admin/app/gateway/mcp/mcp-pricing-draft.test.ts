import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { perCallMcpPricingRule, resolveMcpUnitPrices, type McpPricingRule } from '@octafuse/core/mcp/pricing';
import { DEFAULT_PRICING_DRAFT, pricingDraftFromRule, pricingRuleFromDraft } from './mcp-pricing-draft';

const rule = perCallMcpPricingRule(0.01, 1.2, 0.8);
const legacy: McpPricingRule = {
	v: 1,
	unit: 'request',
	prices: { standard: 0.01, charged: 0.012, metered: 0.008 },
	config: {},
};

describe('factor pricing draft', () => {
	it('round-trips standard price and both factors without persisting derived prices', () => {
		assert.deepEqual(pricingRuleFromDraft(pricingDraftFromRule(rule)), { ok: true, rule });
		assert.equal('prices' in rule, false);
	});
	it('converts representable legacy prices without changing any amount', () => {
		const parsed = pricingRuleFromDraft(pricingDraftFromRule(legacy));
		assert.equal(parsed.ok, true);
		if (parsed.ok) assert.deepEqual(resolveMcpUnitPrices(parsed.rule), legacy.prices);
	});
	it('requires explicit repricing when a zero standard price has non-zero costs or charges', () => {
		for (const prices of [
			{ standard: 0, metered: 0.01, charged: 0 },
			{ standard: 0, metered: 0, charged: 0.02 },
		]) {
			const draft = pricingDraftFromRule({ ...legacy, prices });
			assert.equal(draft.legacyNeedsReview, true);
			assert.equal(pricingRuleFromDraft(draft).ok, false);
		}
	});
	it('requires explicit repair for invalid stored rules, while new defaults are valid and free', () => {
		assert.equal(pricingRuleFromDraft(pricingDraftFromRule(null)).ok, false);
		assert.deepEqual(pricingDraftFromRule(undefined), DEFAULT_PRICING_DRAFT);
		const parsed = pricingRuleFromDraft(DEFAULT_PRICING_DRAFT);
		assert.equal(parsed.ok, true);
		if (parsed.ok) assert.equal(resolveMcpUnitPrices(parsed.rule).charged, 0);
	});
	it('rejects incomplete, negative, non-finite and overflowing definitions', () => {
		for (const value of ['', ' ', '-1', 'NaN', 'Infinity'])
			for (const key of ['standard', 'chargedFactor', 'meteredFactor'])
				assert.equal(pricingRuleFromDraft({ ...DEFAULT_PRICING_DRAFT, [key]: value }).ok, false);
		assert.equal(
			pricingRuleFromDraft({ standard: '1e200', chargedFactor: '1e200', meteredFactor: '1' }).ok,
			false
		);
	});
	it('free user multiplier keeps supplier costs', () => {
		const draft = { ...pricingDraftFromRule(rule), chargedFactor: '0' };
		const parsed = pricingRuleFromDraft(draft);
		assert.equal(parsed.ok, true);
		if (parsed.ok)
			assert.deepEqual(resolveMcpUnitPrices(parsed.rule), { standard: 0.01, charged: 0, metered: 0.008 });
	});
	it('uses the same rounding and factor precision as core settlement', () => {
		const parsed = pricingRuleFromDraft({
			standard: '0.1234567',
			chargedFactor: '0.123456789',
			meteredFactor: '1',
		});
		assert.equal(parsed.ok, true);
		if (parsed.ok) {
			assert.equal(parsed.rule.chargedFactor, 0.123456789);
			assert.deepEqual(resolveMcpUnitPrices(parsed.rule), {
				standard: 0.123457,
				charged: 0.015242,
				metered: 0.123457,
			});
		}
	});
});
