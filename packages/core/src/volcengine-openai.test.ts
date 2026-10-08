import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	VolcengineOpenAiClientError,
	buildVolcengineImageBodyFromOpenAi,
	firstVolcengineImageFailureMessage,
	volcengineImageResponseToOpenAi,
} from './volcengine-openai';

describe('Volcengine OpenAI image mapping', () => {
	it('omits sequential fields when n is 1 and forwards size, background, output_format, watermark, and image', () => {
		assert.deepEqual(
			buildVolcengineImageBodyFromOpenAi('doubao-seedream-5-0-pro-260708', {
				prompt: ' a cat ',
				n: 1,
				size: '2K',
				quality: 'high',
				background: 'Transparent',
				output_format: 'PNG',
				watermark: false,
				response_format: 'url',
				image: ' https://example.com/ref.png ',
			}),
			{
				model: 'doubao-seedream-5-0-pro-260708',
				prompt: 'a cat',
				response_format: 'url',
				size: '2K',
				background: 'transparent',
				output_format: 'png',
				watermark: false,
				image: 'https://example.com/ref.png',
			},
		);
	});

	it('forwards size auto and leaves background auto to Ark defaults', () => {
		const body = buildVolcengineImageBodyFromOpenAi('doubao-seedream-5-0-260128', {
			prompt: 'a cat',
			size: 'auto',
			background: 'auto',
			output_format: 'jpg',
		});
		assert.equal(body.size, 'auto');
		assert.equal(body.background, undefined);
		assert.equal(body.output_format, 'jpeg');
		assert.equal(body.sequential_image_generation, undefined);
	});

	it('rejects group generation on Seedream 5.0 pro and flash', () => {
		for (const model of ['doubao-seedream-5-0-pro-260708', 'dola-seedream-5-0-flash-260915']) {
			assert.throws(
				() => buildVolcengineImageBodyFromOpenAi(model, { prompt: 'a cat', n: 2 }),
				/do not support group generation/,
			);
		}
	});

	it('rejects background and output_format values Ark does not have', () => {
		assert.throws(
			() => buildVolcengineImageBodyFromOpenAi('doubao-seedream-5-0-260128', { prompt: 'a', background: 'blur' }),
			VolcengineOpenAiClientError,
		);
		assert.throws(
			() => buildVolcengineImageBodyFromOpenAi('doubao-seedream-5-0-260128', { prompt: 'a', output_format: 'webp' }),
			/output_format must be png or jpeg/,
		);
	});

	it('maps n of 2-15 onto sequential max_images', () => {
		const body = buildVolcengineImageBodyFromOpenAi('doubao-seedream-5-0-260128', {
			prompt: 'a cat',
			n: 4,
			size: '1024x1024',
			response_format: 'b64_json',
			image: ['https://a.example/1.png', 'https://a.example/2.png'],
		});
		assert.equal(body.sequential_image_generation, 'auto');
		assert.deepEqual(body.sequential_image_generation_options, { max_images: 4 });
		assert.equal(body.size, '1024x1024');
		assert.equal(body.response_format, 'b64_json');
		assert.deepEqual(body.image, ['https://a.example/1.png', 'https://a.example/2.png']);
		assert.equal(body.quality, undefined);
		assert.equal(body.stream, undefined);
	});

	it('rejects n, response_format, and a missing prompt', () => {
		assert.throws(
			() => buildVolcengineImageBodyFromOpenAi('doubao-seedream-5-0-260128', { prompt: 'a cat', n: 16 }),
			VolcengineOpenAiClientError,
		);
		assert.throws(
			() =>
				buildVolcengineImageBodyFromOpenAi('doubao-seedream-5-0-260128', {
					prompt: 'a cat',
					response_format: 'png',
				}),
			VolcengineOpenAiClientError,
		);
		assert.throws(
			() => buildVolcengineImageBodyFromOpenAi('doubao-seedream-5-0-260128', { prompt: '  ' }),
			VolcengineOpenAiClientError,
		);
	});

	it('keeps successful images with Ark fields, drops failed items, and passes usage through', () => {
		const converted = volcengineImageResponseToOpenAi({
			created: 1700000000,
			data: [
				{ url: ' https://cdn.example/a.png ', size: '2048x2048', output_format: 'png', z_index: 1 },
				{ error: { code: 'x', message: 'failed one' } },
			],
			usage: { generated_images: 1, output_tokens: 16384, total_tokens: 16384 },
		});
		assert.deepEqual(converted, {
			created: 1700000000,
			data: [{ url: 'https://cdn.example/a.png', size: '2048x2048', output_format: 'png', z_index: 1 }],
			usage: { generated_images: 1, output_tokens: 16384, total_tokens: 16384 },
		});
		assert.equal(
			firstVolcengineImageFailureMessage({
				data: [{ error: { code: 'x', message: ' failed one ' } }],
			}),
			'failed one',
		);
	});

	it('reads a top-level error when data has no images', () => {
		const converted = volcengineImageResponseToOpenAi({
			error: { code: 'InvalidParameter', message: 'size is invalid' },
		});
		assert.deepEqual(converted.data, []);
		assert.equal(
			firstVolcengineImageFailureMessage({
				error: { message: 'size is invalid' },
			}),
			'size is invalid',
		);
	});
});
