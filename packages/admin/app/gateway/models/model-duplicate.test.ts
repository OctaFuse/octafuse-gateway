import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { copyModelId, modelFormForDuplicate } from './model-duplicate';
import { EMPTY_MODEL_FORM } from './types';

describe('modelFormForDuplicate', () => {
	it('suffixes the model id and display name, and copies the rest', () => {
		const source = {
			...EMPTY_MODEL_FORM,
			id: 'gpt-4o',
			display_name: 'GPT-4o',
			vendor: 'openai',
			tags: ['chat'],
			description: 'keep',
			metadata: '{"tier":"standard"}',
		};
		const copy = modelFormForDuplicate(source, (name) => `${name} (copy)`);

		assert.equal(copy.id, 'gpt-4o-copy');
		assert.equal(copy.display_name, 'GPT-4o (copy)');
		assert.equal(copy.vendor, 'openai');
		assert.equal(copy.description, 'keep');
		assert.equal(copy.metadata, '{"tier":"standard"}');
		assert.deepEqual(copy.tags, ['chat']);
		assert.notEqual(copy.tags, source.tags);
	});

	it('does not invent a display name when the source name is blank', () => {
		const copy = modelFormForDuplicate(
			{ ...EMPTY_MODEL_FORM, id: 'whisper-1', display_name: '  ' },
			(name) => `${name} (copy)`
		);

		assert.equal(copy.id, 'whisper-1-copy');
		assert.equal(copy.display_name, '');
	});

	it('leaves a blank model id blank and trims the source id', () => {
		assert.equal(copyModelId('  '), '');
		assert.equal(copyModelId('  claude-sonnet-5-5  '), 'claude-sonnet-5-5-copy');
	});

	it('keeps the suggested model id within 512 characters', () => {
		const source = 'm'.repeat(512);
		const copy = copyModelId(source);
		assert.equal(copy.length, 512);
		assert.equal(copy.endsWith('-copy'), true);
		assert.equal(copy.startsWith('m'.repeat(500)), true);
	});
});
