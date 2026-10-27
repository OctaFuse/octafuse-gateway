import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS,
	parseFirstEventTimeoutMs,
	parseFirstEventTimeoutRouteGroups,
	peekFirstStreamChunk,
	peekResponseFirstEvent,
	resolveFirstEventTimeoutMs,
} from './stream-first-event-timeout';

describe('parseFirstEventTimeoutMs', () => {
	it('uses the default when the key is unset, empty or illegal', () => {
		assert.equal(parseFirstEventTimeoutMs(null), DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS);
		assert.equal(parseFirstEventTimeoutMs(undefined), DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS);
		assert.equal(parseFirstEventTimeoutMs(''), DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS);
		assert.equal(parseFirstEventTimeoutMs('  '), DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS);
		assert.equal(parseFirstEventTimeoutMs('abc'), DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS);
	});

	it('treats zero or a negative value as disabled', () => {
		assert.equal(parseFirstEventTimeoutMs('0'), 0);
		assert.equal(parseFirstEventTimeoutMs('-1'), 0);
	});

	it('parses a positive integer', () => {
		assert.equal(parseFirstEventTimeoutMs('30000'), 30_000);
	});
});

describe('parseFirstEventTimeoutRouteGroups', () => {
	it('defaults to every route group', () => {
		assert.equal(parseFirstEventTimeoutRouteGroups(null), '*');
		assert.equal(parseFirstEventTimeoutRouteGroups(''), '*');
		assert.equal(parseFirstEventTimeoutRouteGroups(' , '), '*');
	});

	it('accepts all / * and comma lists', () => {
		assert.equal(parseFirstEventTimeoutRouteGroups('*'), '*');
		assert.equal(parseFirstEventTimeoutRouteGroups('ALL'), '*');
		assert.deepEqual(parseFirstEventTimeoutRouteGroups('default, vip'), ['default', 'vip']);
	});
});

describe('resolveFirstEventTimeoutMs', () => {
	it('stays off when timeout is 0', () => {
		assert.equal(resolveFirstEventTimeoutMs(0, '*', 'default'), 0);
	});

	it('applies only to listed groups unless *', () => {
		assert.equal(resolveFirstEventTimeoutMs(30_000, ['default'], 'default'), 30_000);
		assert.equal(resolveFirstEventTimeoutMs(30_000, ['default'], 'vip'), 0);
		assert.equal(resolveFirstEventTimeoutMs(30_000, '*', 'vip'), 30_000);
	});
});

describe('peekFirstStreamChunk', () => {
	it('prepends the first chunk so the rest of the stream is intact', async () => {
		const encoder = new TextEncoder();
		const upstream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('first'));
				controller.enqueue(encoder.encode('second'));
				controller.close();
			},
		});
		const peeked = await peekFirstStreamChunk(upstream, 50);
		assert.equal(peeked.timedOut, false);
		if (peeked.timedOut) return;
		assert.equal(await new Response(peeked.body).text(), 'firstsecond');
	});

	it('times out when the upstream never yields', async () => {
		const hung = new ReadableStream<Uint8Array>({
			start() {
				// never enqueue
			},
			cancel() {},
		});
		const peeked = await peekFirstStreamChunk(hung, 20);
		assert.equal(peeked.timedOut, true);
	});

	it('keeps waiting through comment keep-alives and still times out', async () => {
		const encoder = new TextEncoder();
		let timer: ReturnType<typeof setInterval> | undefined;
		const keepAliveOnly = new ReadableStream<Uint8Array>({
			start(controller) {
				timer = setInterval(() => controller.enqueue(encoder.encode(': keep-alive\n\n')), 5);
			},
			cancel() {
				if (timer) clearInterval(timer);
			},
		});
		const startedAt = Date.now();
		const peeked = await peekFirstStreamChunk(keepAliveOnly, 60);
		if (timer) clearInterval(timer);
		assert.equal(peeked.timedOut, true);
		assert.ok(Date.now() - startedAt >= 50);
	});

	it('passes once a real event follows keep-alives and replays everything in order', async () => {
		const encoder = new TextEncoder();
		const upstream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(': keep-alive\n\n'));
				controller.enqueue(encoder.encode(': keep-alive\n\n'));
				controller.enqueue(encoder.encode('data: {"x":1}\n\n'));
				controller.enqueue(encoder.encode('data: [DONE]\n\n'));
				controller.close();
			},
		});
		const peeked = await peekFirstStreamChunk(upstream, 50);
		assert.equal(peeked.timedOut, false);
		if (peeked.timedOut) return;
		assert.equal(
			await new Response(peeked.body).text(),
			': keep-alive\n\n: keep-alive\n\ndata: {"x":1}\n\ndata: [DONE]\n\n'
		);
	});

	it('does not treat a comment split across chunks as an event', async () => {
		const encoder = new TextEncoder();
		const upstream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(': keep'));
				controller.enqueue(encoder.encode('-alive\n\n'));
				controller.close();
			},
		});
		const peeked = await peekFirstStreamChunk(upstream, 50);
		// 流在出现真事件前自然结束：原样放行，由下游处理
		assert.equal(peeked.timedOut, false);
		if (peeked.timedOut) return;
		assert.equal(await new Response(peeked.body).text(), ': keep-alive\n\n');
	});
});

describe('peekResponseFirstEvent', () => {
	it('returns 524 when the first chunk never arrives', async () => {
		const hung = new ReadableStream<Uint8Array>({
			start() {},
			cancel() {},
		});
		const peeked = await peekResponseFirstEvent(
			new Response(hung, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
			20,
			'protocol=test'
		);
		assert.equal(peeked.timedOut, true);
		assert.equal(peeked.response.status, 524);
		const body = JSON.parse(await peeked.response.text()) as { error: { type: string } };
		assert.equal(body.error.type, 'first_event_timeout');
	});

	it('leaves a live stream intact when timeout is disabled', async () => {
		const peeked = await peekResponseFirstEvent(
			new Response('ok', { status: 200 }),
			0,
			'protocol=test'
		);
		assert.equal(peeked.timedOut, false);
		assert.equal(await peeked.response.text(), 'ok');
	});
});
