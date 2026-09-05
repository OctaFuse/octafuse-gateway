import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	coerceRateLimitInput,
	consumeApiKeyRateWindow,
	consumeRateLimitLayers,
	createMemoryApiKeyRateLimitStore,
	currentRateWindowStartedAt,
	isRateLimitExceeded,
	keyRateLimitSubject,
	parseApiKeyRateLimit,
	rateLimitEquals,
	rateLimitRpmOf,
	rateLimitRetryAfterSeconds,
	resolveIngressHost,
	serializeApiKeyRateLimit,
	userRateLimitSubject,
} from './api-key-rate-limit.ts';

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

	it('aligns window start to the minute', () => {
		const t = Date.parse('2026-09-05T02:31:42.123Z');
		assert.equal(currentRateWindowStartedAt(t), '2026-09-05T02:31:00.000Z');
		assert.equal(rateLimitRetryAfterSeconds('2026-09-05T02:31:00.000Z', t), 18);
	});

	it('coerces PATCH rate_limit (omit / null / object)', () => {
		assert.deepEqual(coerceRateLimitInput(undefined), { ok: true, omit: true });
		assert.deepEqual(coerceRateLimitInput(null), { ok: true, value: null });
		assert.deepEqual(coerceRateLimitInput(''), { ok: true, value: null });
		assert.deepEqual(coerceRateLimitInput({}), { ok: true, value: null });
		assert.deepEqual(coerceRateLimitInput({ rpm: 60 }), { ok: true, value: { rpm: 60 } });
		assert.deepEqual(coerceRateLimitInput('{"rpm":60}'), { ok: true, value: { rpm: 60 } });
		assert.equal(coerceRateLimitInput({ rpm: -1 }).ok, false);
		assert.equal(coerceRateLimitInput({ rpd: 10 }).ok, false);
		assert.equal(coerceRateLimitInput(60).ok, false);
	});

	it('resolves ingress host from Host header, then URL', () => {
		assert.equal(resolveIngressHost('api.example.com', 'http://ignored.local/v1'), 'api.example.com');
		assert.equal(resolveIngressHost('  gateway.example.com:8787 ', ''), 'gateway.example.com:8787');
		assert.equal(resolveIngressHost(undefined, 'https://proxy.example.com:443/v1/models'), 'proxy.example.com');
		assert.equal(resolveIngressHost(null, 'not a url'), null);
	});

	it('counts in memory per key and resets when the window changes', async () => {
		const store = createMemoryApiKeyRateLimitStore();
		assert.equal(await consumeApiKeyRateWindow('k1', 'w1', store), 1);
		assert.equal(await consumeApiKeyRateWindow('k1', 'w1', store), 2);
		assert.equal(await consumeApiKeyRateWindow('k2', 'w1', store), 1);
		assert.equal(await consumeApiKeyRateWindow('k1', 'w2', store), 1);
	});

	it('prunes stale windows when over capacity', async () => {
		const store = createMemoryApiKeyRateLimitStore(2);
		assert.equal(await consumeApiKeyRateWindow('a', 'w1', store), 1);
		assert.equal(await consumeApiKeyRateWindow('b', 'w1', store), 1);
		assert.equal(await consumeApiKeyRateWindow('c', 'w2', store), 1);
		assert.equal(await consumeApiKeyRateWindow('a', 'w2', store), 1);
	});

	it('does not consume the user window when the key layer is already exceeded', async () => {
		const inner = createMemoryApiKeyRateLimitStore();
		const subjects: string[] = [];
		const store = {
			consume(subject: string, windowStartedAt: string) {
				subjects.push(subject);
				return inner.consume(subject, windowStartedAt);
			},
		};
		const keyId = 'key-1';
		const userId = 'user-1';
		const layers = [
			{ subject: keyRateLimitSubject(keyId), rpm: 1 },
			{ subject: userRateLimitSubject(userId), rpm: 100 },
		];
		assert.equal((await consumeRateLimitLayers(layers, 'w1', store)).exceeded, false);
		assert.equal((await consumeRateLimitLayers(layers, 'w1', store)).exceeded, true);
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
			'w1',
			store
		);
		const second = await consumeRateLimitLayers(
			[
				{ subject: keyRateLimitSubject('key-b'), rpm: null },
				{ subject: userSubject, rpm: 2 },
			],
			'w1',
			store
		);
		const third = await consumeRateLimitLayers(
			[
				{ subject: keyRateLimitSubject('key-a'), rpm: null },
				{ subject: userSubject, rpm: 2 },
			],
			'w1',
			store
		);
		assert.equal(first.exceeded, false);
		assert.equal(second.exceeded, false);
		assert.equal(third.exceeded, true);
	});
});
