import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	GeminiOpenAiImageClientError,
	buildGeminiImageBodyFromOpenAi,
	geminiImageConfigFromOpenAiSize,
	geminiImageFailureMessage,
	geminiOpenAiImageBillingSize,
	geminiImageResponseToOpenAi,
} from './gemini-image-openai';

describe('geminiImageConfigFromOpenAiSize', () => {
	it('maps OpenAI pixel sizes to the nearest ratio and resolution tier', () => {
		assert.deepEqual(geminiImageConfigFromOpenAiSize('1024x1024'), { aspectRatio: '1:1', imageSize: '1K' });
		assert.deepEqual(geminiImageConfigFromOpenAiSize('1536x1024'), { aspectRatio: '3:2', imageSize: '1K' });
		assert.deepEqual(geminiImageConfigFromOpenAiSize('1024x1536'), { aspectRatio: '2:3', imageSize: '1K' });
		assert.deepEqual(geminiImageConfigFromOpenAiSize('1920x1080'), { aspectRatio: '16:9', imageSize: '2K' });
		assert.deepEqual(geminiImageConfigFromOpenAiSize('4096*1752'), { aspectRatio: '21:9', imageSize: '4K' });
	});

	it('accepts resolution tiers and auto', () => {
		assert.deepEqual(geminiImageConfigFromOpenAiSize('2k'), { imageSize: '2K' });
		assert.deepEqual(geminiImageConfigFromOpenAiSize('512'), { imageSize: '512' });
		assert.deepEqual(geminiImageConfigFromOpenAiSize('auto'), {});
		assert.deepEqual(geminiImageConfigFromOpenAiSize(undefined), {});
		assert.throws(() => geminiImageConfigFromOpenAiSize('huge'), GeminiOpenAiImageClientError);
	});

	it('picks the precheck resolution from extra fields before size', () => {
		assert.equal(geminiOpenAiImageBillingSize('1024x1024'), '1k');
		assert.equal(
			geminiOpenAiImageBillingSize('1024x1024', { generationConfig: { imageConfig: { imageSize: '4K' } } }),
			'4k',
		);
		assert.equal(geminiOpenAiImageBillingSize(undefined), 'auto');
		assert.equal(geminiOpenAiImageBillingSize('huge'), 'auto');
	});
});

describe('buildGeminiImageBodyFromOpenAi', () => {
	it('builds a generateContent body with prompt, reference images and imageConfig', () => {
		const body = buildGeminiImageBodyFromOpenAi({
			prompt: ' a red apple ',
			n: 1,
			size: '1024x1024',
			quality: 'high',
			response_format: 'b64_json',
			image: ['data:image/png;base64,AAAA'],
		});
		assert.deepEqual(body, {
			contents: [
				{
					role: 'user',
					parts: [{ text: 'a red apple' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
				},
			],
			generationConfig: {
				responseModalities: ['TEXT', 'IMAGE'],
				imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
			},
		});
	});

	it('omits imageConfig when size is missing', () => {
		const body = buildGeminiImageBodyFromOpenAi({ prompt: 'cat' });
		assert.deepEqual(body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'] });
	});

	it('rejects options Gemini cannot honor', () => {
		assert.throws(() => buildGeminiImageBodyFromOpenAi({ prompt: '' }), /prompt is required/);
		assert.throws(() => buildGeminiImageBodyFromOpenAi({ prompt: 'cat', n: 2 }), /n must be 1/);
		assert.throws(
			() => buildGeminiImageBodyFromOpenAi({ prompt: 'cat', response_format: 'url' }),
			/response_format must be b64_json/,
		);
		assert.throws(
			() => buildGeminiImageBodyFromOpenAi({ prompt: 'cat', image: 'https://example.com/a.png' }),
			/data URL/,
		);
	});
});

describe('geminiImageResponseToOpenAi', () => {
	const payload = {
		candidates: [
			{
				content: {
					parts: [
						{ text: 'draft', thought: true },
						{ inlineData: { mimeType: 'image/png', data: 'THOUGHT' }, thought: true },
						{ text: 'Here is your apple.' },
						{ inlineData: { mimeType: 'image/jpeg', data: 'FINAL' } },
					],
				},
				finishReason: 'STOP',
			},
		],
		usageMetadata: {
			promptTokenCount: 7,
			candidatesTokenCount: 1130,
			thoughtsTokenCount: 50,
			totalTokenCount: 1187,
			promptTokensDetails: [{ modality: 'TEXT', tokenCount: 7 }],
			candidatesTokensDetails: [
				{ modality: 'TEXT', tokenCount: 10 },
				{ modality: 'IMAGE', tokenCount: 1120 },
			],
		},
	};

	it('keeps only final inline images and maps usage', () => {
		const out = geminiImageResponseToOpenAi(payload);
		assert.deepEqual(out.data, [{ b64_json: 'FINAL' }]);
		assert.equal(out.output_format, 'jpeg');
		assert.deepEqual(out.usage, {
			input_tokens: 7,
			input_tokens_details: { text_tokens: 7, image_tokens: 0, cached_tokens: 0 },
			output_tokens: 1180,
			output_tokens_details: { text_tokens: 60, image_tokens: 1120 },
			total_tokens: 1187,
		});
	});

	it('explains why no image came back', () => {
		assert.deepEqual(geminiImageResponseToOpenAi({ candidates: [] }).data, []);
		assert.equal(
			geminiImageFailureMessage({ promptFeedback: { blockReason: 'SAFETY' } }),
			'Gemini blocked the prompt (SAFETY)',
		);
		assert.equal(
			geminiImageFailureMessage({
				candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [{ text: 'I cannot draw that.' }] } }],
			}),
			'Gemini returned no image (finishReason=IMAGE_SAFETY: I cannot draw that.)',
		);
	});
});
