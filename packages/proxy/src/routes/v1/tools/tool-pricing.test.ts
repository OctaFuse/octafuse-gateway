import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { GatewayRepositories } from '@octafuse/core';
import type { Env } from '../../../app';
import { requireApiKey } from '../../../middleware/auth';
import { webSearchRoutes } from './web-search';
import { webFetchRoutes } from './web-fetch';
import { webDeepSearchRoutes } from './web-deep-search';
import { aiDetectionRoutes } from './ai-detection';
import { toolsPricingRoutes } from './pricing';
const pricing = { v: 2, standard: 0.01, chargedFactor: 1.2, meteredFactor: 0.8 };
type Statement = { sql: string; values: unknown[]; bind: (...values: unknown[]) => Statement };
function fixture(factors = pricing, budgetMax = 0) {
	const statements: Statement[] = [];
	const catalogs: Record<string, string> = {
		WEB_SEARCH_CATALOG: JSON.stringify({ bocha: { apiKey: 'test', pricing: factors } }),
		WEB_SEARCH_ACTIVE: 'bocha',
		WEB_FETCH_CATALOG: JSON.stringify({ firecrawl: { apiKey: 'test', pricing: factors } }),
		WEB_FETCH_ACTIVE: 'firecrawl',
		WEB_DEEP_SEARCH_CATALOG: JSON.stringify({ firecrawl: { apiKey: 'test', pricing: factors } }),
		WEB_DEEP_SEARCH_ACTIVE: 'firecrawl',
		AI_DETECTION_CATALOG: JSON.stringify({
			tencent_tms: { secretId: 'test', secretKey: 'test', billingUnitChars: 2000, pricing: factors },
		}),
		AI_DETECTION_ACTIVE: 'tencent_tms',
	};
	const db = {
		prepare: (sql: string) => {
			const statement: Statement = {
				sql,
				values: [],
				bind(...values) {
					this.values = values;
					return this;
				},
			};
			return statement;
		},
		batch: async (batch: Statement[]) => {
			statements.push(...batch);
			return batch.map(() => ({ success: true, meta: {} }));
		},
	};
	const repos = {
		client: { driver: 'd1', raw: db, drizzle: {} },
		apiKeys: {
			getApiKeyWithUserByKey: async (key: string) =>
				key === 'sk-test'
					? {
							id: 'key',
							user_id: 'user',
							budget_max: budgetMax,
							budget_spent: 0,
							budget_base: 0,
							budget_period: 'none',
							budget_reset_at: null,
							wallet_granted: 0,
							wallet_spent: 0,
					  }
					: null,
		},
		systemConfig: { getConfig: async (key: string) => catalogs[key] ?? null },
		mcpServers: { listEnabledToolPrices: async () => [] },
	} as unknown as GatewayRepositories;
	const app = new Hono<Env>();
	app.use('*', async (c, next) => {
		c.set('repositories', repos);
		await next();
	});
	app.route('/v1/tools/web-search', webSearchRoutes);
	app.route('/v1/tools/web-fetch', webFetchRoutes);
	app.route('/v1/tools/web-deep-search', webDeepSearchRoutes);
	app.route('/v1/tools/ai-detection', aiDetectionRoutes);
	app.route('/v1/tools/pricing', toolsPricingRoutes);
	app.use('/v1/tools/unknown', requireApiKey);
	app.post('/v1/tools/unknown', (c) => c.json({ ok: true }));
	return { app, statements };
}
const request = (app: Hono<Env>, path: string, body: unknown, key = 'sk-test') =>
	app.request(path, {
		method: 'POST',
		headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
function logOf(statements: Statement[]): Record<string, unknown> {
	const statement = statements.find((s) => /INSERT INTO api_key_request_logs/.test(s.sql));
	assert.ok(statement);
	const columns = /api_key_request_logs\s*\(([^)]+)\)/
		.exec(statement.sql)![1]
		.split(',')
		.map((s) => s.trim());
	return Object.fromEntries(columns.map((column, i) => [column, statement.values[i]]));
}
describe('REST tool billing routes', () => {
	it('allows free calls at zero balance, records supplier cost, and logs zero amounts for upstream failure', async () => {
		const savedFetch = globalThis.fetch;
		try {
			globalThis.fetch = async () =>
				new Response(JSON.stringify({ code: 200, data: { webPages: { value: [] } } }));
			const free = fixture({ ...pricing, chargedFactor: 0 });
			const response = await request(free.app, '/v1/tools/web-search', { query: 'test' });
			assert.equal(response.status, 200);
			assert.equal(((await response.json()) as { data: { cost: number } }).data.cost, 0);
			const log = logOf(free.statements);
			assert.equal(log.charged_cost, 0);
			assert.equal(log.standard_cost, 0.01);
			assert.equal(log.metered_cost, 0.008);
			const audit = JSON.parse(log.pricing_audit as string);
			assert.equal(audit.billing_units, 1);
			assert.equal(audit.tool_pricing.charged_factor, 0);
			assert.equal(audit.tool_pricing.metered_factor, 0.8);
			assert.equal(
				free.statements.some((s) => /UPDATE users/.test(s.sql)),
				false
			);
			globalThis.fetch = async () =>
				new Response(JSON.stringify({ message: 'upstream failure' }), { status: 500 });
			const failed = fixture({ ...pricing, chargedFactor: 0 });
			assert.equal((await request(failed.app, '/v1/tools/web-search', { query: 'test' })).status, 502);
			const errorLog = logOf(failed.statements);
			assert.equal(errorLog.charged_cost, 0);
			assert.equal(errorLog.standard_cost, 0);
			assert.equal(errorLog.metered_cost, 0);
		} finally {
			globalThis.fetch = savedFetch;
		}
	});
	it('blocks paid calls before contacting upstream for every REST tool', async () => {
		const savedFetch = globalThis.fetch;
		let calls = 0;
		try {
			globalThis.fetch = async () => {
				calls++;
				throw new Error('Unexpected upstream call');
			};
			for (const path of ['web-search', 'web-fetch', 'web-deep-search', 'ai-detection']) {
				const { app, statements } = fixture();
				const response = await request(app, '/v1/tools/' + path, {
					query: 'test',
					url: 'https://example.com',
					text: 'text',
				});
				assert.equal(response.status, 403, path);
				assert.equal(statements.length, 0);
			}
			const { app } = fixture(pricing, 0.013);
			assert.equal((await request(app, '/v1/tools/ai-detection', { text: 'a'.repeat(2001) })).status, 403);
			assert.equal(calls, 0);
		} finally {
			globalThis.fetch = savedFetch;
		}
	});
	it('exposes resolved prices at zero balance while retaining authentication and unknown-route budget checks', async () => {
		const { app } = fixture();
		const response = await app.request('/v1/tools/pricing', { headers: { Authorization: 'Bearer sk-test' } });
		assert.equal(response.status, 200);
		const body = (await response.json()) as {
			data: { tools: Array<{ charged: number; standard: number; metered: number }> };
		};
		for (const tool of body.data.tools) {
			assert.equal(tool.charged, 0.012);
			assert.equal(tool.standard, 0.01);
			assert.equal(tool.metered, 0.008);
		}
		assert.equal((await request(app, '/v1/tools/web-search', { query: 'test' }, 'invalid')).status, 401);
		assert.equal((await request(app, '/v1/tools/unknown', {})).status, 403);
	});
	it('rejects an invalid active factor rule instead of falling back to a free or default price', async () => {
		const { app, statements } = fixture({ ...pricing, chargedFactor: -1 });
		assert.equal((await request(app, '/v1/tools/web-search', { query: 'test' })).status, 503);
		assert.equal(statements.length, 0);
	});
});
