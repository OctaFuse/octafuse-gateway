import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeResponsesSseEvents } from './sse-event-summary';

function sse(events: unknown[]): string {
	return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

describe('summarizeResponsesSseEvents', () => {
	it('returns null for empty or Chat Completions SSE', () => {
		assert.equal(summarizeResponsesSseEvents(''), null);
		assert.equal(
			summarizeResponsesSseEvents(
				sse([{ choices: [{ delta: { content: 'hi' } }] }, { choices: [{ delta: { content: '!' } }] }]),
			),
			null,
		);
	});

	it('marks incremental when several short function_call_arguments.delta events arrive', () => {
		const summary = summarizeResponsesSseEvents(
			sse([
				{ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', name: 'write_note' } },
				{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"title":"' },
				{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: 'note","content":"' },
				{
					type: 'response.function_call_arguments.delta',
					item_id: 'fc_1',
					delta: 'Streaming tool arguments should arrive in pieces."}',
				},
				{
					type: 'response.function_call_arguments.done',
					item_id: 'fc_1',
					name: 'write_note',
					arguments:
						'{"title":"note","content":"Streaming tool arguments should arrive in pieces."}',
				},
			]),
		);
		assert.ok(summary);
		assert.equal(summary.verdict, 'incremental');
		assert.equal(summary.functionCallArgumentDeltaCount, 3);
		assert.equal(summary.functionCallArgumentsDone, true);
		assert.ok(summary.functionCallArgumentsDoneChars > 20);
		assert.equal(summary.outputTextDeltaCount, 0);
	});

	it('marks bulk when arguments arrive in one delta or only on done', () => {
		const oneShot = summarizeResponsesSseEvents(
			sse([
				{ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', name: 'write_note' } },
				{
					type: 'response.function_call_arguments.delta',
					item_id: 'fc_1',
					delta: '{"title":"note","content":"all at once"}',
				},
				{
					type: 'response.function_call_arguments.done',
					item_id: 'fc_1',
					name: 'write_note',
					arguments: '{"title":"note","content":"all at once"}',
				},
			]),
		);
		assert.equal(oneShot?.verdict, 'bulk');
		assert.equal(oneShot?.functionCallArgumentDeltaCount, 1);

		const doneOnly = summarizeResponsesSseEvents(
			sse([
				{
					type: 'response.output_item.done',
					item: {
						type: 'function_call',
						id: 'fc_2',
						name: 'write_note',
						arguments: '{"title":"note","content":"complete"}',
					},
				},
			]),
		);
		assert.equal(doneOnly?.verdict, 'bulk');
		assert.equal(doneOnly?.functionCallArgumentDeltaCount, 0);
		assert.ok((doneOnly?.functionCallArgumentsDoneChars ?? 0) > 0);
	});

	it('marks no_tool when only text deltas are present', () => {
		const summary = summarizeResponsesSseEvents(
			sse([
				{ type: 'response.output_text.delta', delta: 'Hello' },
				{ type: 'response.output_text.delta', delta: ' world' },
				{ type: 'response.completed', response: { status: 'completed' } },
			]),
		);
		assert.ok(summary);
		assert.equal(summary.verdict, 'no_tool');
		assert.equal(summary.outputTextDeltaCount, 2);
		assert.equal(summary.functionCallArgumentDeltaCount, 0);
	});
});
