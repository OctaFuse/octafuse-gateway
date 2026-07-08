import { beforeEach, describe, expect, it } from 'vitest';
import {
	getProviderKeyCircuitRemainingMs,
	isProviderKeyCircuitOpen,
	markProviderKeyFailure,
	markProviderKeySuccess,
	parseRetryAfterMs,
	resetProviderKeyCircuitStateForTests,
} from './provider-key-circuit-breaker';

beforeEach(() => {
	resetProviderKeyCircuitStateForTests();
});

describe('parseRetryAfterMs', () => {
	it('parses seconds form', () => {
		expect(parseRetryAfterMs('30')).toBe(30_000);
		expect(parseRetryAfterMs('0')).toBe(0);
	});

	it('parses HTTP date form relative to now', () => {
		const now = Date.parse('2026-01-01T00:00:00Z');
		expect(parseRetryAfterMs(new Date(now + 45_000).toUTCString(), now)).toBe(45_000);
		// 过去的日期 → 0（立即可重试）。
		expect(parseRetryAfterMs(new Date(now - 45_000).toUTCString(), now)).toBe(0);
	});

	it('returns null for missing or invalid values', () => {
		expect(parseRetryAfterMs(null)).toBeNull();
		expect(parseRetryAfterMs('')).toBeNull();
		expect(parseRetryAfterMs('soon')).toBeNull();
	});
});

describe('rate_limit failures', () => {
	it('honors upstream Retry-After when present', () => {
		const t0 = 1_000_000;
		const result = markProviderKeyFailure('k', 'rate_limit', 5_000, t0);
		expect(result.openedOrExtended).toBe(true);
		expect(result.failureKind).toBe('rate_limit');
		expect(result.cooldownMs).toBe(5_000);
		expect(getProviderKeyCircuitRemainingMs('k', t0)).toBe(5_000);
		expect(isProviderKeyCircuitOpen('k', t0 + 5_001)).toBe(false);
	});

	it('caps oversized Retry-After at 15min', () => {
		const t0 = 1_000_000;
		markProviderKeyFailure('k', 'rate_limit', 3_600_000, t0);
		expect(getProviderKeyCircuitRemainingMs('k', t0)).toBe(900_000);
	});

	it('escalates backoff on consecutive 429s without Retry-After after each cooldown', () => {
		const t0 = 1_000_000;
		markProviderKeyFailure('k', 'rate_limit', null, t0);
		expect(getProviderKeyCircuitRemainingMs('k', t0)).toBe(5_000);
		markProviderKeyFailure('k', 'rate_limit', null, t0 + 5_001);
		expect(getProviderKeyCircuitRemainingMs('k', t0 + 5_001)).toBe(15_000);
		markProviderKeyFailure('k', 'rate_limit', null, t0 + 20_002);
		expect(getProviderKeyCircuitRemainingMs('k', t0 + 20_002)).toBe(30_000);
		markProviderKeyFailure('k', 'rate_limit', null, t0 + 50_003);
		expect(getProviderKeyCircuitRemainingMs('k', t0 + 50_003)).toBe(60_000);
		// 封顶。
		markProviderKeyFailure('k', 'rate_limit', null, t0 + 110_004);
		expect(getProviderKeyCircuitRemainingMs('k', t0 + 110_004)).toBe(60_000);
	});

	it('does not escalate when multiple 429s arrive in the same open circuit window', () => {
		const t0 = 1_000_000;
		markProviderKeyFailure('k', 'rate_limit', null, t0);
		expect(getProviderKeyCircuitRemainingMs('k', t0)).toBe(5_000);
		markProviderKeyFailure('k', 'rate_limit', null, t0);
		markProviderKeyFailure('k', 'rate_limit', null, t0);
		expect(getProviderKeyCircuitRemainingMs('k', t0)).toBe(5_000);
	});

	it('resets the escalation counter after a success', () => {
		const t0 = 1_000_000;
		markProviderKeyFailure('k', 'rate_limit', null, t0);
		markProviderKeyFailure('k', 'rate_limit', null, t0 + 5_001);
		markProviderKeySuccess('k', t0 + 20_002);
		markProviderKeyFailure('k', 'rate_limit', null, t0 + 20_003);
		expect(getProviderKeyCircuitRemainingMs('k', t0 + 20_003)).toBe(5_000);
	});
});

describe('auth / server failures', () => {
	it('opens 10min for auth failures', () => {
		const t0 = 1_000_000;
		markProviderKeyFailure('k', 'auth', null, t0);
		expect(getProviderKeyCircuitRemainingMs('k', t0)).toBe(600_000);
	});

	it('does not open circuit on first two server failures', () => {
		const t0 = 1_000_000;
		expect(markProviderKeyFailure('k', 'server', null, t0).openedOrExtended).toBe(false);
		expect(getProviderKeyCircuitRemainingMs('k', t0)).toBe(0);
		expect(markProviderKeyFailure('k', 'server', null, t0 + 1).openedOrExtended).toBe(false);
		expect(getProviderKeyCircuitRemainingMs('k', t0 + 1)).toBe(0);
	});

	it('opens 10s after three consecutive server failures', () => {
		const t0 = 1_000_000;
		markProviderKeyFailure('k', 'server', null, t0);
		markProviderKeyFailure('k', 'server', null, t0 + 1);
		const result = markProviderKeyFailure('k', 'server', null, t0 + 2);
		expect(result.openedOrExtended).toBe(true);
		expect(result.cooldownMs).toBe(10_000);
		expect(getProviderKeyCircuitRemainingMs('k', t0 + 2)).toBe(10_000);
		expect(isProviderKeyCircuitOpen('k', t0 + 12_001)).toBe(false);
	});

	it('resets server failure count after a success', () => {
		const t0 = 1_000_000;
		markProviderKeyFailure('k', 'server', null, t0);
		markProviderKeyFailure('k', 'server', null, t0 + 1);
		markProviderKeySuccess('k', t0 + 2);
		markProviderKeyFailure('k', 'server', null, t0 + 3);
		expect(getProviderKeyCircuitRemainingMs('k', t0 + 3)).toBe(0);
	});

	it('never shortens an already-open auth circuit when server failures arrive', () => {
		const t0 = 1_000_000;
		markProviderKeyFailure('k', 'auth', null, t0);
		markProviderKeyFailure('k', 'server', null, t0 + 1_000);
		markProviderKeyFailure('k', 'server', null, t0 + 2_000);
		markProviderKeyFailure('k', 'server', null, t0 + 3_000);
		expect(getProviderKeyCircuitRemainingMs('k', t0 + 3_000)).toBe(597_000);
	});
});

describe('markProviderKeySuccess', () => {
	it('is a no-op for unknown keys and clears expired entries', () => {
		markProviderKeySuccess('unknown');
		const t0 = 1_000_000;
		markProviderKeyFailure('k', 'server', null, t0);
		markProviderKeyFailure('k', 'server', null, t0 + 1);
		markProviderKeyFailure('k', 'server', null, t0 + 2);
		markProviderKeySuccess('k', t0 + 12_001);
		expect(isProviderKeyCircuitOpen('k', t0 + 12_001)).toBe(false);
	});
});
