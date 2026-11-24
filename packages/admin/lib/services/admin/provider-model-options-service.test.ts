import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AdminEnv } from '../../admin-env';
import { adminProvidersRoutes } from '../../routes/admin/providers';
import type { GatewayRepositories, ProviderRow } from '@octafuse/core';
import presets from '../../provider-import-presets.json';
import { DISCOVERY_BODY_LIMIT, DISCOVERY_MODEL_LIMIT, PROVIDER_MODEL_ADAPTERS, normalizeModelId, parseModelPage } from '../../provider-model-discovery';
import { getProviderModelOptionsService, ModelDiscoveryError, refreshProviderModelOptionsService } from './provider-model-options-service';

let sequence = 0;
function provider(kind: string, key = 'sk-test', endpoints?: unknown): ProviderRow {
	return { id: `model-options-${++sequence}`, name: 'Test', kind, api_key: key, endpoints: endpoints === undefined ? null : JSON.stringify(endpoints), note: null, created_at: '2026-01-01 00:00:00' };
}
function repos(row: ProviderRow | null): GatewayRepositories {
	return { providers: { getProviderById: async () => row } } as unknown as GatewayRepositories;
}
const fetchJson = (body: unknown, status = 200): typeof fetch => async () => Response.json(body, { status });
async function failure(run: () => Promise<unknown>, code: string, status: number) {
	await assert.rejects(run, (error: unknown) => error instanceof ModelDiscoveryError && error.code === code && error.status === status);
}

