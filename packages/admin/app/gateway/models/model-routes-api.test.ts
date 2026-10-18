import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deleteModelRoutes, fetchModelRoutes } from './model-api';
import type { RouteListRow } from '../routes/types';

function route(id: string, modelId = 'model-1'): RouteListRow {
	return {
		id,
		model_id: modelId,
		provider_id: `provider-${id}`,
		provider_model_name: 'upstream',
		priority: 0,
		status: 'active',
		route_group: 'default',
		price_override: null,
		custom_params: null,
		upstream_protocol: 'openai',
	};
}

describe('model associated routes API', () => {
	it('scopes the encoded model filter, forwards cancellation and excludes foreign rows', async (context) => {
		const controller = new AbortController();
		context.mock.method(
			globalThis,
			'fetch',
			async (url: string, options?: RequestInit) => {
				const parsed = new URL(url, 'http://localhost');
				assert.equal(parsed.searchParams.get('model_id'), 'model /?&');
				assert.equal([...parsed.searchParams].length, 1);
				assert.equal(options?.signal, controller.signal);
				return Response.json({
					success: true,
					data: [route('r1', 'model /?&'), route('foreign')],
				});
			}
		);
		assert.deepEqual(await fetchModelRoutes('model /?&', controller.signal), [
			route('r1', 'model /?&'),
		]);
	});
	it('accepts an empty list only on a successful response', async (context) => {
		context.mock.method(globalThis, 'fetch', async () =>
			Response.json({ success: true, data: [] })
		);
		assert.deepEqual(await fetchModelRoutes('model-1'), []);
	});
	it('does not turn HTTP, malformed or network failures into an empty route list', async (context) => {
		const fetchMock = context.mock.method(globalThis, 'fetch', async () =>
			Response.json({ success: false, message: 'Access denied' })
		);
		await assert.rejects(fetchModelRoutes('model-1'), /Access denied/);
		fetchMock.mock.mockImplementation(async () =>
			Response.json({ success: true, data: {} })
		);
		await assert.rejects(fetchModelRoutes('model-1'), /Failed to load routes/);
		fetchMock.mock.mockImplementation(async () => {
			throw new Error('offline');
		});
		await assert.rejects(fetchModelRoutes('model-1'), /offline/);
	});
	it('deletes each selected owned route once, preserving partial failures across providers', async (context) => {
		const calls: string[] = [];
		context.mock.method(
			globalThis,
			'fetch',
			async (url: string, options?: RequestInit) => {
				calls.push(url);
				assert.equal(options?.method, 'DELETE');
				if (url.endsWith('/r2'))
					return Response.json({ success: false, message: 'Conflict' });
				if (url.endsWith('/r3')) throw new Error('Network failure');
				return Response.json({ success: true });
			}
		);
		const rows = [
			route('r1'),
			route('r2'),
			route('r3'),
			route('r4', 'other-model'),
		];
		const result = await deleteModelRoutes('model-1', rows, [
			'r1',
			'r1',
			'r2',
			'r3',
			'r4',
			'unknown',
		]);
		assert.deepEqual(calls, [
			'/api/admin/routes/r1',
			'/api/admin/routes/r2',
			'/api/admin/routes/r3',
		]);
		assert.deepEqual(result.deletedIds, ['r1']);
		assert.deepEqual(
			result.failures.map((f) => [f.route.id, f.message]),
			[
				['r2', 'Conflict'],
				['r3', 'Network failure'],
			]
		);
	});
	it('does not send deletion requests for an empty selection or another model', async (context) => {
		const fetchMock = context.mock.method(globalThis, 'fetch');
		assert.deepEqual(
			await deleteModelRoutes('model-1', [route('r1', 'other')], ['r1']),
			{ deletedIds: [], failures: [] }
		);
		assert.equal(fetchMock.mock.callCount(), 0);
	});
});
