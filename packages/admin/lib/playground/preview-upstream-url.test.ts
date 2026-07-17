import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { previewPlaygroundUpstreamUrl } from './preview-upstream-url';

describe('previewPlaygroundUpstreamUrl', () => {
	it('builds wangsu-style image URL without appending /images/generations', () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: 'p1',
				base_url_openai:
					'https://aigateway.edgecloudapp.com/v1/abc/openai-image-generations',
			},
			upstreamProtocol: 'openai',
			providerModelName: 'gpt-image-2',
			isImageModel: true,
		});
		assert.equal(
			url,
			'https://aigateway.edgecloudapp.com/v1/abc/openai-image-generations'
		);
	});

	it('appends /images/generations for standard OpenAI roots', () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: { id: 'p1', base_url_openai: 'https://api.openai.com/v1' },
			upstreamProtocol: 'openai',
			providerModelName: 'gpt-image-2',
			isImageModel: true,
		});
		assert.equal(url, 'https://api.openai.com/v1/images/generations');
	});
});
