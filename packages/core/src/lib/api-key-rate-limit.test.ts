import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	API_KEY_RATE_WINDOW_MS,
	coerceRateLimitInput,
	consumeApiKeyRateWindow,
	consumeRateLimitLayers,
	createMemoryApiKeyRateLimitStore,
	isRateLimitExceeded,
	keyRateLimitSubject,
	parseApiKeyRateLimit,
	rateLimitEquals,
	rateLimitRpmOf,
	rateLimitRetryAfterSeconds,
	resolveIngressHost,
	serializeApiKeyRateLimit,
	userRateLimitSubject,
	type RateLimitLayer,
} from './api-key-rate-limit.ts';

const T0 = Date.parse('2026-09-05T02:31:42.123Z');
const MINUTE_BOUNDARY_BEFORE = Date.parse('2026-09-05T02:31:59.500Z');
const MINUTE_BOUNDARY_AFTER = Date.parse('2026-09-05T02:32:00.100Z');

function layersFor(kind: 'key' | 'user', rpm: number | null): RateLimitLayer[] {
	if (kind === 'key') {
		return [
			{ subject: keyRateLimitSubject('key-rolling'), rpm },
			{ subject: userRateLimitSubject('user-unused'), rpm: null },
		];
	}
	return [
		{ subject: keyRateLimitSubject('key-unlimited'), rpm: null },
		{ subject: userRateLimitSubject('user-rolling'), rpm },
	];
}

