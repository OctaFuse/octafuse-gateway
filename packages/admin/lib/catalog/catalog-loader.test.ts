import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProviderCatalog } from '../provider-catalog';
import { pickPresetPricingRawForBillingCurrency } from '../model-preset';
import { CatalogUnavailableError, loadModelCatalog, loadProviderCatalog, requireCurrentCatalog } from './catalog-loader';

const provider = {
	name: 'Sample', vendor_key: 'openai', endpoints: { openai: { base: 'https://example.com/v1' } },
};
const model = { id: 'sample-model', pricing: { cny: { tiers: [] } } };

test('legacy local settings still load both catalogs from the configured API', async (t) => {
	const requests: string[] = [];
	t.mock.method(globalThis, 'fetch', async (url: URL) => {
		requests.push(url.href);
		return Response.json(url.pathname.endsWith('/providers') ? [provider] : [model]);
	});
	for (const baseUrl of [undefined, 'https://mirror.example/gateway']) {
		const env = { CATALOG_SOURCE: 'local', CATALOG_BASE_URL: baseUrl };
		assert.deepEqual((await loadProviderCatalog(env)).rows, [provider]);
		assert.deepEqual((await loadModelCatalog(env)).rows, [model]);
	}
	assert.deepEqual(requests, [
		'https://octafuse.dev/api/catalog/providers', 'https://octafuse.dev/api/catalog/models',
		'https://mirror.example/gateway/api/catalog/providers', 'https://mirror.example/gateway/api/catalog/models',
	]);
});

test('reads the live envelope and single-flights concurrent provider requests', async (t) => {
	const env = { CATALOG_BASE_URL: 'https://provider.example' };
	const fetch = t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
		assert.equal(url.pathname, '/api/catalog/providers');
		assert.equal(new Headers(options.headers).get('accept'), 'application/json');
		assert.equal(options.redirect, 'manual');
		return Response.json({ schema_version: 2, catalog: 'providers', count: 1, items: [{
			...provider, catalog_key: '0', links: { platform: 'https://example.com/' },
			i18n: { en: { name: 'Localized sample', description: 'Official copy' } },
		}] });
	});
	const snapshots = await Promise.all(Array.from({ length: 10 }, () => loadProviderCatalog(env)));
	assert.equal(fetch.mock.callCount(), 1);
	assert.ok(snapshots.every((snapshot) => snapshot === snapshots[0]));
	const catalog = getProviderCatalog(snapshots[0].rows);
	assert.equal(catalog.listStaticProviderImportCatalogForAdmin()[0].id, provider.name);
	assert.deepEqual(catalog.resolveStoredProviderPresentation({ kind: provider.name }).catalogLinks, { platform: 'https://example.com/' });
	assert.equal(catalog.resolveStoredProviderPresentation({ kind: provider.name }).kindLabels?.en, 'Localized sample');
});

test('keeps row order and accepts arrays and data envelopes with a single pricing branch', async (t) => {
	const rows = [model, { ...model, id: 'another-model' }];
	const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(rows));
	const first = await loadModelCatalog({ CATALOG_BASE_URL: 'https://array.example' });
	assert.deepEqual(first.rows, rows);
	assert.equal(pickPresetPricingRawForBillingCurrency(first.rows[0], 'USD'), undefined);
	fetch.mock.mockImplementation(async () => Response.json({ data: rows }));
	assert.deepEqual((await loadModelCatalog({ CATALOG_BASE_URL: 'https://data.example' })).rows, rows);
});

test('revalidates after TTL, handles 304, and protects the last snapshot on a bad refresh', async (t) => {
	const env = { CATALOG_BASE_URL: 'https://cache.example', CATALOG_TTL_MS: '100' };
	let now = 1000;
	t.mock.method(Date, 'now', () => now);
	const fetch = t.mock.method(globalThis, 'fetch', async (_url: URL, _options: RequestInit) =>
		Response.json([model], { headers: { etag: '"v1"' } }));
	const first = await loadModelCatalog(env);
	now += 50;
	assert.equal(await loadModelCatalog(env), first);
	assert.equal(fetch.mock.callCount(), 1);
	fetch.mock.mockImplementation(async (_url: URL, options: RequestInit) => {
		assert.equal(new Headers(options.headers).get('if-none-match'), '"v1"');
		return new Response(null, { status: 304 });
	});
	now += 50;
	const revalidated = await loadModelCatalog(env);
	assert.equal(revalidated.rows, first.rows);
	assert.equal(revalidated.fetchedAt, now);
	fetch.mock.mockImplementation(async () => Response.json([{ id: model.id }]));
	now += 100;
	const stale = await loadModelCatalog(env);
	assert.equal(stale.freshness, 'stale');
	assert.equal(stale.rows, first.rows);
	assert.equal(stale.fetchedAt, revalidated.fetchedAt);
	assert.throws(() => requireCurrentCatalog(stale), CatalogUnavailableError);
	assert.equal((await loadModelCatalog(env)).freshness, 'stale');
	assert.equal(fetch.mock.callCount(), 3);
	now += 10_000;
	fetch.mock.mockImplementation(async () => Response.json([{ ...model, id: 'updated' }]));
	assert.equal((await loadModelCatalog(env)).rows[0].id, 'updated');
});

test('retries a network failure and a server error once each', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
	await assert.rejects(loadModelCatalog({ CATALOG_BASE_URL: 'https://offline.example' }), CatalogUnavailableError);
	assert.equal(fetch.mock.callCount(), 2);
	fetch.mock.mockImplementation(async () => new Response(null, { status: 503 }));
	await assert.rejects(loadModelCatalog({ CATALOG_BASE_URL: 'https://server-error.example' }), CatalogUnavailableError);
	assert.equal(fetch.mock.callCount(), 4);
});

test('times out and retries a stalled fetch', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async (_url: URL, options: RequestInit) =>
		new Promise<Response>((_resolve, reject) => {
			options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
		}));
	await assert.rejects(loadModelCatalog({ CATALOG_TIMEOUT_MS: '5', CATALOG_BASE_URL: 'https://timeout.example' }), CatalogUnavailableError);
	assert.equal(fetch.mock.callCount(), 2);
});

test('rejects client errors, redirects, malformed listings and oversized bodies without retry', async (t) => {
	const responses = [
		new Response(null, { status: 404 }),
		Response.redirect('https://elsewhere.example'),
		new Response('invalid JSON'),
		Response.json({ items: [] }),
		Response.json({ items: [model], count: 2 }),
		Response.json([model, model]),
		new Response('large', { headers: { 'content-length': String(6 * 1024 * 1024) } }),
		new Response(new Uint8Array(6 * 1024 * 1024)),
	];
	const fetch = t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
	const count = responses.length;
	for (let index = 0; index < count; index++) {
		await assert.rejects(loadModelCatalog({ CATALOG_BASE_URL: `https://format-${index}.example` }), CatalogUnavailableError);
		assert.equal(fetch.mock.callCount(), index + 1);
	}
	await assert.rejects(loadModelCatalog({ CATALOG_BASE_URL: 'http://insecure.example' }), CatalogUnavailableError);
	assert.equal(fetch.mock.callCount(), count);
});
