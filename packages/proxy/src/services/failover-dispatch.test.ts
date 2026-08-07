import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { GatewayRepositories } from '@octafuse/core';
import type { RouteResult } from './model-router';
import { EMPTY_USAGE } from './proxy';
import { failoverDispatch, isSuccessfulDispatchResponse } from './failover-dispatch';
import {
	isProviderCircuitOpen,
	markProviderFailure,
	resetProviderCircuitStateForTests,
} from './provider-circuit-breaker';

function makeRoute(providerId: string, overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: `target-${providerId}`,
		modelSurfaceId: null,
		routePoolId: 'pool-1',
		providerId,
		providerName: providerId,
		providerModelName: 'model-x',
		upstreamProtocol: 'openai',
		upstreamOperation: 'chat',
		adapter: 'passthrough',
		providerEndpoints: { openai: { base: 'https://example.com/v1' } },
		providerApiKey: `sk-${providerId}`,
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: providerId,
		providerKeyLabel: providerId,
		providerKeyFingerprint: `…${providerId.slice(-4)}`,
		...overrides,
	};
}

const emptyRepos = {} as GatewayRepositories;

const defaultOptions = {
	affinityKey: 'u|m|default|openai',
	tierKeyPrefix: 'm|default|openai',
	strategy: 'weight_priority' as const,
};

beforeEach(() => {
	resetProviderCircuitStateForTests();
});

describe('dispatch success response', () => {
	it('accepts Cloudflare WebSocket 101 responses in addition to HTTP 2xx', () => {
		assert.equal(
			isSuccessfulDispatchResponse({
				ok: false,
				status: 101,
				webSocket: {},
			} as Response),
			true
		);
	});
});

