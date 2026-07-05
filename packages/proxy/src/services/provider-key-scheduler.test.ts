import { beforeEach, describe, expect, it } from 'vitest';
import type { ActiveProviderApiKeyRow } from '@octafuse/core';
import type { RouteResult } from './model-router';
import { buildKeyAttemptPlan } from './provider-key-scheduler';
import {
	markProviderKeyFailure,
	resetProviderKeyCircuitStateForTests,
} from './provider-key-circuit-breaker';
import {
	acquireProviderKey,
	resetProviderKeyRateLimiterStateForTests,
} from './provider-key-rate-limiter';

function makeRoute(providerId: string, routePriority = 0): RouteResult {
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
		routePriority,
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

beforeEach(() => {
	resetProviderKeyCircuitStateForTests();
	resetProviderKeyRateLimiterStateForTests();
});

describe('buildKeyAttemptPlan', () => {
	it('includes all keys of a provider and keeps key priority order', () => {
		const routes = [makeRoute('p1')];
		const keys = new Map([
			['p1', [makeKey('low', { priority: 0 }), makeKey('high', { priority: 10 })]],
		]);
		const plan = buildKeyAttemptPlan(routes, keys);
		expect(plan.attempts.map((a) => a.key.id)).toEqual(['high', 'low']);
		expect(plan.earliestRetryAfterMs).toBeNull();
	});

	it('orders provider tiers by route priority and merges keys within the same tier', () => {
		const routes = [makeRoute('backup', 0), makeRoute('primary-a', 10), makeRoute('primary-b', 10)];
		const keys = new Map([
			['backup', [makeKey('backup-key')]],
			['primary-a', [makeKey('a-key')]],
			['primary-b', [makeKey('b-key')]],
		]);
		const plan = buildKeyAttemptPlan(routes, keys);
		expect(plan.attempts).toHaveLength(3);
		// 前两个来自同层（primary-a / primary-b 合并池），最后是 backup。
		expect(new Set(plan.attempts.slice(0, 2).map((a) => a.key.id))).toEqual(new Set(['a-key', 'b-key']));
		expect(plan.attempts[2]!.key.id).toBe('backup-key');
	});

	it('skips circuit-open keys and reports earliest recovery', () => {
		const routes = [makeRoute('p1')];
		const keyA = makeKey('a');
		const keyB = makeKey('b');
		markProviderKeyFailure('a', 'rate_limit', 5_000);
		const plan = buildKeyAttemptPlan(routes, new Map([['p1', [keyA, keyB]]]));
		expect(plan.attempts.map((a) => a.key.id)).toEqual(['b']);
		expect(plan.earliestRetryAfterMs).toBeGreaterThan(0);
		expect(plan.earliestRetryAfterMs).toBeLessThanOrEqual(5_000);
	});

	it('skips rate-limited keys (rpm exhausted)', () => {
		const routes = [makeRoute('p1')];
		const limited = makeKey('limited', { limit_config: JSON.stringify({ rpm: 1 }) });
		const free = makeKey('free');
		acquireProviderKey(limited);
		const plan = buildKeyAttemptPlan(routes, new Map([['p1', [limited, free]]]));
		expect(plan.attempts.map((a) => a.key.id)).toEqual(['free']);
		expect(plan.earliestRetryAfterMs).toBeGreaterThan(0);
	});

	it('returns empty attempts with retry hint when all keys are unavailable', () => {
		const routes = [makeRoute('p1')];
		const limited = makeKey('only', { limit_config: JSON.stringify({ rpm: 1 }) });
		acquireProviderKey(limited);
		const plan = buildKeyAttemptPlan(routes, new Map([['p1', [limited]]]));
		expect(plan.attempts).toHaveLength(0);
		expect(plan.earliestRetryAfterMs).toBeGreaterThan(0);
	});

	it('puts the sticky-bound key first when available', () => {
		const routes = [makeRoute('p1', 0), makeRoute('p2', 10)];
		const keys = new Map([
			['p1', [makeKey('bound')]],
			['p2', [makeKey('higher-tier')]],
		]);
		const plan = buildKeyAttemptPlan(routes, keys, {
			binding: { providerId: 'p1', keyId: 'bound' },
			shortWaitMs: 3000,
		});
		expect(plan.attempts[0]!.key.id).toBe('bound');
		expect(plan.stickyWait).toBeNull();
	});

	it('suggests short wait when the sticky key is briefly rate limited', () => {
		const routes = [makeRoute('p1')];
		const bound = makeKey('bound', { limit_config: JSON.stringify({ rpm: 1 }) });
		const other = makeKey('other');
		acquireProviderKey(bound);
		const plan = buildKeyAttemptPlan(routes, new Map([['p1', [bound, other]]]), {
			binding: { providerId: 'p1', keyId: 'bound' },
			shortWaitMs: 120_000, // 阈值放宽以覆盖 rpm 窗口恢复时间
		});
		expect(plan.stickyWait).not.toBeNull();
		expect(plan.stickyWait!.waitMs).toBeGreaterThan(0);
		expect(plan.attempts.map((a) => a.key.id)).toEqual(['other']);
	});

	it('ignores sticky binding when the bound key is circuit-open', () => {
		const routes = [makeRoute('p1')];
		const bound = makeKey('bound');
		const other = makeKey('other');
		markProviderKeyFailure('bound', 'auth');
		const plan = buildKeyAttemptPlan(routes, new Map([['p1', [bound, other]]]), {
			binding: { providerId: 'p1', keyId: 'bound' },
			shortWaitMs: 3000,
		});
		expect(plan.stickyWait).toBeNull();
		expect(plan.attempts.map((a) => a.key.id)).toEqual(['other']);
	});
});
