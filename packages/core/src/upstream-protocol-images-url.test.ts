import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOpenAiCompatibleImagesUrl } from './upstream-protocol';

describe('buildOpenAiCompatibleImagesUrl', () => {
	it('appends /images/generations for standard OpenAI-style roots', () => {
		assert.equal(
			buildOpenAiCompatibleImagesUrl('https://api.openai.com/v1', 'generations'),
			'https://api.openai.com/v1/images/generations'
		);
		assert.equal(
			buildOpenAiCompatibleImagesUrl('https://api.openai.com/v1/', 'edits'),
			'https://api.openai.com/v1/images/edits'
		);
	});

	it('does not double-append when base is already /images/generations', () => {
		assert.equal(
			buildOpenAiCompatibleImagesUrl(
				'https://api.openai.com/v1/images/generations',
				'generations'
			),
			'https://api.openai.com/v1/images/generations'
		);
	});

	it('treats wangsu-style openai-image-generations as a full endpoint', () => {
		const base =
			'https://aigateway.edgecloudapp.com/v1/abc/openai-image-generations';
		assert.equal(buildOpenAiCompatibleImagesUrl(base, 'generations'), base);
	});

	it('rewrites full generations endpoint to edits (no double append)', () => {
		assert.equal(
			buildOpenAiCompatibleImagesUrl(
				'https://api.openai.com/v1/images/generations',
				'edits'
			),
			'https://api.openai.com/v1/images/edits'
		);
		assert.equal(
			buildOpenAiCompatibleImagesUrl('https://api.openai.com/v1/images/edits', 'generations'),
			'https://api.openai.com/v1/images/generations'
		);
	});

	it('rewrites wangsu generations endpoint to edits sibling', () => {
		const base =
			'https://aigateway.edgecloudapp.com/v1/abc/openai-image-generations';
		assert.equal(
			buildOpenAiCompatibleImagesUrl(base, 'edits'),
			'https://aigateway.edgecloudapp.com/v1/abc/openai-image-edits'
		);
	});
});