describe('failoverDispatch — all providers unavailable', () => {
	it('returns 429 + Retry-After when every provider is circuit-open (no upstream dispatch)', async () => {
		markProviderFailure('p1', 'rate_limit', 5_000);
		const dispatch = mock.fn();
		const routes = [makeRoute('p1')];

		const result = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);

		assert.equal(dispatch.mock.callCount(), 0);
		assert.equal(result.response.status, 429);
		assert.ok(result.response.headers.get('Retry-After'));
		const retryAfter = Number(result.response.headers.get('Retry-After'));
		assert.ok(retryAfter > 0);
		assert.ok(retryAfter <= 5);
		const body = (await result.response.json()) as {
			error: { code: string; retry_after_seconds: number; message: string };
		};
		assert.equal(body.error.code, 'circuit.upstream_capacity_exhausted');
		assert.equal(body.error.retry_after_seconds, retryAfter);
		assert.match(body.error.message, /providers are cooling down/i);
		assert.equal(result.suppressErrorAlert, true);
		assert.deepEqual(result.circuitEvents, []);
	});

	it('dispatches when at least one provider is eligible', async () => {
		const dispatch = mock.fn(async () => ({
			response: new Response('ok', { status: 200 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const routes = [makeRoute('p1')];

		const result = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);

		assert.equal(dispatch.mock.callCount(), 1);
		assert.equal(result.response.status, 200);
	});

	it('accepts mixed protocol targets for an adapter-backed surface', async () => {
		const dispatch = mock.fn(async () => ({
			response: new Response('ok', { status: 200 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const routes = [
			makeRoute('dashscope', {
				upstreamProtocol: 'dashscope',
				providerEndpoints: {
					dashscope: { base: 'https://workspace.example/api/v1' },
				},
			}),
		];

		const result = await failoverDispatch(
			emptyRepos,
			routes,
			['openai', 'dashscope'],
			dispatch,
			undefined,
			defaultOptions
		);

		assert.equal(dispatch.mock.callCount(), 1);
		assert.equal(result.chosenRoute.upstreamProtocol, 'dashscope');
	});
});

describe('failoverDispatch — image abort (no failover)', () => {
	it('does not try next provider when meta.imageAbortReason is client_abort', async () => {
		const dispatch = mock.fn(async () => ({
			response: new Response(
				JSON.stringify({
					error: { message: 'cancelled', abort_reason: 'client_abort' },
				}),
				{ status: 504 }
			),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			meta: { imageAbortReason: 'client_abort' as const, parsedBody: { error: {} }, imageUsage: null },
		}));
		const routes = [makeRoute('p1'), makeRoute('p2')];

		const result = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);

		assert.equal(dispatch.mock.callCount(), 1);
		assert.equal(result.response.status, 504);
		assert.equal(result.meta?.imageAbortReason, 'client_abort');
	});

	it('does not try next provider when meta.imageAbortReason is gateway_timeout', async () => {
		const dispatch = mock.fn(async () => ({
			response: new Response(
				JSON.stringify({
					error: { message: 'timeout', abort_reason: 'gateway_timeout' },
				}),
				{ status: 504 }
			),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			meta: {
				imageAbortReason: 'gateway_timeout' as const,
				parsedBody: { error: {} },
				imageUsage: null,
			},
		}));
		const routes = [makeRoute('p1'), makeRoute('p2')];

		const result = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);

		assert.equal(dispatch.mock.callCount(), 1);
		assert.equal(result.response.status, 504);
	});

	it('still retries ordinary 504 without imageAbortReason', async () => {
		let calls = 0;
		const dispatch = mock.fn(async () => {
			calls += 1;
			if (calls === 1) {
				return {
					response: new Response('gateway timeout', { status: 504 }),
					usagePromise: Promise.resolve(EMPTY_USAGE),
					upstreamRequestId: null,
				};
			}
			return {
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			};
		});
		const routes = [makeRoute('p1'), makeRoute('p2')];

		const result = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);

		assert.equal(dispatch.mock.callCount(), 2);
		assert.equal(result.response.status, 200);
	});
});

describe('failoverDispatch — soft server failures', () => {
	it('does not open circuit after upstream 524 so the next request still dispatches', async () => {
		let calls = 0;
		const dispatch = mock.fn(async () => {
			calls += 1;
			if (calls === 1) {
				return {
					response: new Response('timeout', { status: 524 }),
					usagePromise: Promise.resolve(EMPTY_USAGE),
					upstreamRequestId: null,
				};
			}
			return {
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			};
		});
		const routes = [makeRoute('p1')];

		const first = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);
		assert.equal(first.response.status, 524);
		assert.equal(isProviderCircuitOpen('p1'), false);

		const second = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);
		assert.equal(dispatch.mock.callCount(), 2);
		assert.equal(second.response.status, 200);
	});

	it('does not open circuit after fetch failure so the next request still dispatches', async () => {
		let calls = 0;
		const dispatch = mock.fn(async () => {
			calls += 1;
			if (calls === 1) throw new Error('network reset');
			return {
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			};
		});
		const routes = [makeRoute('p1')];

		const first = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);
		assert.equal(first.response.status, 502);
		assert.equal(isProviderCircuitOpen('p1'), false);

		const second = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);
		assert.equal(dispatch.mock.callCount(), 2);
		assert.equal(second.response.status, 200);
	});

	it('does not block the next request after a single ordinary 5xx', async () => {
		let calls = 0;
		const dispatch = mock.fn(async () => {
			calls += 1;
			if (calls === 1) {
				return {
					response: new Response('error', { status: 503 }),
					usagePromise: Promise.resolve(EMPTY_USAGE),
					upstreamRequestId: null,
				};
			}
			return {
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			};
		});
		const routes = [makeRoute('p1')];

		const first = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);
		assert.equal(first.response.status, 503);
		assert.equal(isProviderCircuitOpen('p1'), false);

		const second = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);
		assert.equal(dispatch.mock.callCount(), 2);
		assert.equal(second.response.status, 200);
	});

	it('returns 429 after three consecutive ordinary 5xx failures exhaust the only provider', async () => {
		const dispatch = mock.fn(async () => ({
			response: new Response('error', { status: 500 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const routes = [makeRoute('p1')];

		await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);
		await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);
		await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);

		const blocked = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);
		assert.equal(dispatch.mock.callCount(), 3);
		assert.equal(blocked.response.status, 429);
		assert.equal(isProviderCircuitOpen('p1'), true);
		assert.equal(blocked.suppressErrorAlert, true);
	});

	it('records provider circuit event when upstream 429 opens circuit', async () => {
		const dispatch = mock.fn(async () => ({
			response: new Response('rate limited', { status: 429 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const routes = [makeRoute('p1')];

		const result = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);

		assert.equal(result.response.status, 429);
		assert.equal(result.circuitEvents.length, 1);
		assert.equal(result.circuitEvents[0]?.kind, 'provider');
		assert.equal((result.circuitEvents[0] as { providerId: string }).providerId, 'p1');
		assert.equal(result.circuitEvents[0]?.failureKind, 'rate_limit');
		assert.equal(result.circuitEvents[0]?.openedOrExtended, true);
		assert.equal(result.suppressErrorAlert, false);
	});

	it('skips same providerId mid-request after first target opens circuit', async () => {
		let calls = 0;
		const dispatch = mock.fn(async (route: RouteResult) => {
			calls += 1;
			if (calls === 1) {
				return {
					response: new Response('rate limited', {
						status: 429,
						headers: { 'Retry-After': '30' },
					}),
					usagePromise: Promise.resolve(EMPTY_USAGE),
					upstreamRequestId: null,
				};
			}
			return {
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			};
		});
		// Two targets on same provider, then a different provider
		const routes = [
			makeRoute('p1', { targetId: 't1', routePriority: 10 }),
			makeRoute('p1', { targetId: 't2', routePriority: 10 }),
			makeRoute('p2', { targetId: 't3', routePriority: 1 }),
		];

		const result = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);

		assert.equal(dispatch.mock.callCount(), 2);
		assert.equal(result.response.status, 200);
		assert.equal(result.chosenRoute.providerId, 'p2');
		assert.equal(isProviderCircuitOpen('p1'), true);
	});

	it('failovers across providers in priority order', async () => {
		const seen: string[] = [];
		const dispatch = mock.fn(async (route: RouteResult) => {
			seen.push(route.providerId);
			if (route.providerId === 'high') {
				return {
					response: new Response('error', { status: 503 }),
					usagePromise: Promise.resolve(EMPTY_USAGE),
					upstreamRequestId: null,
				};
			}
			return {
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			};
		});
		const routes = [makeRoute('low', { routePriority: 1 }), makeRoute('high', { routePriority: 10 })];

		const result = await failoverDispatch(emptyRepos, routes, 'openai', dispatch, undefined, defaultOptions);

		assert.deepEqual(seen, ['high', 'low']);
		assert.equal(result.response.status, 200);
		assert.equal(result.chosenRoute.providerId, 'low');
	});
});

describe('failoverDispatch — provider sticky', () => {
	const stickyRepoExtras = {
		deleteStaleBefore: mock.fn(async () => 0),
	};

	it('tries sticky low-priority target before higher priority tiers', async () => {
		const now = Date.now();
		const seen: string[] = [];
		// expires far enough that last-touch approximation is outside 60s throttle window
		const getBinding = mock.fn(async () => ({
			route_pool_id: 'pool-1',
			affinity_hash: 'x',
			route_target_id: 'low-target',
			binding_token: 'tok-1',
			pool_epoch: 0,
			expires_at: new Date(now + (3_600 - 120) * 1000).toISOString(),
		}));
		const touchBinding = mock.fn(async () => true);
		const repos = {
			routePoolSticky: {
				getBinding,
				touchBinding,
				tryBind: mock.fn(),
				clearBinding: mock.fn(),
				...stickyRepoExtras,
			},
		} as unknown as GatewayRepositories;
		const dispatch = mock.fn(async (route: RouteResult) => {
			seen.push(route.targetId);
			return {
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			};
		});
		const routes = [
			makeRoute('high', { targetId: 'high-target', routePriority: 10 }),
			makeRoute('low', { targetId: 'low-target', routePriority: 1 }),
		];

		const result = await failoverDispatch(repos, routes, 'openai', dispatch, undefined, {
			...defaultOptions,
			routePoolId: 'pool-1',
			sticky: { enabled: true, idleTtlSeconds: 3600, epoch: 0 },
		});

		assert.deepEqual(seen, ['low-target']);
		assert.equal(result.response.status, 200);
		const trace = await result.stickyTrace!();
		assert.equal(trace.lookup, 'hit');
		assert.equal(trace.result, 'kept');
		assert.ok(result.stickyMutationPromise);
		await result.stickyMutationPromise;
		assert.equal(touchBinding.mock.callCount(), 1);
	});

	it('clears sticky on provider failure and continues normal plan without retrying same target', async () => {
		const now = Date.now();
		const seen: string[] = [];
		const clearBinding = mock.fn(async () => true);
		const tryBind = mock.fn(async () => true);
		const repos = {
			routePoolSticky: {
				getBinding: async () => ({
					route_pool_id: 'pool-1',
					affinity_hash: 'x',
					route_target_id: 'low-target',
					binding_token: 'tok-1',
					pool_epoch: 0,
					expires_at: new Date(now + 3_600_000).toISOString(),
				}),
				clearBinding,
				tryBind,
				touchBinding: mock.fn(async () => true),
				...stickyRepoExtras,
			},
		} as unknown as GatewayRepositories;
		const dispatch = mock.fn(async (route: RouteResult) => {
			seen.push(route.targetId);
			if (route.targetId === 'low-target') {
				return {
					response: new Response('busy', { status: 429 }),
					usagePromise: Promise.resolve(EMPTY_USAGE),
					upstreamRequestId: null,
				};
			}
			return {
				response: new Response('ok', { status: 200 }),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			};
		});
		const routes = [
			makeRoute('high', { targetId: 'high-target', routePriority: 10 }),
			makeRoute('low', { targetId: 'low-target', routePriority: 1 }),
		];

		const result = await failoverDispatch(repos, routes, 'openai', dispatch, undefined, {
			...defaultOptions,
			routePoolId: 'pool-1',
			sticky: { enabled: true, idleTtlSeconds: 3600, epoch: 0 },
		});

		assert.deepEqual(seen, ['low-target', 'high-target']);
		assert.equal(result.response.status, 200);
		assert.equal(clearBinding.mock.callCount(), 1);
		const trace = await result.stickyTrace!();
		assert.equal(trace.result, 'rebound');
		assert.ok(result.stickyMutationPromise);
		await result.stickyMutationPromise;
		assert.equal(tryBind.mock.callCount(), 1);
	});

	it('does not clear sticky on 400 client errors', async () => {
		const now = Date.now();
		const clearBinding = mock.fn(async () => true);
		const repos = {
			routePoolSticky: {
				getBinding: async () => ({
					route_pool_id: 'pool-1',
					affinity_hash: 'x',
					route_target_id: 't1',
					binding_token: 'tok-1',
					pool_epoch: 0,
					expires_at: new Date(now + 3_600_000).toISOString(),
				}),
				clearBinding,
				tryBind: mock.fn(),
				touchBinding: mock.fn(),
				...stickyRepoExtras,
			},
		} as unknown as GatewayRepositories;
		const dispatch = mock.fn(async () => ({
			response: new Response('bad request', { status: 400 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const routes = [makeRoute('p1', { targetId: 't1' }), makeRoute('p2', { targetId: 't2' })];

		const result = await failoverDispatch(repos, routes, 'openai', dispatch, undefined, {
			...defaultOptions,
			routePoolId: 'pool-1',
			sticky: { enabled: true, idleTtlSeconds: 3600, epoch: 0 },
		});

		assert.equal(dispatch.mock.callCount(), 1);
		assert.equal(result.response.status, 400);
		assert.equal(clearBinding.mock.callCount(), 0);
		const trace = await result.stickyTrace!();
		assert.equal(trace.lookup, 'hit');
	});

	it('binds on first success when sticky enabled and storage miss', async () => {
		const tryBind = mock.fn(async () => true);
		const repos = {
			routePoolSticky: {
				getBinding: async () => null,
				tryBind,
				touchBinding: mock.fn(),
				clearBinding: mock.fn(),
				...stickyRepoExtras,
			},
		} as unknown as GatewayRepositories;
		const dispatch = mock.fn(async () => ({
			response: new Response('ok', { status: 200 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const result = await failoverDispatch(
			repos,
			[makeRoute('p1', { targetId: 't1' })],
			'openai',
			dispatch,
			undefined,
			{
				...defaultOptions,
				routePoolId: 'pool-1',
				sticky: { enabled: true, idleTtlSeconds: 3600, epoch: 3 },
			}
		);
		const trace = await result.stickyTrace!();
		assert.equal(trace.lookup, 'miss');
		assert.equal(trace.result, 'bound');
		assert.equal(trace.attempted_target, 't1');
		await result.stickyMutationPromise;
		assert.equal(tryBind.mock.callCount(), 1);
		const bindArgs = tryBind.mock.calls[0]?.arguments[0] as { poolEpoch: number };
		assert.equal(bindArgs.poolEpoch, 3);
	});

	it('records unchanged when tryBind loses CAS', async () => {
		const tryBind = mock.fn(async () => false);
		const repos = {
			routePoolSticky: {
				getBinding: async () => null,
				tryBind,
				touchBinding: mock.fn(),
				clearBinding: mock.fn(),
				...stickyRepoExtras,
			},
		} as unknown as GatewayRepositories;
		const dispatch = mock.fn(async () => ({
			response: new Response('ok', { status: 200 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const result = await failoverDispatch(
			repos,
			[makeRoute('p1', { targetId: 't1' })],
			'openai',
			dispatch,
			undefined,
			{
				...defaultOptions,
				routePoolId: 'pool-1',
				sticky: { enabled: true, idleTtlSeconds: 3600, epoch: 0 },
			}
		);
		const trace = await result.stickyTrace!();
		assert.equal(trace.lookup, 'miss');
		assert.equal(trace.result, 'unchanged');
	});

	it('skips rebind when sticky target is circuit-open but another provider succeeds', async () => {
		resetProviderCircuitStateForTests();
		const now = Date.now();
		markProviderFailure('p-sticky', 'rate_limit', 60_000);
		const tryBind = mock.fn(async () => true);
		const repos = {
			routePoolSticky: {
				getBinding: async () => ({
					route_pool_id: 'pool-1',
					affinity_hash: 'x',
					route_target_id: 'sticky-target',
					binding_token: 'tok-1',
					pool_epoch: 0,
					expires_at: new Date(now + 3_600_000).toISOString(),
				}),
				clearBinding: mock.fn(),
				tryBind,
				touchBinding: mock.fn(),
				...stickyRepoExtras,
			},
		} as unknown as GatewayRepositories;
		const dispatch = mock.fn(async () => ({
			response: new Response('ok', { status: 200 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));
		const result = await failoverDispatch(
			repos,
			[
				makeRoute('p-sticky', { targetId: 'sticky-target', routePriority: 1 }),
				makeRoute('p-other', { targetId: 'other-target', routePriority: 10 }),
			],
			'openai',
			dispatch,
			undefined,
			{
				...defaultOptions,
				routePoolId: 'pool-1',
				sticky: { enabled: true, idleTtlSeconds: 3600, epoch: 0 },
			}
		);
		assert.equal(result.response.status, 200);
		assert.equal(result.chosenRoute.targetId, 'other-target');
		assert.equal(tryBind.mock.callCount(), 0);
		const trace = await result.stickyTrace!();
		assert.equal(trace.lookup, 'invalid_circuit');
		assert.equal(trace.result, 'unchanged');
		resetProviderCircuitStateForTests();
	});

	it('skips sticky attempt when all candidates are circuit-open and leaves binding untouched', async () => {
		resetProviderCircuitStateForTests();
		const now = Date.now();
		markProviderFailure('p1', 'rate_limit', 60_000);
		const clearBinding = mock.fn(async () => true);
		const tryBind = mock.fn(async () => true);
		const repos = {
			routePoolSticky: {
				getBinding: async () => ({
					route_pool_id: 'pool-1',
					affinity_hash: 'x',
					route_target_id: 't1',
					binding_token: 'tok-1',
					pool_epoch: 0,
					expires_at: new Date(now + 3_600_000).toISOString(),
				}),
				clearBinding,
				tryBind,
				touchBinding: mock.fn(),
				...stickyRepoExtras,
			},
		} as unknown as GatewayRepositories;
		const dispatch = mock.fn(async () => ({
			response: new Response('ok', { status: 200 }),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		}));

		const result = await failoverDispatch(
			repos,
			[makeRoute('p1', { targetId: 't1' })],
			'openai',
			dispatch,
			undefined,
			{
				...defaultOptions,
				routePoolId: 'pool-1',
				sticky: { enabled: true, idleTtlSeconds: 3600, epoch: 0 },
			}
		);

		assert.equal(dispatch.mock.callCount(), 0);
		assert.equal(clearBinding.mock.callCount(), 0);
		assert.equal(tryBind.mock.callCount(), 0);
		const trace = await result.stickyTrace!();
		assert.equal(trace.lookup, 'invalid_circuit');
		resetProviderCircuitStateForTests();
	});
});
