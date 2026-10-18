import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	deleteProviderRoutes,
	fetchProviderApiKeyPlaintext,
	fetchProviderRoutes,
	saveProvider,
} from './provider-api';
import { EMPTY_PROVIDER_FORM } from './types';
import type { RouteListRow } from '../routes/types';

function route(id: string, providerId = 'provider-1'): RouteListRow {
	return {
		id,
		provider_id: providerId,
		model_id: 'model-1',
		provider_model_name: 'upstream-1',
		priority: 0,
		status: 'active',
		route_group: 'default',
		price_override: null,
		custom_params: null,
		upstream_protocol: 'openai',
	};
}

function json(body: unknown) {
	return Response.json(body);
}

describe('provider related routes API', () => {
	it('scopes the query to the encoded provider ID and forwards cancellation', async (context) => {
		const controller = new AbortController();
		const rows = [route('r1')];
		const fetchMock = context.mock.method(
			globalThis,
			'fetch',
			async (url: string, options?: RequestInit) => {
				const parsed = new URL(url, 'http://localhost');
				assert.equal(parsed.pathname, '/api/admin/routes');
				assert.equal(parsed.searchParams.get('provider_id'), 'provider /?&');
				assert.equal([...parsed.searchParams].length, 1);
				assert.equal(options?.signal, controller.signal);
				return json({ success: true, data: rows });
			}
		);
		assert.deepEqual(
			await fetchProviderRoutes('provider /?&', controller.signal),
			rows
		);
		assert.equal(fetchMock.mock.callCount(), 1);
	});

	it('returns an empty list only after a successful response', async (context) => {
		context.mock.method(globalThis, 'fetch', async () =>
			json({ success: true, data: [] })
		);
		assert.deepEqual(await fetchProviderRoutes('provider-1'), []);
	});

	it('does not disguise backend failure as zero related routes', async (context) => {
		context.mock.method(globalThis, 'fetch', async () =>
			json({ success: false, message: 'Access denied' })
		);
		await assert.rejects(fetchProviderRoutes('provider-1'), /Access denied/);
	});

	it('preserves network failure instead of permitting provider deletion', async (context) => {
		context.mock.method(globalThis, 'fetch', async () => {
			throw new Error('Network unavailable');
		});
		await assert.rejects(
			fetchProviderRoutes('provider-1'),
			/Network unavailable/
		);
	});

	it('deletes selected routes once, excluding other providers and unknown IDs', async (context) => {
		const calls: string[] = [];
		context.mock.method(
			globalThis,
			'fetch',
			async (url: string, options?: RequestInit) => {
				calls.push(url);
				assert.equal(options?.method, 'DELETE');
				return json({ success: true });
			}
		);
		const own = route('route /?');
		const result = await deleteProviderRoutes(
			'provider-1',
			[own, own, route('unselected'), route('foreign', 'provider-2')],
			['route /?', 'route /?', 'foreign', 'unknown']
		);
		assert.deepEqual(calls, ['/api/admin/routes/route%20%2F%3F']);
		assert.deepEqual(result, { deletedIds: ['route /?'], failures: [] });
	});

	it('continues after API and network failures and reports exact partial results', async (context) => {
		const calls: string[] = [];
		context.mock.method(globalThis, 'fetch', async (url: string) => {
			calls.push(url);
			if (url.endsWith('/api-failure'))
				return json({ success: false, message: 'Route is locked' });
			if (url.endsWith('/network-failure')) throw new Error('Disconnected');
			return json({ success: true });
		});
		const routes = ['first', 'api-failure', 'network-failure', 'last'].map(
			(id) => route(id)
		);
		const result = await deleteProviderRoutes(
			'provider-1',
			routes,
			routes.map((row) => row.id)
		);
		assert.equal(calls.length, 4);
		assert.deepEqual(result.deletedIds, ['first', 'last']);
		assert.deepEqual(
			result.failures.map(({ route: row, message }) => [row.id, message]),
			[
				['api-failure', 'Route is locked'],
				['network-failure', 'Disconnected'],
			]
		);
	});
});

describe('provider credential form requests', () => {
	for (const apiKey of ['', '  \t  ']) {
		it(`sends an explicit empty credential for ${JSON.stringify(
			apiKey
		)} on edit`, async (context) => {
			context.mock.method(
				globalThis,
				'fetch',
				async (url: string, options: RequestInit) => {
					assert.equal(url, '/api/admin/providers/p1');
					assert.equal(options.method, 'PATCH');
					const body = JSON.parse(String(options.body));
					assert.equal(Object.hasOwn(body, 'api_key'), true);
					assert.equal(body.api_key, '');
					return json({ success: true });
				}
			);
			assert.deepEqual(
				await saveProvider({ ...EMPTY_PROVIDER_FORM, api_key: apiKey }, 'p1'),
				{ success: true }
			);
		});
	}

	it('omits an untouched key, including while it is loading or after a failed load', async (context) => {
		const calls: unknown[] = [];
		context.mock.method(
			globalThis,
			'fetch',
			async (_url: string, options: RequestInit) => {
				const body = JSON.parse(String(options.body));
				calls.push(body);
				assert.equal(Object.hasOwn(body, 'api_key'), false);
				assert.equal(body.name, 'Renamed');
				return json({ success: true });
			}
		);
		for (const apiKey of ['', 'loaded-key']) {
			await saveProvider(
				{ ...EMPTY_PROVIDER_FORM, name: 'Renamed', api_key: apiKey },
				'p1',
				{ updateApiKey: false }
			);
		}
		assert.equal(calls.length, 2);
	});

	it('sends the new credential when the field was edited', async (context) => {
		context.mock.method(
			globalThis,
			'fetch',
			async (_url: string, options: RequestInit) => {
				assert.equal(
					JSON.parse(String(options.body)).api_key,
					'replacement-key'
				);
				return json({ success: true });
			}
		);
		await saveProvider(
			{ ...EMPTY_PROVIDER_FORM, api_key: '  replacement-key  ' },
			'p1'
		);
	});

	it('accepts an empty credential returned by the reveal API', async (context) => {
		context.mock.method(globalThis, 'fetch', async () =>
			json({ success: true, data: { api_key: '' } })
		);
		assert.equal(await fetchProviderApiKeyPlaintext('p1'), '');
	});

	it('does not submit a new provider without a credential', async (context) => {
		const fetchMock = context.mock.method(globalThis, 'fetch');
		assert.equal(
			(await saveProvider(EMPTY_PROVIDER_FORM, null)).success,
			false
		);
		assert.equal(fetchMock.mock.callCount(), 0);
	});
});
