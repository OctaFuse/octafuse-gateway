import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseToolFactorPricing, resolveToolFactorPrices, scaleToolUnitPrices } from './tool-pricing';
import {
	parseWebSearchCatalogInput,
	parseWebSearchCatalogLenient,
	serializeWebSearchCatalog,
	resolveWebSearchConfig,
} from './web-search-system-config';
import {
	parseWebFetchCatalogInput,
	parseWebFetchCatalogLenient,
	serializeWebFetchCatalog,
	resolveWebFetchConfig,
} from './web-fetch-system-config';
import {
	parseWebDeepSearchCatalogInput,
	parseWebDeepSearchCatalogLenient,
	serializeWebDeepSearchCatalog,
	resolveWebDeepSearchConfig,
} from './web-deep-search-system-config';
import {
	parseAiDetectionCatalogInput,
	parseAiDetectionCatalogLenient,
	serializeAiDetectionCatalog,
	resolveAiDetectionConfig,
} from './ai-detection-system-config';
import type { GatewayRepositories } from '../storage/repositories';
const pricing = { v: 2 as const, standard: 0.01, chargedFactor: 1.2, meteredFactor: 0.8 };
const families = [
	{
		key: 'WEB_SEARCH',
		provider: 'bocha',
		credentials: { apiKey: 'test' },
		parse: parseWebSearchCatalogInput,
		lenient: parseWebSearchCatalogLenient,
		serialize: serializeWebSearchCatalog,
		resolve: resolveWebSearchConfig,
	},
	{
		key: 'WEB_FETCH',
		provider: 'firecrawl',
		credentials: { apiKey: 'test' },
		parse: parseWebFetchCatalogInput,
		lenient: parseWebFetchCatalogLenient,
		serialize: serializeWebFetchCatalog,
		resolve: resolveWebFetchConfig,
	},
	{
		key: 'WEB_DEEP_SEARCH',
		provider: 'firecrawl',
		credentials: { apiKey: 'test' },
		parse: parseWebDeepSearchCatalogInput,
		lenient: parseWebDeepSearchCatalogLenient,
		serialize: serializeWebDeepSearchCatalog,
		resolve: resolveWebDeepSearchConfig,
	},
	{
		key: 'AI_DETECTION',
		provider: 'tencent_tms',
		credentials: { secretId: 'test', secretKey: 'test', billingUnitChars: 2000 },
		parse: parseAiDetectionCatalogInput,
		lenient: parseAiDetectionCatalogLenient,
		serialize: serializeAiDetectionCatalog,
		resolve: resolveAiDetectionConfig,
	},
];
describe('REST tool factor pricing', () => {
	it('shares rounding and factor precision with MCP, and supports free and markup', () => {
		assert.deepEqual(resolveToolFactorPrices(pricing), { standard: 0.01, charged: 0.012, metered: 0.008 });
		assert.deepEqual(resolveToolFactorPrices({ ...pricing, chargedFactor: 0 }), {
			standard: 0.01,
			charged: 0,
			metered: 0.008,
		});
		const rounded = parseToolFactorPricing({ ...pricing, standard: 0.1234567, chargedFactor: 0.123456789 });
		assert.equal(rounded?.chargedFactor, 0.123456789);
		assert.equal(rounded?.standard, 0.123457);
		assert.equal(resolveToolFactorPrices(rounded!).charged, 0.015242);
		assert.deepEqual(parseToolFactorPricing({ v: 2, standard: 1 }), {
			v: 2,
			standard: 1,
			chargedFactor: 1,
			meteredFactor: 1,
		});
	});
	for (const family of families) {
		it(`${family.key} round-trips factors without persisting derived prices`, async () => {
			const source = { [family.provider]: { ...family.credentials, pricing } };
			const raw = JSON.stringify(source);
			const catalog = family.parse(raw)!;
			assert.ok(catalog);
			assert.deepEqual(JSON.parse(family.serialize(catalog)), source);
			const config = await family.resolve({
				systemConfig: {
					getConfig: async (key: string) =>
						key === family.key + '_CATALOG' ? raw : key === family.key + '_ACTIVE' ? family.provider : null,
				},
			} as unknown as GatewayRepositories);
			assert.equal(config.ok, true);
			if (config.ok) {
				assert.equal(config.config.standard, 0.01);
				assert.equal(config.config.charged, 0.012);
				assert.equal(config.config.metered, 0.008);
				assert.deepEqual(config.config.pricing, pricing);
			}
		});
		it(`${family.key} preserves independent legacy prices, including a zero standard baseline`, () => {
			const raw = JSON.stringify({
				[family.provider]: { ...family.credentials, standard: 0, charged: 0.02, metered: 0.01 },
			});
			const catalog = family.parse(raw)!;
			const saved = JSON.parse(family.serialize(catalog))[family.provider];
			assert.equal(saved.standard, 0);
			assert.equal(saved.charged, 0.02);
			assert.equal(saved.metered, 0.01);
			assert.equal(saved.pricing, undefined);
			const costOnly = family.parse(
				JSON.stringify({ [family.provider]: { ...family.credentials, cost: 0.03 } })
			)!;
			const savedCost = JSON.parse(family.serialize(costOnly))[family.provider];
			assert.equal(savedCost.standard, 0.03);
			assert.equal(savedCost.charged, 0.03);
			assert.equal(savedCost.metered, 0.03);
		});
		it(`${family.key} rejects invalid new definitions on writes and never falls back to legacy on reads`, () => {
			for (const invalid of [
				null,
				{},
				{ ...pricing, v: 9 },
				{ ...pricing, chargedFactor: -1 },
				{ ...pricing, chargedFactor: true },
				{ ...pricing, meteredFactor: '' },
				{ ...pricing, standard: 1e200, chargedFactor: 1e200 },
			]) {
				const raw = JSON.stringify({ [family.provider]: { ...family.credentials, pricing: invalid } });
				assert.equal(family.parse(raw), null);
				assert.deepEqual(family.lenient(raw), {});
			}
			assert.equal(
				family.parse(JSON.stringify({ [family.provider]: { ...family.credentials, pricing, charged: 0 } })),
				null
			);
			const misplaced = JSON.stringify({ [family.provider]: { ...family.credentials, ...pricing } });
			assert.equal(family.parse(misplaced), null);
			assert.deepEqual(family.lenient(misplaced), {});
		});
	}
	it('scales the resolved three prices by character billing units, including free user calls', () => {
		assert.deepEqual(scaleToolUnitPrices(resolveToolFactorPrices(pricing), Math.ceil(2001 / 2000)), {
			standard: 0.02,
			charged: 0.024,
			metered: 0.016,
		});
		assert.deepEqual(scaleToolUnitPrices(resolveToolFactorPrices({ ...pricing, chargedFactor: 0 }), 2), {
			standard: 0.02,
			charged: 0,
			metered: 0.016,
		});
	});
});
