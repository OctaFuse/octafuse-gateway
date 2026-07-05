import { beforeEach, describe, expect, it } from 'vitest';
import {
	acquireProviderKey,
	checkProviderKeyAvailability,
	getProviderKeyHeadroom,
	releaseProviderKeyUsage,
	resetProviderKeyRateLimiterStateForTests,
} from './provider-key-rate-limiter';

function key(id: string, limits: Record<string, number> | null) {
	return { id, limit_config: limits ? JSON.stringify(limits) : null };
}

beforeEach(() => {
	resetProviderKeyRateLimiterStateForTests();
});

describe('checkProviderKeyAvailability', () => {
	it('is always available without limit_config', () => {
		const k = key('free', null);
		for (let i = 0; i < 100; i++) acquireProviderKey(k);
		expect(checkProviderKeyAvailability(k)).toEqual({ available: true });
	});

	it('blocks on rpm and recovers after the window slides', () => {
		const k = key('k', { rpm: 2 });
		const t0 = 1_000_000;
		acquireProviderKey(k, t0);
		acquireProviderKey(k, t0 + 1_000);
		const blocked = checkProviderKeyAvailability(k, t0 + 2_000);
		expect(blocked).toMatchObject({ available: false, reason: 'rpm' });
		if (!blocked.available) {
			// 最早一条 t0 在 t0+60s 滑出窗口。
			expect(blocked.retryAfterMs).toBe(58_000);
		}
		// 并发未配置，不受 inFlight 影响；60s 后窗口滑出恢复。
		expect(checkProviderKeyAvailability(k, t0 + 60_001)).toEqual({ available: true });
	});

	it('blocks on tpm after usage is recorded and estimates recovery', () => {
		const k = key('k', { tpm: 100 });
		const t0 = 1_000_000;
		acquireProviderKey(k, t0);
		releaseProviderKeyUsage(k, 120, t0 + 5_000);
		const blocked = checkProviderKeyAvailability(k, t0 + 10_000);
		expect(blocked).toMatchObject({ available: false, reason: 'tpm' });
		if (!blocked.available) {
			// token 事件 t0+5s 于 t0+65s 过期。
			expect(blocked.retryAfterMs).toBe(55_000);
		}
		expect(checkProviderKeyAvailability(k, t0 + 65_001)).toEqual({ available: true });
	});

	it('blocks on concurrency until in-flight requests settle', () => {
		const k = key('k', { max_concurrency: 1 });
		acquireProviderKey(k);
		expect(checkProviderKeyAvailability(k)).toMatchObject({ available: false, reason: 'concurrency' });
		releaseProviderKeyUsage(k, 0);
		expect(checkProviderKeyAvailability(k)).toEqual({ available: true });
	});
});

describe('getProviderKeyHeadroom', () => {
	it('returns 1 without limits and decreases as usage grows', () => {
		expect(getProviderKeyHeadroom(key('none', null))).toBe(1);

		const k = key('k', { rpm: 4 });
		const t0 = 1_000_000;
		expect(getProviderKeyHeadroom(k, t0)).toBe(1);
		acquireProviderKey(k, t0);
		expect(getProviderKeyHeadroom(k, t0)).toBe(0.75);
		acquireProviderKey(k, t0);
		acquireProviderKey(k, t0);
		acquireProviderKey(k, t0);
		expect(getProviderKeyHeadroom(k, t0)).toBe(0);
	});

	it('takes the minimum across configured dimensions', () => {
		const k = key('k', { rpm: 10, max_concurrency: 2 });
		const t0 = 1_000_000;
		acquireProviderKey(k, t0);
		// rpm 剩 9/10=0.9，并发剩 1/2=0.5 → 取 0.5。
		expect(getProviderKeyHeadroom(k, t0)).toBe(0.5);
	});
});

describe('releaseProviderKeyUsage', () => {
	it('never drives in-flight count negative', () => {
		const k = key('k', { max_concurrency: 2 });
		releaseProviderKeyUsage(k, 0);
		releaseProviderKeyUsage(k, 0);
		acquireProviderKey(k);
		expect(checkProviderKeyAvailability(k)).toEqual({ available: true });
	});
});