describe('api-key-rate-limit', () => {
	it('treats NULL rpm as unlimited', () => {
		assert.equal(isRateLimitExceeded(1_000, null), false);
		assert.equal(parseApiKeyRateLimit(null), null);
		assert.equal(parseApiKeyRateLimit(''), null);
		assert.equal(parseApiKeyRateLimit('{}'), null);
	});

	it('parses rate_limit JSON and ignores invalid blobs', () => {
		assert.deepEqual(parseApiKeyRateLimit('{"rpm":60}'), { rpm: 60 });
		assert.deepEqual(parseApiKeyRateLimit({ rpm: 0 }), { rpm: 0 });
		assert.equal(parseApiKeyRateLimit('not-json'), null);
		assert.equal(parseApiKeyRateLimit({ rpm: -1 }), null);
		assert.equal(parseApiKeyRateLimit({ rpm: 1.5 }), null);
		assert.deepEqual(parseApiKeyRateLimit({ rpm: 60, rpd: 10 }), { rpm: 60 });
	});

	it('serializes empty / rpm-only objects', () => {
		assert.equal(serializeApiKeyRateLimit(null), null);
		assert.equal(serializeApiKeyRateLimit({}), null);
		assert.equal(serializeApiKeyRateLimit({ rpm: 60 }), '{"rpm":60}');
		assert.equal(rateLimitEquals({ rpm: 60 }, { rpm: 60 }), true);
		assert.equal(rateLimitEquals(null, {}), true);
		assert.equal(rateLimitRpmOf({ rpm: 60 }), 60);
		assert.equal(rateLimitRpmOf(null), null);
	});

	it('treats rpm 0 as denying the first increment', () => {
		assert.equal(isRateLimitExceeded(1, 0), true);
		assert.equal(isRateLimitExceeded(0, 0), false);
	});

	it('exceeds only after the Nth+1 request in the window', () => {
		assert.equal(isRateLimitExceeded(10, 10), false);
		assert.equal(isRateLimitExceeded(11, 10), true);
	});

	it('computes retry-after until the next consume can succeed', () => {
		assert.equal(rateLimitRetryAfterSeconds([], 1, T0), 1);
		assert.equal(rateLimitRetryAfterSeconds([T0], 0, T0), 60);
		assert.equal(rateLimitRetryAfterSeconds([T0, T0 + 1_000], 1, T0 + 1_000), 60);
	});

	it('coerces PATCH rate_limit (omit / null / object)', () => {
		assert.deepEqual(coerceRateLimitInput(undefined), { ok: true, omit: true });
		assert.deepEqual(coerceRateLimitInput(null), { ok: true, value: null });
		assert.deepEqual(coerceRateLimitInput(''), { ok: true, value: null });
		assert.deepEqual(coerceRateLimitInput({}), { ok: true, value: null });
		assert.deepEqual(coerceRateLimitInput({ rpm: 60 }), { ok: true, value: { rpm: 60 } });
		assert.deepEqual(coerceRateLimitInput('{"rpm":60}'), { ok: true, value: { rpm: 60 } });
		assert.deepEqual(coerceRateLimitInput({ rpm: '60' }), { ok: true, value: { rpm: 60 } });
		assert.equal(coerceRateLimitInput({ rpm: -1 }).ok, false);
		assert.equal(coerceRateLimitInput({ rpm: 1.5 }).ok, false);
		assert.equal(coerceRateLimitInput({ rpm: '1.5' }).ok, false);
		assert.equal(coerceRateLimitInput({ rpd: 10 }).ok, false);
		assert.equal(coerceRateLimitInput(60).ok, false);
	});

	it('resolves ingress host from Host header, then URL', () => {
		assert.equal(resolveIngressHost('api.example.com', 'http://ignored.local/v1'), 'api.example.com');
		assert.equal(resolveIngressHost('  gateway.example.com:8787 ', ''), 'gateway.example.com:8787');
		assert.equal(resolveIngressHost(undefined, 'https://proxy.example.com:443/v1/models'), 'proxy.example.com');
		assert.equal(resolveIngressHost(null, 'not a url'), null);
	});

	it('counts in memory per subject and drops timestamps outside the trailing 60s', async () => {
		const store = createMemoryApiKeyRateLimitStore();
		assert.equal((await consumeApiKeyRateWindow('k1', T0, 100, store)).count, 1);
		assert.equal((await consumeApiKeyRateWindow('k1', T0 + 1, 100, store)).count, 2);
		assert.equal((await consumeApiKeyRateWindow('k2', T0, 100, store)).count, 1);
		assert.equal((await consumeApiKeyRateWindow('k1', T0 + 1 + API_KEY_RATE_WINDOW_MS, 100, store)).count, 1);
	});

	it('prunes stale subjects when over capacity', async () => {
		const store = createMemoryApiKeyRateLimitStore(2);
		assert.equal((await consumeApiKeyRateWindow('a', T0, 10, store)).count, 1);
		assert.equal((await consumeApiKeyRateWindow('b', T0, 10, store)).count, 1);
		assert.equal((await consumeApiKeyRateWindow('c', T0 + API_KEY_RATE_WINDOW_MS, 10, store)).count, 1);
		assert.equal((await consumeApiKeyRateWindow('a', T0 + API_KEY_RATE_WINDOW_MS, 10, store)).count, 1);
	});

	it('does not consume the user window when the key layer is already exceeded', async () => {
		const inner = createMemoryApiKeyRateLimitStore();
		const subjects: string[] = [];
		const store = {
			consume(subject: string, nowMs: number, rpm: number) {
				subjects.push(subject);
				return inner.consume(subject, nowMs, rpm);
			},
		};
		const keyId = 'key-1';
		const userId = 'user-1';
		const layers = [
			{ subject: keyRateLimitSubject(keyId), rpm: 1 },
			{ subject: userRateLimitSubject(userId), rpm: 100 },
		];
		assert.equal((await consumeRateLimitLayers(layers, T0, store)).exceeded, false);
		assert.equal((await consumeRateLimitLayers(layers, T0 + 1, store)).exceeded, true);
		assert.deepEqual(subjects, [
			keyRateLimitSubject(keyId),
			userRateLimitSubject(userId),
			keyRateLimitSubject(keyId),
		]);
	});

	it('shares the user window across keys', async () => {
		const store = createMemoryApiKeyRateLimitStore();
		const userSubject = userRateLimitSubject('user-shared');
		const first = await consumeRateLimitLayers(
			[
				{ subject: keyRateLimitSubject('key-a'), rpm: null },
				{ subject: userSubject, rpm: 2 },
			],
			T0,
			store
		);
		const second = await consumeRateLimitLayers(
			[
				{ subject: keyRateLimitSubject('key-b'), rpm: null },
				{ subject: userSubject, rpm: 2 },
			],
			T0 + 1,
			store
		);
		const third = await consumeRateLimitLayers(
			[
				{ subject: keyRateLimitSubject('key-a'), rpm: null },
				{ subject: userSubject, rpm: 2 },
			],
			T0 + 2,
			store
		);
		assert.equal(first.exceeded, false);
		assert.equal(second.exceeded, false);
		assert.equal(third.exceeded, true);
	});

	for (const kind of ['key', 'user'] as const) {
		describe(`${kind} trailing 60s window`, () => {
			it('exceeds on the rpm+1 request inside 60s', async () => {
				const store = createMemoryApiKeyRateLimitStore();
				const layers = layersFor(kind, 2);
				assert.equal((await consumeRateLimitLayers(layers, T0, store)).exceeded, false);
				assert.equal((await consumeRateLimitLayers(layers, T0 + 1, store)).exceeded, false);
				assert.equal((await consumeRateLimitLayers(layers, T0 + 2, store)).exceeded, true);
			});

			it('allows the next request once the oldest timestamp is 60s old', async () => {
				const store = createMemoryApiKeyRateLimitStore();
				const layers = layersFor(kind, 1);
				assert.equal((await consumeRateLimitLayers(layers, T0, store)).exceeded, false);
				assert.equal((await consumeRateLimitLayers(layers, T0 + API_KEY_RATE_WINDOW_MS, store)).exceeded, false);
			});

			it('does not reset at the UTC minute boundary', async () => {
				const store = createMemoryApiKeyRateLimitStore();
				const layers = layersFor(kind, 1);
				assert.equal((await consumeRateLimitLayers(layers, MINUTE_BOUNDARY_BEFORE, store)).exceeded, false);
				assert.equal((await consumeRateLimitLayers(layers, MINUTE_BOUNDARY_AFTER, store)).exceeded, true);
			});

			it('returns retry-after until a new consume can succeed', async () => {
				const store = createMemoryApiKeyRateLimitStore();
				const layers = layersFor(kind, 1);
				assert.equal((await consumeRateLimitLayers(layers, T0, store)).exceeded, false);
				const exceeded = await consumeRateLimitLayers(layers, T0 + 1_000, store);
				assert.equal(exceeded.exceeded, true);
				assert.equal(exceeded.retryAfterSeconds, 60);
				const retryAt = T0 + 1_000 + exceeded.retryAfterSeconds * 1000;
				assert.equal((await consumeRateLimitLayers(layers, retryAt, store)).exceeded, false);
			});
		});
	}
});
