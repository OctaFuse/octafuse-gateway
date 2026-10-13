import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { updateAdminSystemConfigService } from './dashboard-service';
const pricing = { v: 2, standard: 0.01, chargedFactor: 1.2, meteredFactor: 0.8 };
describe('admin REST pricing persistence', () => {
	for (const [key, provider, credentials] of [
		['WEB_SEARCH_CATALOG', 'bocha', { apiKey: 'test' }],
		['WEB_FETCH_CATALOG', 'firecrawl', { apiKey: 'test' }],
		['WEB_DEEP_SEARCH_CATALOG', 'firecrawl', { apiKey: 'test' }],
		['AI_DETECTION_CATALOG', 'tencent_tms', { secretId: 'test', secretKey: 'test', billingUnitChars: 3000 }],
	] as const) {
		it(`${key} persists only canonical factors and rejects invalid factors before writes`, async () => {
			const writes: string[] = [];
			const repos = {
				systemConfig: {
					getConfig: async () => provider,
					upsertSystemConfigValue: async (_key: string, value: string) => {
						writes.push(value);
					},
				},
			} as unknown as GatewayRepositories;
			const source = { [provider]: { ...credentials, pricing } };
			await updateAdminSystemConfigService(repos, { key, value: JSON.stringify(source) });
			assert.deepEqual(JSON.parse(writes[0]), source);
			await assert.rejects(
				updateAdminSystemConfigService(repos, {
					key,
					value: JSON.stringify({
						[provider]: { ...credentials, pricing: { ...pricing, chargedFactor: -1 } },
					}),
				})
			);
			assert.equal(writes.length, 1);
		});
	}
});
