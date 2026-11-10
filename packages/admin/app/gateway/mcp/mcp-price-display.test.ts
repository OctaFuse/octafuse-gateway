import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { McpPricingRule } from '@octafuse/core/mcp/pricing';
import { mcpPriceMultiplier } from './mcp-price-display';

describe('MCP price display', () => {
	it('preserves configured v2 factors even when all amounts are zero', () => {
		const rule: McpPricingRule = {
			v: 2,
			unit: 'request',
			config: {},
			standard: 0,
			chargedFactor: 0,
			meteredFactor: 1,
		};
		assert.equal(mcpPriceMultiplier(rule, 'charged'), 0);
		assert.equal(mcpPriceMultiplier(rule, 'metered'), 1);
	});
	it('derives factors from independent legacy prices', () => {
		const rule: McpPricingRule = {
			v: 1,
			unit: 'request',
			config: {},
			prices: { standard: 0.01, charged: 0.005, metered: 0.012 },
		};
		assert.equal(mcpPriceMultiplier(rule, 'charged'), 0.5);
		assert.equal(mcpPriceMultiplier(rule, 'metered'), 1.2);
	});
	it('does not invent a ratio for zero-standard legacy charges', () => {
		const rule: McpPricingRule = {
			v: 1,
			unit: 'request',
			config: {},
			prices: { standard: 0, charged: 0.005, metered: 0 },
		};
		assert.equal(mcpPriceMultiplier(rule, 'charged'), null);
		assert.equal(mcpPriceMultiplier(rule, 'metered'), null);
	});
	it('does not display an overflowing legacy ratio', () => {
		const rule: McpPricingRule = {
			v: 1,
			unit: 'request',
			config: {},
			prices: { standard: 1e-308, charged: 1e308, metered: 0 },
		};
		assert.equal(mcpPriceMultiplier(rule, 'charged'), null);
	});
});
