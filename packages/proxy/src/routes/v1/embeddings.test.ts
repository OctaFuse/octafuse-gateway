import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { embeddingsBodyRedactedForLog } from './embeddings';
import { geminiEmbedBodyRedactedForLog } from './gemini';

describe('embeddings log redaction', () => {
	it('drops OpenAI input text and keeps counts and params', () => {
		assert.deepEqual(
			embeddingsBodyRedactedForLog({ model: 'm', input: ['secret a', 'secret b'], dimensions: 256 }),
			{ model: 'm', dimensions: 256, _input_count: 2 }
		);
		assert.deepEqual(embeddingsBodyRedactedForLog({ model: 'm', input: 'secret' }), {
			model: 'm',
			_input_count: 1,
		});
	});

	it('drops Gemini content and batch requests', () => {
		assert.deepEqual(
			geminiEmbedBodyRedactedForLog({ content: { parts: [{ text: 'secret' }] }, taskType: 'RETRIEVAL_QUERY' }, 'embedContent'),
			{ taskType: 'RETRIEVAL_QUERY', _gemini_action: 'embedContent' }
		);
		assert.deepEqual(
			geminiEmbedBodyRedactedForLog({ requests: [{ content: {} }, { content: {} }] }, 'batchEmbedContents'),
			{ _requests_count: 2, _gemini_action: 'batchEmbedContents' }
		);
	});
});
