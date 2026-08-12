import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { updateRoutePoolPolicyService } from './model-routes-service';

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
