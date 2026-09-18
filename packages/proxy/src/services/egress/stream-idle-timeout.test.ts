import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyStreamIdleTimeout,
	createStreamIdleClock,
	nextStreamReadTimeoutMs,
	readWithIdleTimeout,
	STREAM_FIRST_CHUNK_TIMEOUT_MS,
	STREAM_IDLE_TIMEOUT_MESSAGE,
	STREAM_IDLE_TIMEOUT_MS,
} from './stream-idle-timeout';

describe('readWithIdleTimeout', () => {
	it('exports 2min first-chunk and 30s between-chunk thresholds', () => {
		assert.equal(STREAM_FIRST_CHUNK_TIMEOUT_MS, 120_000);
		assert.equal(STREAM_IDLE_TIMEOUT_MS, 30_000);
	});

	it('uses the first-chunk budget until a non-empty chunk arrives', () => {
		assert.equal(nextStreamReadTimeoutMs(false), STREAM_FIRST_CHUNK_TIMEOUT_MS);
		assert.equal(nextStreamReadTimeoutMs(true), STREAM_IDLE_TIMEOUT_MS);
		assert.equal(nextStreamReadTimeoutMs(false, { firstChunkTimeoutMs: 80 }), 80);
		assert.equal(nextStreamReadTimeoutMs(true, { idleTimeoutMs: 20 }), 20);
	});

	it('switches from first-chunk to idle after the first non-empty chunk', () => {
		const clock = createStreamIdleClock({ firstChunkTimeoutMs: 80, idleTimeoutMs: 20 });
		assert.equal(clock.timeoutMs(), 80);
		clock.noteChunk(new Uint8Array());
		assert.equal(clock.timeoutMs(), 80);
		clock.noteChunk(new Uint8Array([1]));
		assert.equal(clock.timeoutMs(), 20);
	});

	it('returns the next chunk when the stream is live', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2]));
				controller.close();
			},
		});
		const reader = stream.getReader();
		const first = await readWithIdleTimeout(reader, 50);
		assert.equal(first.idleTimedOut, false);
		assert.equal(first.done, false);
		assert.deepEqual(Array.from(first.value ?? []), [1, 2]);
		const end = await readWithIdleTimeout(reader, 50);
		assert.equal(end.done, true);
		assert.equal(end.idleTimedOut, false);
	});

	it('times out when the upstream never yields a chunk', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start() {
				// never enqueue
			},
			cancel() {},
		});
		const reader = stream.getReader();
		const result = await readWithIdleTimeout(reader, 20);
		assert.equal(result.idleTimedOut, true);
		assert.equal(result.done, false);
		await reader.cancel();
	});

	it('treats idleTimeoutMs <= 0 as no timeout', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([9]));
				controller.close();
			},
		});
		const reader = stream.getReader();
		const result = await readWithIdleTimeout(reader, 0);
		assert.equal(result.idleTimedOut, false);
		assert.equal(result.done, false);
	});
});

describe('applyStreamIdleTimeout', () => {
	it('records stream_error unless the client already cancelled', () => {
		const usage = {};
		applyStreamIdleTimeout(usage);
		assert.equal(usage.stream_error, STREAM_IDLE_TIMEOUT_MESSAGE);

		const cancelled = { cancelled: true as const };
		applyStreamIdleTimeout(cancelled);
		assert.equal(cancelled.stream_error, undefined);
	});
});
