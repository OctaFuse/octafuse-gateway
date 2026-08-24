import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { RouteResult } from '../model-router';
import {
	dispatchAnthropicRoute,
	hasAnthropicContentDelta,
	hasAnthropicReasoningDelta,
	usageFromAnthropic,
} from './anthropic-driver';

function anthropicRoute(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: 't1',
		modelSurfaceId: 's1',
		routePoolId: 'p1',
		providerId: 'prov1',
		providerName: 'Anthropic',
		providerModelName: 'claude-sonnet-4-5',
		upstreamProtocol: 'anthropic',
		upstreamOperation: 'messages',
		adapter: 'passthrough',
		providerEndpoints: {
			anthropic: { base: 'https://api.anthropic.com' },
		},
		providerApiKey: 'sk-ant-test',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		...overrides,
	};
}

describe('usageFromAnthropic', () => {
	it('adds cache buckets onto net input_tokens', () => {
		const usage = usageFromAnthropic({
			input_tokens: 10,
			output_tokens: 4,
			cache_read_input_tokens: 6,
			cache_creation_input_tokens: 2,
		});
		assert.equal(usage.input_tokens, 18);
		assert.equal(usage.output_tokens, 4);
		assert.equal(usage.cache_read_tokens, 6);
		assert.equal(usage.cache_write_tokens, 2);
		assert.equal(usage.reasoning_tokens, 0);
		assert.equal(usage.total_tokens, 22);
	});
});

describe('hasAnthropic*Delta', () => {
	it('detects thinking and text deltas', () => {
		assert.equal(
			hasAnthropicReasoningDelta({
				type: 'content_block_delta',
				delta: { type: 'thinking_delta', thinking: 'hmm' },
			}),
			true
		);
		assert.equal(
			hasAnthropicReasoningDelta({
				type: 'content_block_delta',
				delta: { type: 'text_delta', thinking: 'hmm' },
			}),
			false
		);
		assert.equal(
			hasAnthropicContentDelta({
				type: 'content_block_delta',
				delta: { type: 'text_delta', text: 'hi' },
			}),
			true
		);
		assert.equal(
			hasAnthropicContentDelta({
				type: 'message_delta',
				delta: { partial_json: '{"a":1}' },
			}),
			true
		);
		assert.equal(hasAnthropicContentDelta({ type: 'message_start' }), false);
	});
});

describe('dispatchAnthropicRoute', () => {
	afterEach(() => {
		mock.reset();
	});

	it('parses non-stream JSON usage and message id', async () => {
		const body = JSON.stringify({
			id: 'msg_abc',
			usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 },
		});
		mock.method(globalThis, 'fetch', async () =>
			new Response(body, {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'request-id': 'req-ant-1',
				},
			})
		);

		const result = await dispatchAnthropicRoute(anthropicRoute(), { messages: [] });
		assert.equal(result.upstreamRequestId, 'req-ant-1');
		const usage = await result.usagePromise;
		assert.equal(usage.input_tokens, 9);
		assert.equal(usage.output_tokens, 3);
		assert.equal(usage.cache_read_tokens, 2);
		assert.equal(usage.upstreamMessageId, 'msg_abc');
	});

	it('parses SSE usage across chunk boundaries', async () => {
		const encoder = new TextEncoder();
		const start = `data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_stream' } })}\n`;
		const delta = `data: ${JSON.stringify({
			type: 'content_block_delta',
			delta: { type: 'text_delta', text: 'hi' },
		})}\n`;
		const usageLine = `data: ${JSON.stringify({
			type: 'message_delta',
			usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 1 },
		})}\n`;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const first = encoder.encode(start + delta);
				controller.enqueue(first.slice(0, 18));
				controller.enqueue(first.slice(18));
				controller.enqueue(encoder.encode(usageLine));
				controller.close();
			},
		});
		mock.method(globalThis, 'fetch', async () =>
			new Response(stream, {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			})
		);

		const result = await dispatchAnthropicRoute(anthropicRoute(), { stream: true });
		const forwarded = await result.response.text();
		assert.match(forwarded, /msg_stream/);
		const usage = await result.usagePromise;
		assert.equal(usage.upstreamMessageId, 'msg_stream');
		assert.equal(usage.input_tokens, 6);
		assert.equal(usage.output_tokens, 2);
		assert.equal(usage.cache_write_tokens, 1);
	});

	it('returns empty usage on upstream error', async () => {
		mock.method(globalThis, 'fetch', async () =>
			new Response('overloaded', {
				status: 529,
				headers: { 'request-id': 'req-err' },
			})
		);
		const result = await dispatchAnthropicRoute(anthropicRoute(), { messages: [] });
		assert.equal(result.response.status, 529);
		assert.equal(result.upstreamRequestId, 'req-err');
		const usage = await result.usagePromise;
		assert.equal(usage.input_tokens, 0);
		assert.equal(usage.raw_usage, null);
	});
});
