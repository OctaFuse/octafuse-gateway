import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { listStickyBindingsService, updateRoutePoolPolicyService } from './model-routes-service';

describe('updateRoutePoolPolicyService sticky_routing', () => {
	it('accepts sticky_routing and writes sticky fields', async () => {
		// 显式声明 mock 参数，保留调用参数类型以覆盖 sticky 字段写入断言。
		const updateRoutePoolPolicy = mock.fn(async (_poolId: string, _patch: unknown) => 1);
		const repos = {
			routes: { updateRoutePoolPolicy },
		} as unknown as GatewayRepositories;

		await updateRoutePoolPolicyService(repos, 'pool-1', {
			sticky_routing: { enabled: true, idle_ttl_seconds: 7200 },
		});

		assert.equal(updateRoutePoolPolicy.mock.callCount(), 1);
		assert.deepEqual(updateRoutePoolPolicy.mock.calls[0]?.arguments[1], {
			stickyEnabled: true,
			stickyIdleTtlSeconds: 7200,
		});
	});

	it('rejects out-of-range idle_ttl_seconds', async () => {
		const repos = {
			routes: { updateRoutePoolPolicy: mock.fn(async () => 1) },
		} as unknown as GatewayRepositories;

		await assert.rejects(
			() =>
				updateRoutePoolPolicyService(repos, 'pool-1', {
					sticky_routing: { enabled: true, idle_ttl_seconds: 10 },
				}),
			(err: unknown) => {
				assert.ok(err && typeof err === 'object' && 'status' in err);
				assert.equal((err as { status: number }).status, 400);
				return true;
			}
		);
	});
});

describe('listStickyBindingsService', () => {
	const future = new Date(Date.now() + 600_000).toISOString();

	it('resolves users from affinity_key and tolerates legacy rows without it', async () => {
		const listActiveBindings = mock.fn(async (_params: unknown) => ({
			total: 3,
			rows: [
				{
					affinity_hash: 'h1',
					affinity_key: 'u1|gpt-5|default|openai',
					route_target_id: 't1',
					expires_at: future,
					updated_at: '2026-01-01T00:00:00.000Z',
				},
				{
					affinity_hash: 'h2',
					affinity_key: 'ghost|gpt-5|vip|openai',
					route_target_id: 't2',
					expires_at: future,
					updated_at: null,
				},
				{
					affinity_hash: 'h3',
					affinity_key: null,
					route_target_id: 't1',
					expires_at: future,
					updated_at: null,
				},
			],
		}));
		const getById = mock.fn(async (id: string) =>
			id === 'u1' ? { id: 'u1', email: 'a@example.com' } : null
		);
		const repos = {
			routePoolSticky: { listActiveBindings },
			users: { getById },
		} as unknown as GatewayRepositories;

		const result = await listStickyBindingsService(repos, 'pool-1', { page: 2, page_size: 5 });

		assert.deepEqual(listActiveBindings.mock.calls[0]?.arguments[0], {
			routePoolId: 'pool-1',
			nowIso: (listActiveBindings.mock.calls[0]?.arguments[0] as { nowIso: string }).nowIso,
			limit: 5,
			offset: 5,
			routeTargetId: null,
		});
		assert.equal(result.total, 3);
		assert.equal(result.page, 2);
		assert.equal(result.items[0].email, 'a@example.com');
		assert.equal(result.items[0].model_id, 'gpt-5');
		assert.ok(result.items[0].remaining_seconds > 0);
		assert.equal(result.items[1].user_id, 'ghost');
		assert.equal(result.items[1].email, null);
		assert.equal(result.items[2].user_id, null);
		assert.equal(getById.mock.callCount(), 2);
	});

	it('clamps page size and forwards target filter', async () => {
		const listActiveBindings = mock.fn(async (_params: unknown) => ({ total: 0, rows: [] }));
		const repos = {
			routePoolSticky: { listActiveBindings },
			users: { getById: mock.fn(async () => null) },
		} as unknown as GatewayRepositories;

		const result = await listStickyBindingsService(repos, 'pool-1', {
			page_size: 9999,
			route_target_id: ' t9 ',
		});

		const args = listActiveBindings.mock.calls[0]?.arguments[0] as {
			limit: number;
			routeTargetId: string;
		};
		assert.equal(args.limit, 100);
		assert.equal(args.routeTargetId, 't9');
		assert.equal(result.page_size, 100);
	});
});
