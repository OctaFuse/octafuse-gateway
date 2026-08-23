import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { RouteResult } from '../model-router';
import {
	dispatchOpenAiRoute,
	hasOpenAiContentDelta,
	hasOpenAiReasoningDelta,
	normalizeInputTokensFromPrompt,
	transformStreamUsageForClient,
	usageFromProvider,
} from './openai-driver';

function openaiRoute(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: 't1',
		modelSurfaceId: 's1',
		routePoolId: 'p1',
		providerId: 'prov1',
		providerName: 'OpenAI',
		providerModelName: 'gpt-4o-mini',
		upstreamProtocol: 'openai',
		upstreamOperation: 'chat',
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
		...overrides,
	};
}

describe('usageFromProvider', () => {
	it('maps OpenAI prompt/completion and cache details', () => {
		const usage = usageFromProvider({
			prompt_tokens: 20,
			completion_tokens: 8,
			total_tokens: 28,
			prompt_tokens_details: { cached_tokens: 6, cache_creation_tokens: 2 },
			completion_tokens_details: { reasoning_tokens: 3 },
		});
		assert.equal(usage.input_tokens, 20);
		assert.equal(usage.output_tokens, 8);
		assert.equal(usage.cache_read_tokens, 6);
		assert.equal(usage.cache_write_tokens, 2);
		assert.equal(usage.reasoning_tokens, 3);
		assert.equal(usage.total_tokens, 28);
	});

	it('accepts input_tokens / output_tokens aliases', () => {
		const usage = usageFromProvider({
			input_tokens: 4,
			output_tokens: 2,
		});
		assert.equal(usage.input_tokens, 4);
		assert.equal(usage.output_tokens, 2);
		assert.equal(usage.total_tokens, 6);
	});
});

describe('normalizeInputTokensFromPrompt', () => {
	it('returns prompt when there is no cache', () => {
		assert.equal(
			normalizeInputTokensFromPrompt({
				promptTokens: 10,
				completionTokens: 2,
				cacheRead: 0,
				cacheWrite: 0,
			}),
			10
		);
	});

	it('adds cache when prompt is smaller than cache total', () => {
		assert.equal(
			normalizeInputTokensFromPrompt({
				promptTokens: 3,
				completionTokens: 1,
				cacheRead: 8,
				cacheWrite: 2,
			}),
			13
		);
	});

	it('uses total_tokens to pick the compatible pure-input prompt口径', () => {
		assert.equal(
			normalizeInputTokensFromPrompt({
				promptTokens: 10,
				completionTokens: 5,
				cacheRead: 4,
				cacheWrite: 0,
				totalTokens: 19,
			}),
			14
		);
	});

	it('defaults to OpenAI included-cache口径 when totals match', () => {
		assert.equal(
			normalizeInputTokensFromPrompt({
				promptTokens: 10,
				completionTokens: 5,
				cacheRead: 4,
				cacheWrite: 0,
				totalTokens: 15,
			}),
			10
		);
	});
});

describe('hasOpenAi*Delta', () => {
	it('detects content, tool calls, and reasoning', () => {
		assert.equal(hasOpenAiContentDelta({ choices: [{ delta: { content: 'hi' } }] }), true);
		assert.equal(hasOpenAiContentDelta({ choices: [{ delta: { tool_calls: [{}] } }] }), true);
		assert.equal(hasOpenAiContentDelta({ choices: [{ delta: { content: '' } }] }), false);
		assert.equal(hasOpenAiReasoningDelta({ choices: [{ delta: { reasoning_content: 'think' } }] }), true);
		assert.equal(hasOpenAiReasoningDelta({ choices: [{ delta: { thinking: 'x' } }] }), true);
		assert.equal(hasOpenAiReasoningDelta({ choices: [{ delta: { reasoning: 'y' } }] }), true);
		assert.equal(hasOpenAiReasoningDelta({ choices: [{ delta: { content: 'no' } }] }), false);
	});
});

