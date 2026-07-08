import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveProviderApiKeyRow, GatewayRepositories } from '@octafuse/core';
import type { RouteResult } from './model-router';
import { EMPTY_USAGE } from './proxy';
import { failoverDispatchWithKeyPool } from './failover-dispatch';
import { markProviderKeyFailure, resetProviderKeyCircuitStateForTests, isProviderKeyCircuitOpen } from './provider-key-circuit-breaker';
import {
	acquireProviderKey,
	resetProviderKeyRateLimiterStateForTests,
} from './provider-key-rate-limiter';
import { resetStickyBindingStateForTests } from './sticky-key-binding';

function makeRoute(providerId: string): RouteResult {
	return {
		providerId,
		providerName: providerId,
		providerModelName: 'model-x',
		upstreamProtocol: 'openai',
		baseUrl: 'https://example.com/v1',
		providerApiKey: '',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
	};
}

function makeKey(id: string, overrides: Partial<ActiveProviderApiKeyRow> = {}): ActiveProviderApiKeyRow {
	return {
		id,
		label: id,
		api_key: `sk-${id}`,
		weight: 1,
		priority: 0,
		limit_config: null,
		...overrides,
	};
}

function mockRepos(keysByProvider: Map<string, ActiveProviderApiKeyRow[]>): GatewayRepositories {
	return {
		providerKeys: {
			getActiveProviderKeys: async (providerId: string) => keysByProvider.get(providerId) ?? [],
		},
	} as GatewayRepositories;
}

beforeEach(() => {
	resetProviderKeyCircuitStateForTests();
	resetProviderKeyRateLimiterStateForTests();
	resetStickyBindingStateForTests();
});

describe('failoverDispatchWithKeyPool — all keys unavailable', () => {
	it('returns 429 + Retry-After when every key is circuit-open (no upstream dispatch)', async () => {
		const key = makeKey('k1');
		markProviderKeyFailure('k1', 'rate_limit', 5_000);
		const dispatch = vi.fn();
		const routes = [makeRoute('p1')];
		const repos = mockRepos(new Map([['p1', [key]]]));

		const result = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);

		expect(dispatch).not.toHaveBeenCalled();
		expect(result.response.status).toBe(429);
		expect(result.response.headers.get('Retry-After')).toBeTruthy();
		const retryAfter = Number(result.response.headers.get('Retry-After'));
		expect(retryAfter).toBeGreaterThan(0);
		expect(retryAfter).toBeLessThanOrEqual(5);
		const body = (await result.response.json()) as {
			error: { code: string; retry_after_seconds: number };
		};
		expect(body.error.code).toBe('upstream_capacity_exhausted');
		expect(body.error.retry_after_seconds).toBe(retryAfter);
		expect(result.usagePromise).toEqual(Promise.resolve(EMPTY_USAGE));
	});

	it('returns 429 when gateway rate limit leaves no eligible key (no fallback retry)', async () => {
		const key = makeKey('k1', { limit_config: JSON.stringify({ rpm: 1 }) });
		acquireProviderKey(key);
		const dispatch = vi.fn();
		const routes = [makeRoute('p1')];
		const repos = mockRepos(new Map([['p1', [key]]]));

		const result = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);

		expect(dispatch).not.toHaveBeenCalled();
		expect(result.response.status).toBe(429);
		expect(result.response.headers.get('Retry-After')).toBeTruthy();
		const body = (await result.response.json()) as { error: { code: string } };
		expect(body.error.code).toBe('upstream_capacity_exhausted');
	});

	it('dispatches when at least one key is eligible', async () => {
		const key = makeKey('k1');
		const dispatch = vi.fn(async () => ({
			response: new Response('ok', { status: 200 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const routes = [makeRoute('p1')];
		const repos = mockRepos(new Map([['p1', [key]]]));

		const result = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(result.response.status).toBe(200);
	});
});

describe('failoverDispatchWithKeyPool — soft server failures', () => {
	it('does not open circuit after upstream 524 so the next request still dispatches', async () => {
		const key = makeKey('k1');
		const dispatch = vi
			.fn()
			.mockResolvedValueOnce({
				response: new Response('timeout', { status: 524 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			})
			.mockResolvedValueOnce({
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			});
		const routes = [makeRoute('p1')];
		const repos = mockRepos(new Map([['p1', [key]]]));

		const first = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);
		expect(first.response.status).toBe(524);
		expect(isProviderKeyCircuitOpen('k1')).toBe(false);

		const second = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);
		expect(dispatch).toHaveBeenCalledTimes(2);
		expect(second.response.status).toBe(200);
	});

	it('does not open circuit after fetch failure so the next request still dispatches', async () => {
		const key = makeKey('k1');
		const dispatch = vi
			.fn()
			.mockRejectedValueOnce(new Error('network reset'))
			.mockResolvedValueOnce({
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			});
		const routes = [makeRoute('p1')];
		const repos = mockRepos(new Map([['p1', [key]]]));

		const first = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);
		expect(first.response.status).toBe(502);
		expect(isProviderKeyCircuitOpen('k1')).toBe(false);

		const second = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);
		expect(dispatch).toHaveBeenCalledTimes(2);
		expect(second.response.status).toBe(200);
	});

	it('does not block the next request after a single ordinary 5xx', async () => {
		const key = makeKey('k1');
		const dispatch = vi
			.fn()
			.mockResolvedValueOnce({
				response: new Response('error', { status: 503 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			})
			.mockResolvedValueOnce({
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			});
		const routes = [makeRoute('p1')];
		const repos = mockRepos(new Map([['p1', [key]]]));

		const first = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);
		expect(first.response.status).toBe(503);
		expect(isProviderKeyCircuitOpen('k1')).toBe(false);

		const second = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);
		expect(dispatch).toHaveBeenCalledTimes(2);
		expect(second.response.status).toBe(200);
	});

	it('returns 429 after three consecutive ordinary 5xx failures exhaust the only key', async () => {
		const key = makeKey('k1');
		const dispatch = vi.fn(async () => ({
			response: new Response('error', { status: 500 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const routes = [makeRoute('p1')];
		const repos = mockRepos(new Map([['p1', [key]]]));

		await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);
		await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);
		await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);

		const blocked = await failoverDispatchWithKeyPool(repos, routes, 'openai', dispatch);
		expect(dispatch).toHaveBeenCalledTimes(3);
		expect(blocked.response.status).toBe(429);
		expect(isProviderKeyCircuitOpen('k1')).toBe(true);
	});
});
