import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	McpPricingRuleError,
	parseMcpPricingRule,
	parseStoredMcpPricingRule,
	perCallMcpPricingRule,
	preflightMcpPricing,
	serializeMcpPricingRule,
	settleMcpPricing,
	summarizeMcpPricingRule,
} from './pricing';

const prices = { metered: 0.008, standard: 0.01, charged: 0.012 };
const factors = { v: 2, unit: 'request', standard: 0.01, chargedFactor: 1.2, meteredFactor: 0.8, config: {} };

describe('request MCP pricing', () => {
	it('stores only the standard price and factors in the versioned JSON envelope', () => {
		const rule = perCallMcpPricingRule(0.01, 1.2, 0.8);
		assert.deepEqual(rule, factors);
		assert.deepEqual(JSON.parse(serializeMcpPricingRule(rule)), factors);
		assert.deepEqual(parseStoredMcpPricingRule(serializeMcpPricingRule(rule)), rule);
		assert.deepEqual(summarizeMcpPricingRule(rule), { unit: 'request', ...prices });
	});
	it('always bills one request, independent of arguments and upstream usage', () => {
		const rule = perCallMcpPricingRule(0.01, 1.2, 0.8);
		const args = { search_depth: 'advanced', urls: Array(25).fill('u'), page_count: 100 };
		const result = { structuredContent: { usage: { credits: 999 } } };
		for (const quote of [preflightMcpPricing(rule, args), settleMcpPricing(rule, args, result)]) {
			assert.equal(quote.units, 1);
			assert.deepEqual(quote.totals, prices);
		}
	});
	it('keeps supplier costs for free users and supports zero supplier cost or markup', () => {
		assert.deepEqual(settleMcpPricing(perCallMcpPricingRule(0.02, 0, 0.5), {}, {}).totals, {
			metered: 0.01,
			standard: 0.02,
			charged: 0,
		});
		assert.deepEqual(settleMcpPricing(perCallMcpPricingRule(0.02, 3, 0), {}, {}).totals, {
			metered: 0,
			standard: 0.02,
			charged: 0.06,
		});
		assert.deepEqual(summarizeMcpPricingRule(perCallMcpPricingRule(0, 5, 3)), {
			unit: 'request',
			metered: 0,
			standard: 0,
			charged: 0,
		});
	});
	it('defaults both factors to one, with strict explicit input validation', () => {
		assert.deepEqual(parseMcpPricingRule({ v: 2, standard: 0.01 }), perCallMcpPricingRule(0.01));
		for (const key of ['standard', 'chargedFactor', 'meteredFactor']) {
			for (const value of [-1, '', ' ', NaN, Infinity, null, true, {}, []])
				assert.throws(() => parseMcpPricingRule({ ...factors, [key]: value }), McpPricingRuleError);
		}
		assert.throws(() => perCallMcpPricingRule(Number.MAX_VALUE), McpPricingRuleError);
		assert.throws(() => perCallMcpPricingRule(1e200, 1e200), McpPricingRuleError);
	});
	it('rounds the standard price and resolved amounts to six decimals, retaining factor precision', () => {
		const rule = perCallMcpPricingRule(0.1234567, 0.123456789, 0.000000001);
		assert.equal(rule.standard, 0.123457);
		assert.equal(rule.chargedFactor, 0.123456789);
		assert.deepEqual(summarizeMcpPricingRule(rule), {
			unit: 'request',
			standard: 0.123457,
			charged: 0.015242,
			metered: 0,
		});
		const quote = preflightMcpPricing(rule, {});
		quote.unitPrices.charged = 99;
		assert.equal(summarizeMcpPricingRule(rule).charged, 0.015242);
	});
	it('reads legacy request JSON without rewriting it or changing any amount', () => {
		for (const legacyPrices of [prices, { metered: 0.01, standard: 0, charged: 0.02 }]) {
			const legacy = { v: 1, unit: 'request', prices: legacyPrices, config: {} };
			const stored = JSON.stringify({
				...legacy,
				base: 1,
				terms: [],
				guards: [],
				min: null,
				max: null,
				estimate: null,
			});
			const parsed = parseStoredMcpPricingRule(stored);
			assert.deepEqual(parsed, legacy);
			assert.deepEqual(JSON.parse(serializeMcpPricingRule(parsed)), legacy);
			assert.deepEqual(preflightMcpPricing(parsed, {}).totals, legacyPrices);
			assert.deepEqual(settleMcpPricing(parsed, {}, {}).totals, legacyPrices);
		}
		assert.deepEqual(parseMcpPricingRule({ prices }), { v: 1, unit: 'request', prices, config: {} });
	});
	it('rejects unsupported modes, mixed price definitions and legacy variable behavior', () => {
		const cases: Array<[Record<string, unknown>, string]> = [
			[{ unit: 'credit' }, 'pricing.unit'],
			[{ unit: 'page' }, 'pricing.unit'],
			[{ unit: 'toString' }, 'pricing.unit'],
			[{ base: 2 }, 'pricing.base'],
			[{ base: 0 }, 'pricing.base'],
			[{ base: true }, 'pricing.base'],
			[{ terms: [{ kind: 'match' }] }, 'pricing.terms'],
			[{ guards: [{ kind: 'max' }] }, 'pricing.guards'],
			[{ terms: {} }, 'pricing.terms'],
			[{ max: 20 }, 'pricing.max'],
			[{ min: 1 }, 'pricing.min'],
			[{ estimate: 1 }, 'pricing.estimate'],
			[{ config: { pages: 5 } }, 'pricing.config'],
			[{ config: null }, 'pricing.config'],
			[{ v: 3 }, 'pricing.v'],
			[{ mode: 'page' }, 'pricing.mode'],
		];
		for (const [patch, at] of cases)
			assert.throws(
				() => parseMcpPricingRule({ prices, ...patch }),
				(error) => error instanceof McpPricingRuleError && error.at === at
			);
		assert.throws(() => parseMcpPricingRule({ ...factors, prices }), /pricing.prices/);
		assert.throws(() => parseMcpPricingRule({ v: 1, prices, chargedFactor: 1 }), /pricing.chargedFactor/);
	});
	it('rejects malformed storage and checks mode registration before serializing', () => {
		assert.throws(() => parseStoredMcpPricingRule('{broken'), /pricing: is not valid JSON/);
		assert.throws(
			() => serializeMcpPricingRule({ ...perCallMcpPricingRule(), unit: 'future-mode' }),
			/unsupported billing mode/
		);
	});
});
