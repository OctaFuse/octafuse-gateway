import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyOpenAiImageGenerationExtras } from './image-generation-extras';

describe('applyOpenAiImageGenerationExtras', () => {
	it('passes Seedream watermark / sequential / image fields', () => {
		const upstream: Record<string, unknown> = { prompt: 'x', n: 1 };
		applyOpenAiImageGenerationExtras(upstream, {
			watermark: false,
			sequential_image_generation: 'disabled',
			sequential_image_generation_options: { max_images: 1 },
			optimize_prompt_options: { mode: 'standard' },
			image: 'https://example.com/ref.png',
		});
		assert.equal(upstream.watermark, false);
		assert.equal(upstream.sequential_image_generation, 'disabled');
		assert.deepEqual(upstream.sequential_image_generation_options, { max_images: 1 });
		assert.deepEqual(upstream.optimize_prompt_options, { mode: 'standard' });
		assert.equal(upstream.image, 'https://example.com/ref.png');
	});

	it('normalizes image string arrays', () => {
		const upstream: Record<string, unknown> = { prompt: 'x', n: 1 };
		applyOpenAiImageGenerationExtras(upstream, {
			image: ['https://a.example/1.png', 'https://a.example/2.png'],
		});
		assert.deepEqual(upstream.image, ['https://a.example/1.png', 'https://a.example/2.png']);
	});

	it('ignores unset extras', () => {
		const upstream: Record<string, unknown> = { prompt: 'x', n: 1 };
		applyOpenAiImageGenerationExtras(upstream, { prompt: 'x', n: 1 });
		assert.equal('watermark' in upstream, false);
		assert.equal('image' in upstream, false);
	});
});
