import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultHasUsage, modelDisplayName } from './proxy-pipeline';
import { EMPTY_USAGE, type UsageFromStream } from './proxy';

describe('proxy pipeline helpers', () => {
	it('treats any token counter as usage for chat-family endpoints', () => {
		assert.equal(defaultHasUsage(EMPTY_USAGE), false);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, input_tokens: 3 }), true);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, output_tokens: 1 }), true);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, total_tokens: 8 }), true);
	});

	it('does not treat reasoning-only usage as complete for the default helper', () => {
		const usage: UsageFromStream = { ...EMPTY_USAGE, reasoning_tokens: 12 };
		assert.equal(defaultHasUsage(usage), false);
	});

	it('prefers a non-empty display name', () => {
		assert.equal(modelDisplayName({ display_name: '  GPT  ' }, 'gpt-x'), 'GPT');
		assert.equal(modelDisplayName({ display_name: '' }, 'gpt-x'), 'gpt-x');
		assert.equal(modelDisplayName({ display_name: null }, 'gpt-x'), 'gpt-x');
	});
});
