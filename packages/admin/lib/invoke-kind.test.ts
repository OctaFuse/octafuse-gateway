import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { modelKindFromFlags, resolveProxyPathForModelInvoke } from './invoke-kind';

describe('invoke-kind embedding', () => {
	it('prefers embedding over other kinds', () => {
		assert.equal(modelKindFromFlags(false, false, true), 'embedding');
		assert.equal(modelKindFromFlags(true, false), 'audio');
		assert.equal(modelKindFromFlags(false, false), 'llm');
	});

	it('resolves OpenAI embeddings path', () => {
		assert.equal(resolveProxyPathForModelInvoke({ kind: 'embedding', protocol: 'openai' }), '/v1/embeddings');
	});

	it('resolves Gemini embed paths', () => {
		assert.equal(
			resolveProxyPathForModelInvoke({ kind: 'embedding', protocol: 'gemini', geminiModelSegment: 'gemini-embedding-2' }),
			'/v1beta/models/gemini-embedding-2:embedContent',
		);
		assert.equal(
			resolveProxyPathForModelInvoke({
				kind: 'embedding',
				protocol: 'gemini',
				geminiModelSegment: 'gemini-embedding-2',
				geminiEmbedAction: 'batchEmbedContents',
			}),
			'/v1beta/models/gemini-embedding-2:batchEmbedContents',
		);
	});
});
