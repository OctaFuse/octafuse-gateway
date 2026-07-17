import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	IMAGE_GENERATIONS_BODY_TEMPLATE,
	imageRequestMetaFromBody,
	parseImagesGenerationsResponse,
} from './image-generations';

describe('image-generations helpers', () => {
	it('IMAGE_GENERATIONS_BODY_TEMPLATE is valid JSON with prompt', () => {
		const parsed = JSON.parse(IMAGE_GENERATIONS_BODY_TEMPLATE) as { prompt: string; n: number };
		assert.equal(typeof parsed.prompt, 'string');
		assert.equal(parsed.n, 1);
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

	it('imageRequestMetaFromBody reads quality/size/n', () => {
		assert.deepEqual(imageRequestMetaFromBody({ quality: 'high', size: '512x512', n: 3 }), {
			quality: 'high',
			size: '512x512',
			n: 3,
		});
	});
});
