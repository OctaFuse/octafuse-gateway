import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { RouteResult } from '../model-router';
import {
	applyResponsesUsage,
	dispatchOpenAiResponsesRoute,
	ensureResponsesSequenceNumber,
	isResponsesTerminalEventType,
	processResponsesDataLine,
	syntheticMissingTerminalEvent,
	usageFromResponses,
} from './openai-responses-driver';
import type { UsageFromStream } from '../proxy';

function emptyUsage(): UsageFromStream {
	return {
		input_tokens: 0,
		output_tokens: 0,
		cache_read_tokens: 0,
		cache_write_tokens: 0,
		reasoning_tokens: 0,
		total_tokens: 0,
		raw_usage: null,
	};
}

describe('openai-responses-driver usage', () => {
	it('parses Responses usage with cached and reasoning tokens', () => {
		const usage = usageFromResponses({
			input_tokens: 20,
			output_tokens: 30,
			total_tokens: 50,
			input_tokens_details: { cached_tokens: 4 },
			output_tokens_details: { reasoning_tokens: 12 },
		});
		assert.equal(usage.input_tokens, 20);
		assert.equal(usage.output_tokens, 30);
		assert.equal(usage.cache_read_tokens, 4);
		assert.equal(usage.reasoning_tokens, 12);
		assert.equal(usage.total_tokens, 50);
	});

	it('accepts chat-style prompt/completion aliases', () => {
		const usage = usageFromResponses({
			prompt_tokens: 8,
			completion_tokens: 3,
			prompt_tokens_details: { cached_tokens: 2 },
			completion_tokens_details: { reasoning_tokens: 1 },
		});
		assert.equal(usage.input_tokens, 8);
		assert.equal(usage.output_tokens, 3);
		assert.equal(usage.cache_read_tokens, 2);
		assert.equal(usage.reasoning_tokens, 1);
		assert.equal(usage.total_tokens, 11);
	});
});

describe('openai-responses-driver SSE lines', () => {
	it('reads usage and response id from response.completed', () => {
		const usage = emptyUsage();
		const terminal = processResponsesDataLine(
			`data: ${JSON.stringify({
				type: 'response.completed',
				response: {
					id: 'resp_abc',
					usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
				},
			})}`,
			usage,
		);
		assert.equal(terminal, true);
		assert.equal(usage.upstreamMessageId, 'resp_abc');
		assert.equal(usage.input_tokens, 11);
		assert.equal(usage.output_tokens, 7);
	});

	it('marks stream_error on response.failed', () => {
		const usage = emptyUsage();
		const terminal = processResponsesDataLine(
			`data: ${JSON.stringify({
				type: 'response.failed',
				error: { message: 'model overloaded' },
			})}`,
			usage,
		);
		assert.equal(terminal, true);
		assert.equal(usage.stream_error, 'model overloaded');
	});

	it('does not treat output deltas as terminal', () => {
		assert.equal(isResponsesTerminalEventType('response.output_text.delta'), false);
		const usage = emptyUsage();
		assert.equal(
			processResponsesDataLine(
				`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hi' })}`,
				usage,
			),
			false,
		);
	});

	it('overwrites usage snapshots', () => {
		const usage = emptyUsage();
		applyResponsesUsage(usage, { input_tokens: 1, output_tokens: 1, total_tokens: 2 });
		applyResponsesUsage(usage, { input_tokens: 9, output_tokens: 4, total_tokens: 13 });
		assert.equal(usage.input_tokens, 9);
		assert.equal(usage.output_tokens, 4);
		assert.equal(usage.total_tokens, 13);
	});
});

