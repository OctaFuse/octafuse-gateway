import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	countGeminiOutputImages,
	countGeminiReferenceImages,
	geminiImageBillingSize,
	requestedGeminiImageCount,
	scanGeminiGenerateContentSse,
} from './gemini-image-native';

describe('gemini image native parsing', () => {
	it('counts non-thought inline images and skips thought images', () => {
		const count = countGeminiOutputImages({
			candidates: [
				{
					content: {
						parts: [
							{ thought: true, inlineData: { mimeType: 'image/png', data: 'thought' } },
							{ text: 'a lantern' },
							{ inline_data: { mime_type: 'image/jpeg', data: 'abc' } },
							{ inlineData: { mimeType: 'image/png', data: '   ' } },
						],
					},
				},
			],
		});
		assert.equal(count, 1);
	});

	it('reads imageSize and candidateCount', () => {
		const body = {
			contents: [{ parts: [{ text: 'lantern' }] }],
			generationConfig: {
				candidateCount: 3,
				imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
			},
		};
		assert.equal(geminiImageBillingSize(body), '2k');
		assert.equal(requestedGeminiImageCount(body), 3);
		assert.equal(requestedGeminiImageCount({}), 1);
		assert.equal(requestedGeminiImageCount({ generation_config: { candidate_count: 99 } }), 8);
	});

	it('counts inline and file reference images', () => {
		const count = countGeminiReferenceImages({
			contents: [
				{
					parts: [
						{ text: 'edit this' },
						{ inlineData: { mimeType: 'image/png', data: 'aaa' } },
						{ fileData: { mimeType: 'image/jpeg', fileUri: 'https://example.com/a.jpg' } },
						{ fileData: { mimeType: 'application/pdf', fileUri: 'https://example.com/a.pdf' } },
						{ thought: true, inlineData: { mimeType: 'image/png', data: 'skip' } },
					],
				},
			],
		});
		assert.equal(count, 2);
	});

	it('scans SSE chunks and keeps the last usageMetadata', () => {
		const first = scanGeminiGenerateContentSse(
			'data: {"candidates":[{"content":{"parts":[{"thought":true,"inlineData":{"mimeType":"image/png","data":"t"}},{"inlineData":{"mimeType":"image/png","data":"img"}}]}}]}\n\n',
			'',
		);
		assert.equal(first.imageCount, 1);
		assert.equal(first.usageMetadata, null);
		const second = scanGeminiGenerateContentSse(
			'data: {"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":1120}}\n\n',
			first.carry,
		);
		assert.equal(second.imageCount, 0);
		assert.deepEqual(second.usageMetadata, { promptTokenCount: 8, candidatesTokenCount: 1120 });
	});
});
