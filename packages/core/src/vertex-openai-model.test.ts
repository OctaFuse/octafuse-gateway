import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyVertexOpenAiModelPrefix, isVertexOpenAiCompatibleUrl } from './vertex-openai-model';

const OPENAPI_URL =
	'https://aiplatform.googleapis.com/v1/projects/demo/locations/global/endpoints/openapi/chat/completions';
const GEMINI_URL =
	'https://aiplatform.googleapis.com/v1/projects/demo/locations/global/publishers/google/models/gemini-2.5-flash:generateContent';

describe('applyVertexOpenAiModelPrefix', () => {
	it('detects official Vertex OpenAI URLs only', () => {
		assert.equal(isVertexOpenAiCompatibleUrl(OPENAPI_URL), true);
		assert.equal(isVertexOpenAiCompatibleUrl(GEMINI_URL), false);
		assert.equal(isVertexOpenAiCompatibleUrl('https://api.openai.com/v1/chat/completions'), false);
	});

	it('adds google/ on Vertex OpenAI when the model has no publisher prefix', () => {
		assert.equal(applyVertexOpenAiModelPrefix(OPENAPI_URL, 'gemini-2.5-flash'), 'google/gemini-2.5-flash');
		assert.equal(applyVertexOpenAiModelPrefix(OPENAPI_URL, 'google/gemini-2.5-flash'), 'google/gemini-2.5-flash');
	});

	it('does not prefix Gemini native or other OpenAI hosts', () => {
		assert.equal(applyVertexOpenAiModelPrefix(GEMINI_URL, 'gemini-2.5-flash'), 'gemini-2.5-flash');
		assert.equal(
			applyVertexOpenAiModelPrefix('https://api.openai.com/v1/chat/completions', 'gemini-2.5-flash'),
			'gemini-2.5-flash'
		);
	});
});
