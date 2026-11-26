import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import type { GatewayRepositories } from '@octafuse/core';
import type { AdminEnv } from '@/lib/admin-env';
import { adminModelsRoutes } from '@/lib/routes/admin/models';
import { adminProvidersRoutes } from '@/lib/routes/admin/providers';
import type { AdminModelRow, AdminModelsImportOutput, AdminProviderImportCatalogItem, AdminProviderRow, AdminProvidersImportOutput, AdminStaticModelPresetCatalogItem } from './types';

const sampleProvider = {
	name: 'First', vendor_key: 'openai', endpoints: { openai: { base: 'https://one.example/v1' } },
};

function appWithRepos(repos: Partial<GatewayRepositories>) {
	const app = new Hono<AdminEnv>();
	app.use('*', async (c, next) => {
		c.set('repositories', repos as GatewayRepositories);
		c.set('principal', { type: 'console', id: 'console:test', username: 'test' });
		await next();
	});
	return app.route('/providers', adminProvidersRoutes).route('/models', adminModelsRoutes);
}

function post(body: unknown): RequestInit {
	return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function readData<T>(response: Response): Promise<T> {
	const body = await response.json() as { success: boolean; data: T };
	assert.equal(body.success, true);
	return body.data;
}

test('a provider selected before a refresh still imports the same template after reordering', async (t) => {
	let time = 1000;
	t.mock.method(Date, 'now', () => time);
	const second = { ...sampleProvider, name: 'Second', endpoints: { openai: { base: 'https://two.example/v1' } } };
	const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json([sampleProvider, second]));
	const inserts: Array<{ kind: string; endpoints: string }> = [];
	const app = appWithRepos({ providers: {
		listProviders: async () => [],
		insertProvider: async (row: typeof inserts[number]) => { inserts.push(row); },
	} as unknown as GatewayRepositories['providers'] });
	const env = { CATALOG_BASE_URL: 'https://route-reorder.example', CATALOG_TTL_MS: '1' };
	const directory = await app.request('/providers/import/catalog', {}, env);
	assert.equal(directory.status, 200);
	const key = (await readData<AdminProviderImportCatalogItem[]>(directory))[0].id;
	assert.equal(key, sampleProvider.name);

	time++;
	fetch.mock.mockImplementation(async () => Response.json([second, sampleProvider]));
	const imported = await app.request('/providers/import', post({ ids: [key] }), env);
	assert.equal(imported.status, 200);
	assert.equal((await readData<AdminProvidersImportOutput>(imported)).created, 1);
	assert.equal(inserts[0].kind, sampleProvider.name);
	assert.deepEqual(JSON.parse(inserts[0].endpoints), sampleProvider.endpoints);
	assert.equal(fetch.mock.callCount(), 2);
	assert.equal((await app.request('/providers/import', post({ ids: ['0'] }), env)).status, 409);
	assert.equal(inserts.length, 1);
});

test('an empty cache and offline catalog degrade stored lists and block catalog-dependent operations', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
	const app = appWithRepos({
		providers: { listProviders: async () => [{ id: 'p1', name: 'Existing', kind: 'First', api_key: 'plaintext' }] } as unknown as GatewayRepositories['providers'],
		models: { listModelsWithRouteCounts: async () => [{ id: 'm1', tags: '[]' }] } as unknown as GatewayRepositories['models'],
		systemConfig: { getConfig: async () => 'USD' } as unknown as GatewayRepositories['systemConfig'],
	});
	const env = { CATALOG_BASE_URL: 'https://route-offline.example' };
	const providers = await app.request('/providers', {}, env);
	assert.equal(providers.status, 200);
	const provider = (await readData<AdminProviderRow[]>(providers))[0];
	assert.equal(provider.vendor_key, 'other');
	assert.equal(provider.icon_key, 'other');
	assert.equal(provider.catalog_links, undefined);
	assert.notEqual(provider.api_key, 'plaintext');
	const models = await app.request('/models', {}, env);
	assert.equal(models.status, 200);
	assert.equal((await readData<AdminModelRow[]>(models))[0].catalog_i18n, null);

	const operations = [
		['/providers/import/catalog', {}],
		['/models/import/catalog?vendor=openai', {}],
		['/providers/import', post({ ids: ['First'] })],
		['/providers/sync/apply', post({ items: [{ provider_id: 'p1', fields: ['endpoints.openai'] }] })],
		['/providers', post({ name: 'new', kind: 'First', api_key: 'test' })],
		['/models/import', post({ ids: ['m1'] })],
		['/models/sync/apply', post({ items: [{ model_id: 'm1', fields: ['display_name'] }] })],
	] as const;
	for (const [path, init] of operations) {
		const response = await app.request(path, init, env);
		assert.equal(response.status, 503, path);
		const error = await response.json() as { message: string };
		assert.match(error.message, /catalog service is unavailable/i);
	}
});

