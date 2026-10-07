import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	VolcengineOpenAiClientError,
	buildVolcengineImageBodyFromOpenAi,
	firstVolcengineImageFailureMessage,
	volcengineImageResponseToOpenAi,
} from './volcengine-openai';

describe('Volcengine OpenAI image mapping', () => {
	it('disables sequential generation when n is 1 and forwards size, watermark, and image', () => {
		assert.deepEqual(
			buildVolcengineImageBodyFromOpenAi('doubao-seedream-5-0-260128', {
				prompt: ' a cat ',
				n: 1,
				size: '2K',
				quality: 'high',
				background: 'transparent',
				watermark: false,
				response_format: 'url',
				image: ' https://example.com/ref.png ',
			}),
			{
				model: 'doubao-seedream-5-0-260128',
				prompt: 'a cat',
				response_format: 'url',
				sequential_image_generation: 'disabled',
				size: '2K',
				watermark: false,
				image: 'https://example.com/ref.png',
			},
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

	it('keeps successful images and drops failed items', () => {
		const converted = volcengineImageResponseToOpenAi({
			created: 1700000000,
			data: [
				{ url: 'https://cdn.example/a.png', size: '2048x2048' },
				{ error: { code: 'x', message: 'failed one' } },
			],
			usage: { generated_images: 1, output_tokens: 16384 },
		});
		assert.deepEqual(converted, {
			created: 1700000000,
			data: [{ url: 'https://cdn.example/a.png' }],
			usage: { generated_images: 1 },
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