describe('provider model discovery', () => {
	it('classifies every kind and preserves list-to-request ID semantics', () => {
		const names = new Set(presets.map((preset) => preset.name));
		const interfaceKinds = Object.keys(PROVIDER_MODEL_ADAPTERS);
		assert.equal(names.size, 69);
		assert.equal(interfaceKinds.length, 43);
		assert.equal(names.size - interfaceKinds.length, 26);
		for (const kind of interfaceKinds) { assert.ok(names.has(kind), kind); assert.equal(new URL(PROVIDER_MODEL_ADAPTERS[kind]!.url.replace('{project}', 'project').replace('{region}', 'global')).protocol, 'https:'); }
		assert.equal(PROVIDER_MODEL_ADAPTERS['Ollama (Local)'], undefined);
		assert.equal(normalizeModelId('Google Gemini (Generative Language API)', 'models/gemini-2.5-pro'), 'gemini-2.5-pro');
		assert.equal(normalizeModelId('Google Vertex AI', 'projects/p/locations/global/publishers/google/models/gemini-2.5-pro'), 'gemini-2.5-pro');
		assert.equal(normalizeModelId('OpenRouter', 'anthropic/claude-sonnet-4.5'), 'anthropic/claude-sonnet-4.5');
		assert.equal(normalizeModelId('Xiaomi MiMo', 'xiaomi/mimo-v2-flash'), 'xiaomi/mimo-v2-flash');
	});

	it('maps the special upstream shapes without using display names as IDs', () => {
		const cases: [string, unknown, string][] = [
			['Alibaba Cloud Bailian', { output: { models: [{ model: 'qwen-plus', name: 'Qwen Plus' }] } }, 'qwen-plus'],
			['Together AI', [{ id: 'org/model', display_name: 'Readable' }], 'org/model'],
			['Cohere (OpenAI Compatibility)', { models: [{ name: 'command-r' }] }, 'command-r'],
			['Google Gemini (Generative Language API)', { models: [{ name: 'models/gemini-2.5-pro' }] }, 'gemini-2.5-pro'],
			['Google Vertex AI', { publisherModels: [{ name: 'projects/p/locations/global/publishers/google/models/gemini-2.5-pro' }] }, 'gemini-2.5-pro'],
		];
		for (const [kind, body, expected] of cases) assert.equal(parseModelPage(kind, PROVIDER_MODEL_ADAPTERS[kind]!, body).models[0]?.id, expected);
		assert.throws(() => parseModelPage('DeepSeek', PROVIDER_MODEL_ADAPTERS.DeepSeek!, { models: [{ name: 'wrong' }] }));
	});

	it('GET is read-only and always returns an empty candidate list', async () => {
		const row = provider('OpenRouter', '');
		const data = await getProviderModelOptionsService(repos(row), row.id);
		assert.deepEqual(data.models, []);
		assert.equal(data.discovery_reason, 'ready');
		assert.equal(data.credential_ready, false);
	});

	it('respects the disabled kind list and reports unsafe configured endpoints', async () => {
		const row = provider('DeepSeek', 'sk-test', { openai: { base: 'http://127.0.0.1/v1' } });
		const unsafe = await getProviderModelOptionsService(repos(row), row.id);
		assert.equal(unsafe.discovery_reason, 'endpoint_not_allowed');
		const disabled = await getProviderModelOptionsService(repos(row), row.id, { disabledKinds: 'OpenAI, DeepSeek' });
		assert.equal(disabled.discovery_available, false);
		assert.equal(disabled.discovery_reason, 'unsupported');
		await failure(() => refreshProviderModelOptionsService(repos(row), row.id, { disabledKinds: 'DeepSeek', fetchImpl: async () => { throw new Error('fetch must not run'); } }), 'discovery_unsupported', 422);
	});

	it('rejects missing keys, unsupported kinds, and unsafe endpoints without fetch', async () => {
		const noFetch: typeof fetch = async () => { throw new Error('fetch must not run'); };
		for (const row of [provider('DeepSeek', ''), provider('DeepSeek', '__OCTAFUSE_PENDING_PROVIDER_API_KEY__')]) {
			await failure(() => refreshProviderModelOptionsService(repos(row), row.id, { fetchImpl: noFetch }), 'provider_key_missing', 400);
		}
		const manual = provider('Ollama (Local)');
		await failure(() => refreshProviderModelOptionsService(repos(manual), manual.id, { fetchImpl: noFetch }), 'discovery_unsupported', 422);
		for (const host of ['https://api.deepseek.com.evil.tld/v1/chat', 'http://127.0.0.1/chat', 'https://169.254.169.254/chat']) {
			const row = provider('DeepSeek', 'sk-test', { openai: { endpoints: { chat: host } } });
			await failure(() => refreshProviderModelOptionsService(repos(row), row.id, { fetchImpl: noFetch }), 'endpoint_not_allowed', 422);
		}
	});

	it('maps upstream auth failures to 502 and never exposes upstream body', async () => {
		const row = provider('DeepSeek');
		await failure(() => refreshProviderModelOptionsService(repos(row), row.id, { fetchImpl: fetchJson({ error: 'sk-test secret' }, 401) }), 'upstream_auth_failed', 502);
	});

	it('does not retry 429 and preserves a bounded Retry-After', async () => {
		const row = provider('DeepSeek');
		let calls = 0;
		await assert.rejects(() => refreshProviderModelOptionsService(repos(row), row.id, {
			fetchImpl: async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '9' } }); },
		}), (error: unknown) => error instanceof ModelDiscoveryError && error.code === 'upstream_rate_limited' && error.status === 502 && error.retryAfterSeconds === 9);
		assert.equal(calls, 1);
	});

	it('retries transient 5xx twice and then succeeds', async () => {
		const row = provider('DeepSeek');
		let calls = 0;
		const result = await refreshProviderModelOptionsService(repos(row), row.id, { fetchImpl: async () => {
			calls++;
			return calls < 3 ? new Response('{}', { status: 503 }) : Response.json({ data: [{ id: 'deepseek-chat' }] });
		} });
		assert.equal(calls, 3);
		assert.equal(result.models[0]?.id, 'deepseek-chat');
	});

	it('maps aborts to 504 after at most three attempts', async () => {
		const row = provider('DeepSeek');
		let calls = 0;
		await failure(() => refreshProviderModelOptionsService(repos(row), row.id, { fetchImpl: async () => {
			calls++;
			throw Object.assign(new Error('timed out'), { name: 'AbortError' });
		} }), 'upstream_timeout', 504);
		assert.equal(calls, 3);
	});

	it('stops on a repeated pagination cursor', async () => {
		const row = provider('Cohere (OpenAI Compatibility)');
		let calls = 0;
		const result = await refreshProviderModelOptionsService(repos(row), row.id, { fetchImpl: async () => {
			calls++;
			return Response.json({ models: [{ name: `command-${calls}` }], next_page_token: 'same-cursor' });
		} });
		assert.equal(calls, 2);
		assert.equal(result.truncated, true);
		assert.deepEqual(result.models.map((option) => option.id), ['command-1', 'command-2']);
	});

	it('keeps an exact full page untruncated and caps oversized model lists', async () => {
		const fullPage = provider('OpenRouter');
		const exact = await refreshProviderModelOptionsService(repos(fullPage), fullPage.id, {
			fetchImpl: fetchJson({ data: Array.from({ length: 500 }, (_, i) => ({ id: `model-${i}` })) }),
		});
		assert.equal(exact.models.length, 500);
		assert.equal(exact.truncated, false);
		const overflow = provider('OpenRouter');
		const capped = await refreshProviderModelOptionsService(repos(overflow), overflow.id, {
			fetchImpl: fetchJson({ data: Array.from({ length: DISCOVERY_MODEL_LIMIT + 1 }, (_, i) => ({ id: `model-${i}` })) }),
		});
		assert.equal(capped.models.length, 500);
		assert.equal(capped.truncated, true);
		const paged = provider('Cohere (OpenAI Compatibility)');
		let pages = 0;
		const limited = await refreshProviderModelOptionsService(repos(paged), paged.id, {
			fetchImpl: async () => Response.json({ models: Array.from({ length: 500 }, (_, i) => ({ name: `page-${pages}-model-${i}` })), next_page_token: String(++pages) }),
		});
		assert.equal(limited.models.length, DISCOVERY_MODEL_LIMIT);
		assert.equal(limited.truncated, true);
		assert.equal(pages, 2);
	});

	it('limits streamed bodies and repeat refreshes', async () => {
		const large = provider('OpenRouter');
		await failure(() => refreshProviderModelOptionsService(repos(large), large.id, {
			fetchImpl: async () => new Response('x'.repeat(DISCOVERY_BODY_LIMIT + 1)),
		}), 'upstream_response_too_large', 502);
		const row = provider('OpenRouter');
		let calls = 0;
		const options = { fetchImpl: async () => { calls++; return Response.json({ data: [] }); }, now: () => 100_000 };
		await refreshProviderModelOptionsService(repos(row), row.id, options);
		await failure(() => refreshProviderModelOptionsService(repos(row), row.id, options), 'refresh_rate_limited', 429);
		assert.equal(calls, 1);
	});

	it('rejects redirects, HTML and oversized bodies; accepts deduplicated IDs', async () => {
		const redirect = provider('OpenRouter');
		await failure(() => refreshProviderModelOptionsService(repos(redirect), redirect.id, { fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } }) }), 'upstream_invalid_response', 502);
		const html = provider('OpenRouter');
		await failure(() => refreshProviderModelOptionsService(repos(html), html.id, { fetchImpl: async () => new Response('<html/>') }), 'upstream_invalid_response', 502);
		const large = provider('OpenRouter');
		await failure(() => refreshProviderModelOptionsService(repos(large), large.id, { fetchImpl: async () => new Response('x', { headers: { 'Content-Length': '3000000' } }) }), 'upstream_response_too_large', 502);
		const okay = provider('OpenRouter');
		const data = await refreshProviderModelOptionsService(repos(okay), okay.id, { fetchImpl: fetchJson({ data: [{ id: 'org/model' }, { id: 'org/model' }, { id: '' }, { id: 'bad\nmodel' }] }) });
		assert.deepEqual(data.models.map((option) => option.id), ['org/model']);
	});

	it('adds no-store to successful and failed route responses', async () => {
		const row = provider('Ollama (Local)');
		const app = new Hono<AdminEnv>();
		app.use('*', async (c, next) => {
			c.set('repositories', repos(c.req.path.includes('/missing/') ? null : row));
			c.set('principal', { type: 'api_key', id: 'admin_key:test', keyId: 'test', permissions: ['providers.read', 'providers.write'] });
			await next();
		});
		app.route('/admin/providers', adminProvidersRoutes);
		const env = { PROVIDER_MODEL_DISCOVERY_DISABLED_KINDS: '' };
		const get = await app.request(`http://localhost/admin/providers/${row.id}/model-options`, {}, env);
		assert.equal(get.status, 200);
		assert.equal(get.headers.get('cache-control'), 'no-store');
		assert.deepEqual((await get.json() as { data: { models: unknown[] } }).data.models, []);
		const post = await app.request(`http://localhost/admin/providers/${row.id}/model-options/refresh`, { method: 'POST' }, env);
		assert.equal(post.status, 422);
		assert.equal(post.headers.get('cache-control'), 'no-store');
		const missing = await app.request('http://localhost/admin/providers/missing/model-options', {}, env);
		assert.equal(missing.status, 404);
		assert.equal(missing.headers.get('cache-control'), 'no-store');
		const noKey = provider('DeepSeek', '');
		const noKeyApp = new Hono<AdminEnv>();
		noKeyApp.use('*', async (c, next) => { c.set('repositories', repos(noKey)); c.set('principal', { type: 'api_key', id: 'admin_key:test', keyId: 'test', permissions: ['providers.write'] }); await next(); });
		noKeyApp.route('/admin/providers', adminProvidersRoutes);
		const badRequest = await noKeyApp.request(`http://localhost/admin/providers/${noKey.id}/model-options/refresh`, { method: 'POST' }, env);
		assert.equal(badRequest.status, 400);
		assert.equal(badRequest.headers.get('cache-control'), 'no-store');
		assert.equal(badRequest.headers.get('x-octafuse-error-code'), 'provider_key_missing');
		const invalidAccount = provider('Google Vertex AI', JSON.stringify({ type: 'service_account', client_email: 'test@example.com', private_key: '-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----' }), { gemini: { base: 'https://aiplatform.googleapis.com/v1/projects/demo-project/locations/global/publishers/google/models' } });
		const authApp = new Hono<AdminEnv>();
		authApp.use('*', async (c, next) => { c.set('repositories', repos(invalidAccount)); c.set('principal', { type: 'api_key', id: 'admin_key:test', keyId: 'test', permissions: ['providers.write'] }); await next(); });
		authApp.route('/admin/providers', adminProvidersRoutes);
		const upstreamFailure = await authApp.request(`http://localhost/admin/providers/${invalidAccount.id}/model-options/refresh`, { method: 'POST' }, env);
		assert.equal(upstreamFailure.status, 502);
		assert.equal(upstreamFailure.headers.get('cache-control'), 'no-store');
	});

	it('requires a same-origin console write for refresh', async () => {
		const row = provider('Ollama (Local)');
		const app = new Hono<AdminEnv>();
		app.use('*', async (c, next) => {
			c.set('repositories', repos(row));
			c.set('principal', { type: 'console', id: 'console:admin', username: 'admin' });
			await next();
		});
		app.route('/admin/providers', adminProvidersRoutes);
		const url = `http://localhost/admin/providers/${row.id}/model-options/refresh`;
		const blocked = await app.request(url, { method: 'POST' }, {});
		assert.equal(blocked.status, 403);
		assert.equal(blocked.headers.get('cache-control'), 'no-store');
		const allowed = await app.request(url, { method: 'POST', headers: { Origin: 'http://localhost' } }, {});
		assert.equal(allowed.status, 422);
	});
});
