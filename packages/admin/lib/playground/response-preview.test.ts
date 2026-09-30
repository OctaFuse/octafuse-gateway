import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePreviewEvents, previewPlaygroundResponse, readPlaygroundTextStream } from './response-preview';

const sse = (...events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
const preview = (text: string, protocol: 'openai' | 'anthropic' | 'gemini' = 'openai') =>
	previewPlaygroundResponse(text, protocol, 'text/event-stream');

describe('Quick test response projection', () => {
	it('keeps incomplete data out of the preview and joins multiline SSE data', () => {
		const frame = 'event: chunk\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"你好"}}]}\r\n\r\n';
		assert.equal(preview(frame.slice(0, -4)).body, '');
		assert.equal(preview(frame).body, '你好');
		assert.equal(preview(frame + 'data: {"choices":[').body, '你好');
		assert.equal(parsePreviewEvents(': heartbeat\n\ndata: [DONE]\n\ndata: bad\n\n').length, 0);
	});
	it('separates Chat reasoning, text, parallel tool calls, finish reason and usage', () => {
		const raw = sse(
			{
				choices: [
					{
						delta: {
							reasoning_content: 'Plan',
							tool_calls: [
								{ index: 0, id: 'a', function: { name: 'weather', arguments: '{"city":' } },
								{ index: 1, id: 'b', function: { name: 'clock', arguments: '{}' } },
							],
						},
					},
				],
			},
			{
				choices: [
					{
						delta: { content: 'Calling', tool_calls: [{ index: 0, function: { arguments: '"北京"}' } }] },
						finish_reason: 'tool_calls',
					},
				],
				usage: { prompt_tokens: 12, completion_tokens: 7 },
			}
		);
		const out = preview(raw);
		assert.equal(out.body, 'Calling');
		assert.equal(out.reasoning, 'Plan');
		assert.deepEqual(
			out.tools.map((t) => [t.id, t.name, t.arguments]),
			[
				['a', 'weather', '{"city":"北京"}'],
				['b', 'clock', '{}'],
			]
		);
		assert.equal(out.finishReason, 'tool_calls');
		assert.equal(out.usage.prompt_tokens, 12);
	});
	it('reconciles Responses deltas, done events and final snapshots without duplication', () => {
		const item = { id: 'fc_1', call_id: 'call_1', type: 'function_call', name: 'weather', arguments: '' };
		let raw = sse(
			{ type: 'response.output_item.added', output_index: 1, item },
			{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"city":' }
		);
		assert.equal(preview(raw).tools[0].arguments, '{"city":');
		raw += sse(
			{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"Paris"}' },
			{ type: 'response.function_call_arguments.done', item_id: 'fc_1', arguments: '{"city":"Paris"}' },
			{ type: 'response.reasoning_summary_text.delta', delta: 'Think' },
			{ type: 'response.output_text.delta', delta: 'Done' },
			{
				type: 'response.completed',
				response: {
					status: 'completed',
					output: [{ ...item, arguments: '{"city":"Paris"}' }],
					usage: { total_tokens: 20 },
				},
			}
		);
		const out = preview(raw);
		assert.equal(out.tools.length, 1);
		assert.equal(out.tools[0].arguments, '{"city":"Paris"}');
		assert.equal(out.reasoning, 'Think');
		assert.equal(out.body, 'Done');
		assert.equal(out.usage.total_tokens, 20);
	});
	it('renders Anthropic thinking and tool JSON deltas with cumulative usage', () => {
		const out = preview(
			sse(
				{ type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } },
				{ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan' } },
				{
					type: 'content_block_start',
					index: 1,
					content_block: { type: 'tool_use', id: 'tool_1', name: 'weather', input: {} },
				},
				{
					type: 'content_block_delta',
					index: 1,
					delta: { type: 'input_json_delta', partial_json: '{"city":' },
				},
				{
					type: 'content_block_delta',
					index: 1,
					delta: { type: 'input_json_delta', partial_json: '"Tokyo"}' },
				},
				{ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }
			),
			'anthropic'
		);
		assert.equal(out.reasoning, 'Plan');
		assert.equal(out.body, '');
		assert.equal(out.tools[0].arguments, '{"city":"Tokyo"}');
		assert.deepEqual(out.usage, { input_tokens: 12, output_tokens: 9 });
	});
	it('renders Gemini thoughts, text, function calls and streamed JSON-path arguments', () => {
		const event = (parts: unknown[]) => ({ candidates: [{ content: { parts } }] });
		const out = preview(
			sse(
				event([{ text: 'Plan', thought: true }, { text: 'Hi' }]),
				event([{ functionCall: { id: 'call1', name: 'write_note', willContinue: true } }]),
				event([{ functionCall: { partialArgs: [{ jsonPath: '$.text', stringValue: 'Hello' }] } }]),
				event([{ functionCall: { partialArgs: [{ jsonPath: '$.text', stringValue: ' world' }] } }]),
				{ candidates: [{ finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 9 } }
			),
			'gemini'
		);
		assert.equal(out.reasoning, 'Plan');
		assert.equal(out.body, 'Hi');
		assert.equal(out.tools.length, 1);
		assert.equal(out.tools[0].name, 'write_note');
		assert.deepEqual(JSON.parse(out.tools[0].arguments), { '$.text': 'Hello world' });
		assert.equal(out.usage.totalTokenCount, 9);
	});
	it('handles Anthropic event headers and initial block content before deltas', () => {
		const raw =
			'event: content_block_start\ndata: {"content_block":{"type":"text","text":"Hello"}}\n\n' +
			sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } });
		assert.equal(preview(raw, 'anthropic').body, 'Hello world');
	});
	it('shows stream errors even when HTTP was successful', () => {
		const out = preview(sse({ type: 'error', error: { message: 'overloaded' } }));
		assert.match(out.error, /overloaded/);
		assert.equal(out.body, '');
	});
	it('handles nonstream tool-only responses for all protocol families', () => {
		const cases = [
			[
				'openai',
				{ choices: [{ message: { tool_calls: [{ id: 'a', function: { name: 'f', arguments: '{}' } }] } }] },
			],
			['openai', { output: [{ id: 'a', type: 'function_call', name: 'f', arguments: '{}' }] }],
			['anthropic', { content: [{ id: 'a', type: 'tool_use', name: 'f', input: {} }] }],
			['gemini', { candidates: [{ content: { parts: [{ functionCall: { name: 'f', args: {} } }] } }] }],
		] as const;
		for (const [protocol, value] of cases) {
			const out = previewPlaygroundResponse(JSON.stringify(value), protocol, 'application/json', true);
			assert.equal(out.streaming, false);
			assert.equal(out.tools[0].name, 'f');
			assert.equal(out.tools[0].arguments, '{}');
		}
	});
	it('publishes raw chunks and complete content before EOF without corrupting split UTF-8', async () => {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				controller = c;
			},
		});
		const snapshots: string[] = [];
		let resolveFirst!: () => void;
		const first = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		const reading = readPlaygroundTextStream(new Response(stream), (text) => {
			snapshots.push(text);
			resolveFirst();
		});
		const raw = sse({ choices: [{ delta: { content: '你好' } }] });
		const bytes = new TextEncoder().encode(raw);
		const split = bytes.findIndex((b) => b > 127) + 1;
		controller.enqueue(bytes.slice(0, split));
		await first;
		assert.ok(snapshots.length > 0);
		assert.doesNotMatch(snapshots[0], /�/);
		controller.enqueue(bytes.slice(split));
		controller.close();
		assert.equal(await reading, raw);
		assert.equal(preview(snapshots.at(-1)!).body, '你好');
	});
	it('retains published data on interruption and releases the reader lock', async () => {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				controller = c;
			},
		});
		let latest = '';
		let published!: () => void;
		const first = new Promise<void>((resolve) => {
			published = resolve;
		});
		const reading = readPlaygroundTextStream(new Response(stream), (text) => {
			latest = text;
			published();
		});
		controller.enqueue(new TextEncoder().encode(sse({ choices: [{ delta: { content: 'Partial' } }] })));
		await first;
		controller.error(new DOMException('Stopped', 'AbortError'));
		await assert.rejects(reading, { name: 'AbortError' });
		assert.equal(preview(latest).body, 'Partial');
		assert.equal(stream.locked, false);
	});
});
