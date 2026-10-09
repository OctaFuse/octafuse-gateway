import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeMessagesShapeForLog } from './request-log-messages-shape';

describe('summarizeMessagesShapeForLog', () => {
	it('groups field names by role and content part types without message text', () => {
		const secret = 'SECRET_CHAPTER_TEXT should never be logged';
		const shape = summarizeMessagesShapeForLog([
			{ role: 'user', content: secret },
			{
				role: 'assistant',
				content: [{ type: 'text', text: secret }],
				reasoning_content: secret,
				tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'editor', arguments: secret } }],
			},
			{ role: 'tool', content: secret, tool_call_id: 'call_1' },
		]);

		assert.deepEqual(shape, {
			user: ['content'],
			assistant: ['content', 'reasoning_content', 'tool_calls'],
			tool: ['content', 'tool_call_id'],
			content_types: { assistant: ['text'] },
		});
		assert.equal(JSON.stringify(shape).includes(secret), false);
		assert.equal(JSON.stringify(shape).includes('editor'), false);
	});

	it('uses item type when a responses input item has no role', () => {
		const shape = summarizeMessagesShapeForLog([
			{ type: 'function_call', name: 'editor', arguments: 'SECRET' },
			{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'SECRET' }] },
		]);
		assert.deepEqual(shape?.function_call, ['arguments', 'name', 'type']);
		assert.deepEqual(shape?.assistant, ['content', 'type']);
		assert.deepEqual(shape?.content_types, { assistant: ['output_text'] });
	});

	it('returns null for empty or non-array input', () => {
		assert.equal(summarizeMessagesShapeForLog(undefined), null);
		assert.equal(summarizeMessagesShapeForLog([]), null);
		assert.equal(summarizeMessagesShapeForLog('not-messages'), null);
	});
});