test('model import writes only the current billing currency branch', async (t) => {
	const usd = { tiers: [{ upto: null, input_price: 1, output_price: 2 }] };
	const cny = { tiers: [{ upto: null, input_price: 7, output_price: 14 }] };
	t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [
		{ id: 'both', pricing: { usd, cny } }, { id: 'cny-only', pricing: { cny } },
	] }));
	let currency = 'USD';
	const inserted: Array<{ pricingProfile: string }> = [];
	const app = appWithRepos({
		models: {
			getModelDetailWithRouteCounts: async () => null,
			insertModel: async (row: typeof inserted[number]) => { inserted.push(row); },
			replaceModelTags: async () => {},
		} as unknown as GatewayRepositories['models'],
		systemConfig: { getConfig: async () => currency } as unknown as GatewayRepositories['systemConfig'],
	});
	const env = { CATALOG_BASE_URL: 'https://route-billing.example' };
	const body = post({ ids: ['both', 'cny-only'] });
	const first = await app.request('/models/import', body, env);
	assert.equal(first.status, 200);
	assert.equal((await readData<AdminModelsImportOutput>(first)).created, 1);
	currency = 'CNY';
	const second = await app.request('/models/import', body, env);
	assert.equal(second.status, 200);
	assert.equal((await readData<AdminModelsImportOutput>(second)).created, 2);
	assert.deepEqual(inserted.map((row) => JSON.parse(row.pricingProfile).tiers[0].input_price), [1, 7, 7]);
});

test('each model vendor query fetches a fresh result from its upstream endpoint', async (t) => {
	let revision = 0;
	const upstream = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
		const vendor = url.pathname.split('/').at(-1)!;
		assert.equal(init.cache, 'no-store');
		assert.equal(new Headers(init.headers).has('if-none-match'), false);
		return Response.json({ catalog: 'models', count: 1, items: [
			{ id: `${vendor}-model-${++revision}`, vendor, pricing: { cny: { tiers: [] } } },
		] }, { headers: { etag: '"vendor-catalog"' } });
	});
	const app = appWithRepos({
		systemConfig: { getConfig: async () => 'CNY' } as unknown as GatewayRepositories['systemConfig'],
	});
	const env = { CATALOG_BASE_URL: 'https://vendor-live.example' };
	for (const [index, vendor] of ['openai', 'aliyun', 'openai'].entries()) {
		const response = await app.request(`/models/import/catalog?vendor=${vendor}`, {}, env);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		const data = await readData<AdminStaticModelPresetCatalogItem[]>(response);
		assert.deepEqual(data.map((row) => [row.id, row.vendor, row.pricing_available]), [[`${vendor}-model-${index + 1}`, vendor, true]]);
	}
	assert.deepEqual(upstream.mock.calls.map(({ arguments: [url] }) => new URL(String(url)).pathname), [
		'/api/catalog/models-by-vendor/openai', '/api/catalog/models-by-vendor/aliyun', '/api/catalog/models-by-vendor/openai',
	]);
	assert.equal((await app.request('/models/import/catalog?vendor=OpenAI', {}, env)).status, 400);
	assert.equal(upstream.mock.callCount(), 3);
});

test('model vendor catalog falls back to matching rows in the cached full remote catalog', async (t) => {
	const upstream = t.mock.method(globalThis, 'fetch', async (url: URL) => {
		switch (url.pathname) {
			case '/api/catalog/models-by-vendor/openai':
				return new Response(null, { status: 404 });
			case '/api/catalog/models-by-vendor/aliyun':
				return Response.json([{ id: 'wrong', vendor: 'openai', pricing: { usd: {} } }]);
			default:
				return Response.json({ items: ['openai', 'aliyun'].map((vendor) => ({ id: vendor, vendor, pricing: { usd: {} } })) });
		}
	});
	const app = appWithRepos({
		systemConfig: { getConfig: async () => 'USD' } as unknown as GatewayRepositories['systemConfig'],
	});
	const env = { CATALOG_BASE_URL: 'https://vendor-fallback.example' };
	for (const vendor of ['openai', 'aliyun', 'openai']) {
		const response = await app.request(`/models/import/catalog?vendor=${vendor}`, {}, env);
		assert.equal(response.status, 200);
		assert.deepEqual((await readData<AdminStaticModelPresetCatalogItem[]>(response)).map((row) => row.id), [vendor]);
	}
	assert.deepEqual(upstream.mock.calls.map(({ arguments: [url] }) => new URL(String(url)).pathname), [
		'/api/catalog/models-by-vendor/openai', '/api/catalog/models', '/api/catalog/models-by-vendor/aliyun',
		'/api/catalog/models-by-vendor/openai',
	]);
});
