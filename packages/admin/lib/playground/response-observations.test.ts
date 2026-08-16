import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { observePlaygroundResponse, requestDeclaresTools } from './response-observations';

function sse(events: unknown[]): string {
	return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

function anthropicSse(frames: Array<{ event: string; data: unknown }>): string {
	return frames.map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`).join('');
}

function ids(raw: string, protocol: 'openai' | 'anthropic' | 'gemini', contentType: string, requestBodyText = '{}') {
	return observePlaygroundResponse({ raw, protocol, contentType, requestBodyText }).map((tag) => tag.id);
}

function tag(
	raw: string,
	protocol: 'openai' | 'anthropic' | 'gemini',
	contentType: string,
	requestBodyText = '{}',
) {
	return observePlaygroundResponse({ raw, protocol, contentType, requestBodyText });
}

const TOOLS_BODY = JSON.stringify({
	tools: [{ type: 'function', name: 'write_note' }],
});

describe('requestDeclaresTools', () => {
	it('detects tools arrays and ignores Hello bodies', () => {
		assert.equal(requestDeclaresTools(TOOLS_BODY), true);
		assert.equal(requestDeclaresTools('{"messages":[{"role":"user","content":"Hello"}]}'), false);
		assert.equal(requestDeclaresTools('{"tools":[]}'), false);
		assert.equal(
			requestDeclaresTools('{"tools":[{"functionDeclarations":[{"name":"write_note"}]}]}'),
			true,
		);
	});
});

describe('observePlaygroundResponse', () => {
	it('returns no tags for empty raw or dashscope', () => {
		assert.deepEqual(
			observePlaygroundResponse({
				raw: '',
				protocol: 'openai',
				contentType: 'text/event-stream',
				requestBodyText: TOOLS_BODY,
			}),
			[],
		);
		assert.deepEqual(
			observePlaygroundResponse({
				raw: sse([{ choices: [{ delta: { content: 'hi' } }] }]),
				protocol: 'dashscope',
				contentType: 'text/event-stream',
				requestBodyText: '{}',
			}),
			[],
		);
	});

	it('Chat SSE: body deltas, stop, and no no_tool without declared tools', () => {
		const raw = sse([
			{ choices: [{ delta: { content: 'Hello' } }] },
			{ choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] },
		]);
		const observed = tag(raw, 'openai', 'text/event-stream');
		assert.deepEqual(
			observed.map((t) => t.id),
			['shape_sse', 'body', 'finish'],
		);
		assert.equal(observed.find((t) => t.id === 'body')?.count, 2);
		assert.equal(observed.find((t) => t.id === 'finish')?.finishReason, 'stop');
		assert.equal(observed.find((t) => t.id === 'finish')?.tone, 'muted');
	});

	it('Chat SSE: incremental tool args and no_tool only when request declared tools', () => {
		const incremental = sse([
			{ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'write_note', arguments: '{"t' } }] } }] },
			{ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'itle":"' } }] } }] },
			{
				choices: [
					{
						delta: { tool_calls: [{ index: 0, function: { arguments: 'n"}' } }] },
						finish_reason: 'tool_calls',
					},
				],
			},
		]);
		assert.ok(ids(incremental, 'openai', 'text/event-stream').includes('tool_incremental'));

		const hello = sse([{ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }]);
		assert.equal(ids(hello, 'openai', 'text/event-stream').includes('no_tool'), false);
		assert.ok(ids(hello, 'openai', 'text/event-stream', TOOLS_BODY).includes('no_tool'));
	});

	it('Chat JSON: tool called without incremental/bulk, plus reasoning', () => {
		const raw = JSON.stringify({
			choices: [
				{
					finish_reason: 'stop',
					message: {
						content: 'done',
						reasoning_content: 'think',
						tool_calls: [{ type: 'function', function: { name: 'write_note', arguments: '{}' } }],
					},
				},
			],
		});
		const observedIds = ids(raw, 'openai', 'application/json');
		assert.deepEqual(observedIds, ['shape_json', 'body', 'reasoning', 'tool', 'finish']);
	});

	it('Responses SSE: reuses incremental verdict and body delta count', () => {
		const raw = sse([
			{ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', name: 'write_note' } },
			{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"title":"' },
			{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: 'note","content":"' },
			{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: 'pieces."}' },
			{
				type: 'response.function_call_arguments.done',
				item_id: 'fc_1',
				arguments: '{"title":"note","content":"pieces."}',
			},
		]);
		assert.ok(ids(raw, 'openai', 'text/event-stream').includes('tool_incremental'));
		assert.ok(ids(raw, 'openai', 'text/event-stream').includes('empty_body'));
	});

	it('Responses JSON: function_call is tool, Hello without tools omits no_tool', () => {
		const withTool = JSON.stringify({
			output: [{ type: 'function_call', name: 'write_note', arguments: '{"title":"n"}' }],
			status: 'completed',
		});
		assert.ok(ids(withTool, 'openai', 'application/json').includes('tool'));

		const hello = JSON.stringify({
			output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }],
			status: 'completed',
		});
		assert.equal(ids(hello, 'openai', 'application/json').includes('no_tool'), false);
		assert.ok(ids(hello, 'openai', 'application/json', TOOLS_BODY).includes('no_tool'));
	});

	it('Anthropic SSE: text deltas, thinking, incremental tool json, stop_reason', () => {
		const raw = anthropicSse([
			{
				event: 'content_block_delta',
				data: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
			},
			{
				event: 'content_block_start',
				data: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'write_note' } },
			},
			{
				event: 'content_block_delta',
				data: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"a":' } },
			},
			{
				event: 'content_block_delta',
				data: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '1}' } },
			},
			{
				event: 'message_delta',
				data: { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
			},
		]);
		const observed = tag(raw, 'anthropic', 'text/event-stream');
		const observedIds = observed.map((t) => t.id);
		assert.ok(observedIds.includes('shape_sse'));
		assert.ok(observedIds.includes('reasoning'));
		assert.ok(observedIds.includes('tool_incremental'));
		assert.equal(observed.find((t) => t.id === 'finish')?.finishReason, 'tool_use');
	});

	it('Anthropic JSON: tool_use and MAX_TOKENS warning', () => {
		const raw = JSON.stringify({
			stop_reason: 'max_tokens',
			content: [
				{ type: 'thinking', thinking: 'plan' },
				{ type: 'tool_use', name: 'write_note', input: { title: 'n' } },
			],
		});
		const observed = tag(raw, 'anthropic', 'application/json');
		assert.ok(observed.map((t) => t.id).includes('tool'));
		assert.ok(observed.map((t) => t.id).includes('reasoning'));
		const finish = observed.find((t) => t.id === 'finish');
		assert.equal(finish?.finishReason, 'max_tokens');
		assert.equal(finish?.tone, 'warning');
	});

	it('Gemini SSE: body chunks, thought part, bulk functionCall, STOP', () => {
		const raw = [
			{
				candidates: [
					{
						content: { parts: [{ text: 'think', thought: true }, { text: 'Hi' }] },
					},
				],
			},
			{
				candidates: [
					{
						finishReason: 'STOP',
						content: {
							parts: [{ functionCall: { name: 'write_note', args: { title: 'n', content: 'all at once' } } }],
						},
					},
				],
			},
		]
			.map((event) => `data: ${JSON.stringify(event)}\n\n`)
			.join('');
		const observed = tag(raw, 'gemini', 'text/event-stream');
		const observedIds = observed.map((t) => t.id);
		assert.ok(observedIds.includes('shape_sse'));
		assert.ok(observedIds.includes('body'));
		assert.ok(observedIds.includes('reasoning'));
		assert.ok(observedIds.includes('tool_bulk'));
		assert.equal(observed.find((t) => t.id === 'finish')?.finishReason, 'STOP');
	});

	it('Gemini JSON: MAX_TOKENS warning and tool without stream verdict', () => {
		const raw = JSON.stringify({
			candidates: [
				{
					finishReason: 'MAX_TOKENS',
					content: {
						parts: [{ functionCall: { name: 'write_note', args: { title: 'n' } } }],
					},
				},
			],
		});
		const observed = tag(raw, 'gemini', 'application/json');
		assert.ok(observed.map((t) => t.id).includes('tool'));
		const finish = observed.find((t) => t.id === 'finish');
		assert.equal(finish?.finishReason, 'MAX_TOKENS');
		assert.equal(finish?.tone, 'warning');
	});
});
