import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyStreamIdleTimeout,
	createSseProgressScanner,
	createStreamIdleClock,
	nextStreamReadTimeoutMs,
	readWithIdleTimeout,
	STREAM_FIRST_CHUNK_TIMEOUT_MS,
	STREAM_IDLE_TIMEOUT_MESSAGE,
	STREAM_IDLE_TIMEOUT_MS,
	streamIdleTimeoutErrorFrame,
} from './stream-idle-timeout';

describe('readWithIdleTimeout', () => {
	it('exports 2min first-chunk and 90s between-chunk thresholds', () => {
		assert.equal(STREAM_FIRST_CHUNK_TIMEOUT_MS, 120_000);
		assert.equal(STREAM_IDLE_TIMEOUT_MS, 90_000);
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

	it('does not reset the budget on comment-only keep-alive chunks', async () => {
		const encoder = new TextEncoder();
		const clock = createStreamIdleClock({ firstChunkTimeoutMs: 100, idleTimeoutMs: 40 });
		assert.equal(clock.timeoutMs(), 100);
		await new Promise((resolve) => setTimeout(resolve, 30));
		clock.noteChunk(encoder.encode(': keep-alive\n\n'));
		const afterHeartbeat = clock.timeoutMs();
		assert.ok(afterHeartbeat < 100, `expected remaining budget to shrink, got ${afterHeartbeat}`);
		assert.ok(afterHeartbeat <= 80, `expected roughly 70ms left, got ${afterHeartbeat}`);
		// 真事件到达后切到空闲档并清零
		clock.noteChunk(encoder.encode('data: {"a":1}\n\n'));
		assert.equal(clock.timeoutMs(), 40);
	});

	it('resets the budget on every chunk of a data line split across reads', async () => {
		const encoder = new TextEncoder();
		const clock = createStreamIdleClock({ firstChunkTimeoutMs: 100, idleTimeoutMs: 40 });
		clock.timeoutMs();
		clock.noteChunk(encoder.encode('data: {"text":"第一段'));
		for (const part of ['小说内容，第二段', '小说内容', '"}\n\n']) {
			clock.timeoutMs();
			await new Promise((resolve) => setTimeout(resolve, 15));
			clock.noteChunk(encoder.encode(part));
			assert.equal(clock.timeoutMs(), 40);
		}
	});

	it('keeps shrinking the budget across consecutive heartbeats until it hits the floor', async () => {
		const encoder = new TextEncoder();
		const clock = createStreamIdleClock({ firstChunkTimeoutMs: 30, idleTimeoutMs: 30 });
		for (let i = 0; i < 4; i += 1) {
			clock.timeoutMs();
			await new Promise((resolve) => setTimeout(resolve, 12));
			clock.noteChunk(encoder.encode(': ping\n\n'));
		}
		assert.equal(clock.timeoutMs(), 1);
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

describe('createSseProgressScanner', () => {
	const encoder = new TextEncoder();

	it('ignores comments and blank lines', () => {
		const scanner = createSseProgressScanner();
		assert.equal(scanner.feed(encoder.encode(': keep-alive\n\n')), false);
		assert.equal(scanner.feed(encoder.encode('\r\n\r\n')), false);
		assert.equal(scanner.feed(new Uint8Array()), false);
	});

	it('counts data / event lines and bare JSON lines as progress', () => {
		assert.equal(createSseProgressScanner().feed(encoder.encode('data: {}\n\n')), true);
		assert.equal(createSseProgressScanner().feed(encoder.encode('event: ping\n')), true);
		assert.equal(createSseProgressScanner().feed(encoder.encode('{"a":1}')), true);
	});

	it('finds an event after a comment in the same chunk', () => {
		const scanner = createSseProgressScanner();
		assert.equal(scanner.feed(encoder.encode(': hi\n\ndata: 1\n\n')), true);
	});

	it('tracks line starts across chunk boundaries', () => {
		const scanner = createSseProgressScanner();
		assert.equal(scanner.feed(encoder.encode(': keep')), false);
		// 上一块未换行：这里的 "data:" 仍在注释行内部
		assert.equal(scanner.feed(encoder.encode(' data: still comment')), false);
		assert.equal(scanner.feed(encoder.encode('\n')), false);
		assert.equal(scanner.feed(encoder.encode('data: real\n')), true);
	});

	it('keeps counting progress while a long data line is split across chunks', () => {
		const scanner = createSseProgressScanner();
		assert.equal(scanner.feed(encoder.encode('data: {"text":"第一段')), true);
		assert.equal(scanner.feed(encoder.encode('小说内容，第二段')), true);
		assert.equal(scanner.feed(encoder.encode('小说内容"}\n\n')), true);
		assert.equal(scanner.feed(encoder.encode(': keep-alive\n\n')), false);
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

describe('streamIdleTimeoutErrorFrame', () => {
	it('openai-chat: data frame with error code, preceded by a newline', () => {
		const frame = streamIdleTimeoutErrorFrame('openai-chat');
		assert.ok(frame.startsWith('\ndata: '));
		assert.ok(frame.endsWith('\n\n'));
		const payload = JSON.parse(frame.trim().slice('data: '.length)) as {
			error: { message: string; type: string; code: string };
		};
		assert.equal(payload.error.message, STREAM_IDLE_TIMEOUT_MESSAGE);
		assert.equal(payload.error.code, 'stream_idle_timeout');
	});

	it('anthropic: event: error with api_error payload', () => {
		const frame = streamIdleTimeoutErrorFrame('anthropic');
		assert.ok(frame.startsWith('\nevent: error\ndata: '));
		const payload = JSON.parse(frame.trim().split('\n')[1].slice('data: '.length)) as {
			type: string;
			error: { type: string; message: string };
		};
		assert.equal(payload.type, 'error');
		assert.equal(payload.error.type, 'api_error');
		assert.equal(payload.error.message, STREAM_IDLE_TIMEOUT_MESSAGE);
	});

	it('gemini: data frame with 504 DEADLINE_EXCEEDED', () => {
		const frame = streamIdleTimeoutErrorFrame('gemini');
		const payload = JSON.parse(frame.trim().slice('data: '.length)) as {
			error: { code: number; status: string; message: string };
		};
		assert.equal(payload.error.code, 504);
		assert.equal(payload.error.status, 'DEADLINE_EXCEEDED');
		assert.equal(payload.error.message, STREAM_IDLE_TIMEOUT_MESSAGE);
	});
});