describe('ensureResponsesSequenceNumber', () => {
	it('injects an incrementing sequence_number when the event is missing it', () => {
		const seq = { value: 0 };
		const a = ensureResponsesSequenceNumber(
			`data: ${JSON.stringify({ type: 'response.created' })}`,
			seq,
		);
		const b = ensureResponsesSequenceNumber(
			`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hi' })}`,
			seq,
		);
		assert.equal(JSON.parse(a.slice(6)).sequence_number, 0);
		assert.equal(JSON.parse(b.slice(6)).sequence_number, 1);
		assert.equal(seq.value, 2);
	});

	it('starts from 0 and preserves upstream sequence numbers without overwriting', () => {
		const seq = { value: 0 };
		// 上游已带 sequence_number=7，应原样保留且计数器越过去。
		const out = ensureResponsesSequenceNumber(
			`data: ${JSON.stringify({ type: 'response.output_text.done', sequence_number: 7 })}`,
			seq,
		);
		assert.equal(out, `data: ${JSON.stringify({ type: 'response.output_text.done', sequence_number: 7 })}`);
		assert.equal(JSON.parse(out.slice(6)).sequence_number, 7);
		assert.equal(seq.value, 8);

		// 下一个缺失事件应接着 8 注入，避免与上游重复。
		const next = ensureResponsesSequenceNumber(`data: {"type":"response.completed"}`, seq);
		assert.equal(JSON.parse(next.slice(6)).sequence_number, 8);
	});

	it('leaves non-data lines, [DONE], and non-object JSON untouched', () => {
		const seq = { value: 0 };
		assert.equal(ensureResponsesSequenceNumber('event: response.created', seq), 'event: response.created');
		assert.equal(ensureResponsesSequenceNumber('data: [DONE]', seq), 'data: [DONE]');
		assert.equal(ensureResponsesSequenceNumber('data: "just a string"', seq), 'data: "just a string"');
		assert.equal(ensureResponsesSequenceNumber('data: [1,2]', seq), 'data: [1,2]');
		assert.equal(seq.value, 0);
	});

	it('keeps the data: prefix and round-trips unknown fields', () => {
		const seq = { value: 0 };
		const input = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'OK', item_id: 'i_1' })}`;
		const out = ensureResponsesSequenceNumber(input, seq);
		const parsed = JSON.parse(out.slice(6));
		assert.equal(parsed.type, 'response.output_text.delta');
		assert.equal(parsed.delta, 'OK');
		assert.equal(parsed.item_id, 'i_1');
		assert.equal(parsed.sequence_number, 0);
	});

	it('synthetic terminal error event carries a sequence_number', () => {
		// 场景：上游已发 3 个事件（0/1/2），随后静默 EOF，网关补发 error 事件。
		const seq = { value: 0 };
		ensureResponsesSequenceNumber(`data: {"type":"response.created"}`, seq);
		ensureResponsesSequenceNumber(`data: {"type":"response.in_progress"}`, seq);
		ensureResponsesSequenceNumber(`data: {"type":"response.output_item.added"}`, seq);
		assert.equal(seq.value, 3);
		const out = syntheticMissingTerminalEvent(seq);
		const dataLine = out.split('\n').find((l) => l.startsWith('data: '));
		assert.ok(dataLine, 'synthetic event contains a data: line');
		const parsed = JSON.parse(dataLine!.slice(6));
		assert.equal(parsed.type, 'error');
		assert.equal(parsed.sequence_number, 3);
		assert.equal(seq.value, 4);
	});
});

describe('dispatchOpenAiResponsesRoute', () => {
	afterEach(() => {
		mock.reset();
	});

	function responsesRoute(): RouteResult {
		return {
			targetId: 't1',
			modelSurfaceId: 's1',
			routePoolId: 'p1',
			providerId: 'prov1',
			providerName: 'OpenAI',
			providerModelName: 'gpt-5',
			upstreamProtocol: 'openai',
			upstreamOperation: 'responses',
			adapter: 'passthrough',
			providerEndpoints: {
				openai: { base: 'https://api.openai.com/v1' },
			},
			providerApiKey: 'sk-test',
			priceOverrideRaw: null,
			routeMeteredProfileJson: null,
			routeChargedProfileJson: null,
			customParams: null,
			routeGroup: 'default',
			routePriority: 0,
			routeWeight: 1,
		};
	}

	it('returns 524 when the first SSE event exceeds firstEventTimeoutMs', async () => {
		const hung = new ReadableStream<Uint8Array>({
			start() {},
			cancel() {},
		});
		mock.method(globalThis, 'fetch', async () =>
			new Response(hung, {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			})
		);
		const result = await dispatchOpenAiResponsesRoute(
			responsesRoute(),
			{ stream: true },
			undefined,
			null,
			undefined,
			{ firstEventTimeoutMs: 20 }
		);
		assert.equal(result.response.status, 524);
		const usage = await result.usagePromise;
		assert.equal(usage.input_tokens, 0);
	});
});
