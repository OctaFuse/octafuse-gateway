import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	EMBEDDING_GEMINI_EMBED_BODY_TEMPLATE,
	EMBEDDING_OPENAI_BODY_TEMPLATE,
	embeddingBodyTemplateFor,
	isEmbeddingRouteModel,
	joinEmbeddingUsageHint,
	parseEmbeddingResponse,
	summarizeEmbeddingResponse,
} from './embeddings';
import { modelKindFromFlags, resolveProxyPathForModelInvoke } from './invoke-kind';

describe('embeddings helpers', () => {
	it('picks body template by protocol', () => {
		assert.equal(embeddingBodyTemplateFor({ protocol: 'openai' }), EMBEDDING_OPENAI_BODY_TEMPLATE);
		assert.equal(embeddingBodyTemplateFor({ protocol: 'gemini' }), EMBEDDING_GEMINI_EMBED_BODY_TEMPLATE);
	});

	it('detects embedding models by output modality', () => {
		assert.equal(isEmbeddingRouteModel({ output_modalities: ['embedding'] } as never), true);
		assert.equal(isEmbeddingRouteModel({ output_modalities: ['text'] } as never), false);
	});

	it('parses OpenAI response', () => {
		const text = JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }], usage: { prompt_tokens: 4, total_tokens: 4 } });
		assert.deepEqual(parseEmbeddingResponse(text), { vectorCount: 2, dimensions: 3, preview: [0.1, 0.2, 0.3] });
		assert.match(summarizeEmbeddingResponse(text) ?? '', /^2 vectors · 3 dims/);
	});

	it('parses Gemini single and batch responses', () => {
		assert.equal(parseEmbeddingResponse(JSON.stringify({ embedding: { values: [1, 2] } }))?.dimensions, 2);
		const batch = parseEmbeddingResponse(JSON.stringify({ embeddings: [{ values: [1, 2, 3, 4] }, { values: [5, 6, 7, 8] }] }));
		assert.equal(batch?.vectorCount, 2);
		assert.equal(batch?.dimensions, 4);
	});

	it('handles base64 vectors and unknown payloads', () => {
		assert.deepEqual(parseEmbeddingResponse(JSON.stringify({ data: [{ embedding: 'AAAA' }] })), { vectorCount: 1, dimensions: 0, preview: [] });
		assert.equal(parseEmbeddingResponse('not json'), null);
		assert.equal(parseEmbeddingResponse('{}'), null);
		assert.equal(joinEmbeddingUsageHint('{}', 'openai'), null);
	});
});

describe('invoke-kind embedding', () => {
	it('derives model kind with embedding priority', () => {
		assert.equal(modelKindFromFlags(false, false, true), 'embedding');
		assert.equal(modelKindFromFlags(false, false), 'llm');
	});

	it('resolves proxy paths', () => {
		assert.equal(resolveProxyPathForModelInvoke({ kind: 'embedding', protocol: 'openai' }), '/v1/embeddings');
		assert.equal(
			resolveProxyPathForModelInvoke({ kind: 'embedding', protocol: 'gemini', geminiModelSegment: 'gemini-embedding-2' }),
			'/v1beta/models/gemini-embedding-2:embedContent'
		);
		assert.equal(
			resolveProxyPathForModelInvoke({ kind: 'embedding', protocol: 'gemini', geminiModelSegment: 'm', geminiEmbedAction: 'batchEmbedContents' }),
			'/v1beta/models/m:batchEmbedContents'
		);
	});
});
