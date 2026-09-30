import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Hono } from 'hono';
import type { GatewayRepositories } from '@octafuse/core';
import type { AdminEnv } from '@/lib/admin-env';
import type { PlaygroundRouteDraft } from '@/lib/playground/route-draft';
import { adminPlaygroundRoutes } from '@/lib/routes/admin/playground';
import { invokePlaygroundUpstream } from './playground-service';
import { parsePlaygroundRouteDraft } from './playground-route-draft';

const draft: PlaygroundRouteDraft = {
	model_id: 'catalog-model',
	provider_id: 'provider',
	provider_model_name: 'unsaved-model',
	request_protocol: 'openai',
	request_operation: 'chat',
	upstream_protocol: 'openai',
	upstream_operation: 'chat',
	adapter: 'passthrough',
	custom_params: null,
};

function repositories(
	options: { disabled?: boolean; noKey?: boolean; noModel?: boolean; noEndpoint?: boolean } = {}
) {
	// Only reads are supplied. Any accidental insert/update or route lookup for a draft fails the test.
	return {
		providers: {
			getProviderById: async () => ({
				id: 'provider',
				status: options.disabled ? 'disabled' : 'active',
				endpoints: options.noEndpoint
					? null
					: JSON.stringify({ openai: { base: 'https://upstream.example/v1' } }),
			}),
			getProviderApiKeyPlaintext: async () => ({ api_key: options.noKey ? '' : 'test-secret' }),
		},
		models: {
			getModelDetailWithRouteCounts: async () =>
				options.noModel
					? null
					: { id: 'catalog-model', output_modalities: '["text"]', pricing_profile: null },
		},
		routes: {
			getModelRouteRowById: async (id: string) => {
				assert.equal(id, 'saved-route');
				return { ...draft, provider_model_name: 'saved-model' };
			},
		},
	} as unknown as GatewayRepositories;
}

function app(authenticated = true) {
	const app = new Hono<AdminEnv>();
	app.use('*', async (c, next) => {
		c.set('repositories', repositories());
		if (authenticated) c.set('principal', { type: 'console', id: 'console:test', username: 'test' });
		await next();
	});
	app.route('/playground', adminPlaygroundRoutes);
	return app;
}
function post(body: unknown, authenticated = true) {
	return app(authenticated).request('/playground', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

afterEach(() => mock.restoreAll());

describe('Playground route drafts', () => {
	it('tests an unsaved mapping and forced custom body/headers using stored provider credentials', async () => {
		const fetchMock = mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
			assert.equal(url, 'https://upstream.example/v1/chat/completions');
			const headers = new Headers(init?.headers);
			assert.equal(headers.get('authorization'), 'Bearer test-secret');
			assert.equal(headers.get('x-route-test'), 'draft');
			assert.deepEqual(JSON.parse(String(init?.body)), {
				model: 'unsaved-model',
				messages: [{ role: 'user', content: 'ping' }],
				temperature: 0.2,
			});
			return Response.json({ choices: [{ message: { content: 'pong' } }] });
		});
		const res = await post({
			routeDraft: {
				...draft,
				// These untrusted fields must never override the stored provider.
				providerApiKey: 'client-secret',
				endpoints: { openai: { base: 'https://untrusted.example' } },
				custom_params: JSON.stringify({
					headers: { 'x-route-test': 'draft' },
					body: { temperature: 0.2 },
					force_override: { body: true },
				}),
			},
			body: { model: 'ignored', messages: [{ role: 'user', content: 'ping' }], temperature: 0.9 },
		});
		assert.equal(res.status, 200);
		assert.equal(fetchMock.mock.callCount(), 1);
		assert.equal(res.headers.get('x-playground-mode'), 'route');
		const wireHeaders = decodeURIComponent(res.headers.get('x-playground-request-headers')!);
		assert.match(wireHeaders, /x-route-test/);
		assert.doesNotMatch(wireHeaders, /test-secret/);
		assert.equal(
			JSON.parse(decodeURIComponent(res.headers.get('x-playground-request-body')!)).temperature,
			0.2
		);
		assert.match(await res.text(), /pong/);
	});

	it('preserves user body precedence unless force override is set', async () => {
		mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
			assert.equal(JSON.parse(String(init?.body)).temperature, 0.9);
			return Response.json({ ok: true });
		});
		await invokePlaygroundUpstream(repositories(), {
			routeDraft: { ...draft, custom_params: { body: { temperature: 0.2 } } },
			body: { temperature: 0.9 },
		});
	});

	it('keeps saved-route requests compatible', async () => {
		mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
			assert.equal(JSON.parse(String(init?.body)).model, 'saved-model');
			return Response.json({ ok: true });
		});
		assert.equal((await post({ routeId: 'saved-route', body: {} })).status, 200);
	});

	it('returns streaming responses and forwards request cancellation', async () => {
		const controller = new AbortController();
		let upstreamSignal: AbortSignal | null | undefined;
		const chunks = ['data: {"choices":[{"delta":{"content":"pong"}}]}\n\n', 'data: [DONE]\n\n'];
		mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
			upstreamSignal = init?.signal;
			return new Response(
				new ReadableStream({
					start(stream) {
						for (const chunk of chunks) stream.enqueue(new TextEncoder().encode(chunk));
						stream.close();
					},
				}),
				{ headers: { 'Content-Type': 'text/event-stream' } }
			);
		});
		const result = await invokePlaygroundUpstream(
			repositories(),
			{ routeDraft: draft, body: { stream: true } },
			controller.signal
		);
		assert.match(result.response.headers.get('content-type')!, /event-stream/);
		assert.equal(await result.response.text(), chunks.join(''));
		controller.abort();
		assert.equal(upstreamSignal?.aborted, true);
	});

	it('rejects invalid targets and JSON before making an upstream request', async () => {
		const fetchMock = mock.method(globalThis, 'fetch', async () => {
			throw new Error('Unexpected fetch');
		});
		for (const payload of [
			null,
			[],
			{ body: {} },
			{ routeId: 'saved-route', routeDraft: draft, body: {} },
			{ toolId: 'tool', routeDraft: draft, body: {} },
			{ routeDraft: null, body: {} },
			{ routeDraft: draft, body: [] },
			{ routeDraft: { ...draft, provider_id: '' }, body: {} },
			{ routeDraft: { ...draft, upstream_operation: 'invalid' }, body: {} },
			{ routeDraft: { ...draft, custom_params: '{' }, body: {} },
			{ routeDraft: { ...draft, custom_params: { headers: { Authorization: 'injected' } } }, body: {} },
		]) {
			assert.equal((await post(payload)).status, 400, JSON.stringify(payload));
		}
		assert.equal((await post({ routeDraft: draft, body: {} }, false)).status, 401);
		assert.equal(fetchMock.mock.callCount(), 0);
	});

	it('requires an enabled provider, credentials, an endpoint, and an existing model', async () => {
		const fetchMock = mock.method(globalThis, 'fetch', async () => {
			throw new Error('Unexpected fetch');
		});
		for (const options of [{ disabled: true }, { noKey: true }, { noEndpoint: true }, { noModel: true }]) {
			await assert.rejects(invokePlaygroundUpstream(repositories(options), { routeDraft: draft, body: {} }), {
				status: 400,
			});
		}
		assert.equal(fetchMock.mock.callCount(), 0);
	});

	it('validates adapter topology instead of guessing conversion from protocols', () => {
		assert.throws(
			() =>
				parsePlaygroundRouteDraft({ ...draft, request_protocol: 'anthropic', request_operation: 'messages' }),
			{ status: 400 }
		);
	});
});