describe('transformStreamUsageForClient', () => {
	it('strips usage from in-progress delta chunks', () => {
		const line = `data: ${JSON.stringify({
			choices: [{ delta: { content: 'a' }, finish_reason: null }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})}`;
		const out = transformStreamUsageForClient(line);
		assert.equal(JSON.parse(out.slice(6)).usage, undefined);
	});

	it('keeps usage on terminal finish_reason or empty choices', () => {
		const terminal = `data: ${JSON.stringify({
			choices: [{ finish_reason: 'stop' }],
			usage: { prompt_tokens: 2 },
		})}`;
		assert.equal(transformStreamUsageForClient(terminal), terminal);
		const empty = `data: ${JSON.stringify({
			choices: [],
			usage: { prompt_tokens: 2 },
		})}`;
		assert.equal(transformStreamUsageForClient(empty), empty);
	});

	it('leaves [DONE] and non-data lines unchanged', () => {
		assert.equal(transformStreamUsageForClient('data: [DONE]'), 'data: [DONE]');
		assert.equal(transformStreamUsageForClient('event: ping'), 'event: ping');
	});
});

describe('dispatchOpenAiRoute', () => {
	afterEach(() => {
		mock.reset();
	});

	it('parses non-stream JSON usage and message id', async () => {
		const body = JSON.stringify({
			id: 'chatcmpl-abc',
			usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
		});
		mock.method(globalThis, 'fetch', async () =>
			new Response(body, {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'x-request-id': 'req-openai-1',
				},
			})
		);

		const result = await dispatchOpenAiRoute(openaiRoute(), { messages: [] });
		assert.equal(result.upstreamRequestId, 'req-openai-1');
		const usage = await result.usagePromise;
		assert.equal(usage.input_tokens, 11);
		assert.equal(usage.output_tokens, 4);
		assert.equal(usage.upstreamMessageId, 'chatcmpl-abc');
		assert.equal(await result.response.text(), body);
	});

	it('parses SSE usage across chunk boundaries and strips mid-stream usage', async () => {
		const encoder = new TextEncoder();
		const delta = `data: ${JSON.stringify({
			id: 'chatcmpl-stream',
			choices: [{ delta: { content: 'hel' }, finish_reason: null }],
			usage: { prompt_tokens: 3, completion_tokens: 1 },
		})}\n`;
		const done = `data: ${JSON.stringify({
			id: 'chatcmpl-stream',
			choices: [{ finish_reason: 'stop' }],
			usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 },
		})}\n`;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const first = encoder.encode(delta);
				controller.enqueue(first.slice(0, 20));
				controller.enqueue(first.slice(20));
				controller.enqueue(encoder.encode(done));
				controller.close();
			},
		});
		mock.method(globalThis, 'fetch', async () =>
			new Response(stream, {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			})
		);

		const result = await dispatchOpenAiRoute(openaiRoute(), { stream: true });
		const forwarded = await result.response.text();
		assert.equal(JSON.parse(forwarded.split('\n')[0]!.slice(6)).usage, undefined);
		assert.equal(JSON.parse(forwarded.trim().split('\n').at(-1)!.slice(6)).usage.prompt_tokens, 9);
		const usage = await result.usagePromise;
		assert.equal(usage.input_tokens, 9);
		assert.equal(usage.output_tokens, 6);
		assert.equal(usage.upstreamMessageId, 'chatcmpl-stream');
	});

	it('returns empty usage on upstream error', async () => {
		mock.method(globalThis, 'fetch', async () =>
			new Response(JSON.stringify({ error: { message: 'overloaded' } }), {
				status: 429,
				headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-err' },
			})
		);
		const result = await dispatchOpenAiRoute(openaiRoute(), { messages: [] });
		assert.equal(result.response.status, 429);
		assert.equal(result.upstreamRequestId, 'req-err');
		const usage = await result.usagePromise;
		assert.equal(usage.input_tokens, 0);
		assert.equal(usage.raw_usage, null);
	});
});
