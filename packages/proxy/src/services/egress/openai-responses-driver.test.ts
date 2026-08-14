import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyResponsesUsage,
	isResponsesTerminalEventType,
	processResponsesDataLine,
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
