import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	imageBodyTemplateFor,
	imageRequestMetaFromBody,
	openaiEditImageFormField,
	parseImagesGenerationsResponse,
} from './image-generations';

describe('image-generations helpers', () => {
	it('imageBodyTemplateFor uses each family official lowest size', () => {
		const body = (providerModelName: string, protocol = 'openai', adapter?: string) =>
			JSON.parse(
				imageBodyTemplateFor({ protocol, adapter, providerModelName, operation: 'generations' }),
			) as Record<string, unknown>;
		const gpt = body('gpt-image-2');
		assert.equal(gpt.size, '1024x1024');
		assert.equal(gpt.quality, 'low');
		assert.equal(body('doubao-seedream-5-0').size, '2K');
		assert.equal(body('doubao-seedream-5-0-pro').size, '1K');
		assert.equal(body('doubao-seedream-5-0-flash').size, '1K');
		assert.equal(body('qwen-image-3.0-pro', 'openai', 'dashscope-image-qwen').size, '1024*1024');
		assert.equal(body('wan2.7-image', 'openai', 'dashscope-image-wan').size, '1K');
		assert.equal(body('glm-image').size, '1280x1280');
		assert.equal(body('glm-image').quality, undefined);
		const grok = body('grok-imagine-image-2.0');
		assert.equal(grok.resolution, '1k');
		assert.equal(grok.aspect_ratio, '1:1');
		assert.equal(grok.quality, 'low');
		assert.equal(grok.size, undefined);
		const grokQuality = body('grok-imagine-image-quality');
		assert.equal(grokQuality.resolution, '1k');
		assert.equal(grokQuality.quality, undefined);
		assert.equal(grokQuality.size, undefined);
		const gemini = body('gemini-3.1-flash-image');
		assert.equal(gemini.aspect_ratio, '1:1');
		assert.equal(gemini.response_format, 'b64_json');
		assert.equal(gemini.size, undefined);
		assert.equal(gemini.quality, undefined);
		const minimax = body('image-01', 'openai', 'minimax-image');
		assert.equal(minimax.aspect_ratio, '1:1');
		assert.equal(minimax.size, undefined);
		assert.equal(body('new-image-model').size, undefined);
		const nativeWan = body('wan2.7-image-pro', 'dashscope', 'passthrough');
		assert.equal((nativeWan.parameters as { size?: string }).size, '1K');
		const nativeQwen = body('qwen-image-3.0', 'dashscope', 'passthrough');
		assert.equal((nativeQwen.parameters as { size?: string }).size, '1024*1024');
		assert.equal(body('doubao-seedream-5-0-flash', 'volcengine', 'passthrough').size, '1K');
		assert.equal(body('doubao-seedream-5-0', 'volcengine', 'passthrough').size, '2K');
	});

	it('parseImagesGenerationsResponse extracts b64 and url', () => {
		const json = JSON.stringify({
			data: [
				{ b64_json: 'abc123' },
				{ url: 'https://example.com/a.png' },
			],
		});
		const parsed = parseImagesGenerationsResponse(json, { quality: 'low', size: '1024x1024', n: 2 });
		assert.equal(parsed.count, 2);
		assert.equal(parsed.images[0]?.kind, 'b64');
		assert.ok(parsed.images[0]?.src.startsWith('data:image/png;base64,'));
		assert.equal(parsed.images[1]?.kind, 'url');
		assert.match(parsed.usageHint ?? '', /2 images/);
		assert.match(parsed.usageHint ?? '', /quality=low/);
	});

	it('parseImagesGenerationsResponse extracts MiniMax urls and base64', () => {
		const json = JSON.stringify({
			data: {
				image_urls: [' https://cdn.example/a.jpg '],
				image_base64: ['abc', ' '],
			},
		});
		const parsed = parseImagesGenerationsResponse(json);
		assert.equal(parsed.count, 2);
		assert.equal(parsed.images[0]?.kind, 'url');
		assert.equal(parsed.images[0]?.src, 'https://cdn.example/a.jpg');
		assert.equal(parsed.images[1]?.src, 'data:image/jpeg;base64,abc');
	});

	it('parseImagesGenerationsResponse extracts DashScope multimodal image URLs', () => {
		const json = JSON.stringify({
			output: {
				choices: [
					{
						message: {
							content: [{ image: 'https://oss.example.com/a.png' }],
						},
					},
				],
			},
		});
		const parsed = parseImagesGenerationsResponse(json, { size: '1024*1024', n: 1 });
		assert.equal(parsed.count, 1);
		assert.equal(parsed.images[0]?.kind, 'url');
		assert.equal(parsed.images[0]?.src, 'https://oss.example.com/a.png');
		assert.match(parsed.usageHint ?? '', /1 image/);
	});

	it('openaiEditImageFormField uses image[] only for multiple files', () => {
		assert.equal(openaiEditImageFormField(1), 'image');
		assert.equal(openaiEditImageFormField(2), 'image[]');
	});

	it('imageRequestMetaFromBody reads quality/size/n', () => {
		assert.deepEqual(imageRequestMetaFromBody({ quality: 'high', size: '512x512', n: 3 }), {
			quality: 'high',
			size: '512x512',
			n: 3,
		});
	});
});
