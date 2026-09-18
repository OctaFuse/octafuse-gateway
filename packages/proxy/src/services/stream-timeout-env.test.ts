import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
	DEFAULT_STREAM_IDLE_TIMEOUT_MS,
	DEFAULT_USAGE_SAFETY_TIMEOUT_MS,
	parsePositiveTimeoutMs,
	resolveStreamTimeouts,
} from './stream-timeout-env';

const ENV_KEYS = [
	'STREAM_FIRST_CHUNK_TIMEOUT_MS',
	'STREAM_IDLE_TIMEOUT_MS',
	'USAGE_SAFETY_TIMEOUT_MS',
] as const;

function withProcessEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
	const saved: Record<string, string | undefined> = {};
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		fn();
	} finally {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	}
}

describe('parsePositiveTimeoutMs', () => {
	it('falls back for empty, zero, negative, and garbage', () => {
		assert.equal(parsePositiveTimeoutMs(undefined, 9), 9);
		assert.equal(parsePositiveTimeoutMs('', 9), 9);
		assert.equal(parsePositiveTimeoutMs('  ', 9), 9);
		assert.equal(parsePositiveTimeoutMs('0', 9), 9);
		assert.equal(parsePositiveTimeoutMs('-1', 9), 9);
		assert.equal(parsePositiveTimeoutMs('abc', 9), 9);
	});

	it('accepts positive integers and truncates numbers', () => {
		assert.equal(parsePositiveTimeoutMs('80000', 9), 80_000);
		assert.equal(parsePositiveTimeoutMs(' 180000 ', 9), 180_000);
		assert.equal(parsePositiveTimeoutMs(12.9, 9), 12);
	});
});

describe('resolveStreamTimeouts', () => {
	it('uses code defaults when unset', () => {
		withProcessEnv({}, () => {
			assert.deepEqual(resolveStreamTimeouts(), {
				firstChunkTimeoutMs: DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
				idleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
				usageSafetyTimeoutMs: DEFAULT_USAGE_SAFETY_TIMEOUT_MS,
			});
		});
	});

	it('reads process.env on Node', () => {
		withProcessEnv(
			{
				STREAM_FIRST_CHUNK_TIMEOUT_MS: '180000',
				STREAM_IDLE_TIMEOUT_MS: '80000',
				USAGE_SAFETY_TIMEOUT_MS: '900000',
			},
			() => {
				assert.deepEqual(resolveStreamTimeouts(), {
					firstChunkTimeoutMs: 180_000,
					idleTimeoutMs: 80_000,
					usageSafetyTimeoutMs: 900_000,
				});
			}
		);
	});

	it('prefers Worker bindings over process.env', () => {
		withProcessEnv({ STREAM_IDLE_TIMEOUT_MS: '80000' }, () => {
			assert.deepEqual(
				resolveStreamTimeouts({ STREAM_IDLE_TIMEOUT_MS: '45000' }),
				{
					firstChunkTimeoutMs: DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
					idleTimeoutMs: 45_000,
					usageSafetyTimeoutMs: DEFAULT_USAGE_SAFETY_TIMEOUT_MS,
				}
			);
		});
	});
});
