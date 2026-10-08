import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	VOLCENGINE_MAX_SEQUENTIAL_IMAGES,
	countVolcengineImages,
	isVolcengineSingleImageModel,
	requestedVolcengineImageCount,
	scanVolcengineImageSse,
	volcengineImageBillingSize,
	volcengineSseImageCount,
} from './volcengine-native';

describe('volcengine native image parsing', () => {
	it('maps size to the billing tier used by Seedream pricing', () => {
		assert.equal(volcengineImageBillingSize(undefined), 'auto');
		assert.equal(volcengineImageBillingSize(' 2K '), '2k');
		assert.equal(volcengineImageBillingSize('1.5K'), '1.5k');
		assert.equal(volcengineImageBillingSize('1024x1024'), '1k');
		assert.equal(volcengineImageBillingSize('2048x1024'), '1.5k');
		assert.equal(volcengineImageBillingSize('1536x1536'), '1.5k');
		assert.equal(volcengineImageBillingSize('2048x2048'), '2k');
		assert.equal(volcengineImageBillingSize('2848x1600'), '2k');
		assert.equal(volcengineImageBillingSize('3072x3072'), '3k');
		assert.equal(volcengineImageBillingSize('4096x4096'), '4k');
	});

	it('recognizes the single-image Seedream 5.0 pro and flash models', () => {
		assert.equal(isVolcengineSingleImageModel('doubao-seedream-5-0-pro-260708'), true);
		assert.equal(isVolcengineSingleImageModel('dola-seedream-5-0-flash-260915'), true);
		assert.equal(isVolcengineSingleImageModel('doubao-seedream-5-0-260128'), false);
		assert.equal(isVolcengineSingleImageModel('doubao-seedream-4-5-251128'), false);
	});

	it('prefers usage.generated_images over data length', () => {
		assert.equal(
			countVolcengineImages({
				data: [{ url: 'https://cdn.example/a.png' }, { error: { code: 'x', message: 'failed' } }],
				usage: { generated_images: 1 },
			}),
			1,
		);
	});

	it('counts data items that carry url or b64_json when usage is missing', () => {
		assert.equal(
			countVolcengineImages({
				data: [
					{ url: 'https://cdn.example/a.png' },
					{ b64_json: 'aaaa' },
					{ error: { code: 'x', message: 'failed' } },
					{ url: '   ' },
				],
			}),
			2,
		);
		assert.equal(countVolcengineImages({ error: { code: 'BadRequest', message: 'nope' } }), 0);
	});

	it('prechecks one image unless sequential generation is auto', () => {
		assert.equal(requestedVolcengineImageCount({ prompt: 'cat' }), 1);
		assert.equal(requestedVolcengineImageCount({ sequential_image_generation: 'disabled' }), 1);
		assert.equal(
			requestedVolcengineImageCount({
				sequential_image_generation: 'auto',
				sequential_image_generation_options: { max_images: 4 },
			}),
			4,
		);
		assert.equal(
			requestedVolcengineImageCount({ sequential_image_generation: 'auto' }),
			VOLCENGINE_MAX_SEQUENTIAL_IMAGES,
		);
		assert.equal(
			requestedVolcengineImageCount({
				sequential_image_generation: 'auto',
				sequential_image_generation_options: { max_images: 99 },
			}),
			VOLCENGINE_MAX_SEQUENTIAL_IMAGES,
		);
	});

	it('reads generated_images from a completed SSE event split across chunks', () => {
		const first = scanVolcengineImageSse(
			'event: image_generation.partial_succeeded\ndata: {"type":"image_generation.partial_succeeded","url":"https://a"}\n\n',
			'',
		);
		assert.equal(first.partialSucceeded, 1);
		assert.equal(first.generatedImages, null);
		const split = 'event: image_generation.completed\ndata: {"type":"image_generation.completed","usage":{"generated_';
		const mid = scanVolcengineImageSse(split, '');
		assert.equal(mid.generatedImages, null);
		assert.notEqual(mid.carry, '');
		const done = scanVolcengineImageSse('images":3}}\n\n', mid.carry);
		assert.equal(done.generatedImages, 3);
		assert.equal(done.carry, '');
		assert.equal(
			volcengineSseImageCount({
				generatedImages: done.generatedImages,
				partialSucceeded: first.partialSucceeded,
				error: false,
			}),
			3,
		);
	});

	it('falls back to partial_succeeded and ignores partial_failed', () => {
		const scan = scanVolcengineImageSse(
			[
				'data: {"type":"image_generation.partial_succeeded","image_index":0,"url":"https://a"}',
				'',
				'data: {"type":"image_generation.partial_failed","image_index":1,"error":{"code":"x","message":"failed"}}',
				'',
				'data: [DONE]',
				'',
			].join('\n'),
			'',
		);
		assert.equal(scan.partialSucceeded, 1);
		assert.equal(scan.error, false);
		assert.equal(volcengineSseImageCount(scan), 1);
	});

	it('treats a request-level error with no successes as zero images', () => {
		const scan = scanVolcengineImageSse('event: error\ndata: {"type":"error","error":{"code":"BadRequest","message":"nope"}}\n\n', '');
		assert.equal(scan.error, true);
		assert.equal(volcengineSseImageCount(scan), 0);
	});
});
