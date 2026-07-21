import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildImagePrecheckUsage,
	computeImageTokenMeteredCost,
	estimateImageOutputTokensForPrecheck,
	IMAGE_PRECHECK_IMAGE_INPUT_TOKEN_HEADROOM,
	IMAGE_PRECHECK_MAX_REFERENCE_COUNT,
	parseOpenAiImageUsage,
	SEEDREAM_TYPICAL_OUTPUT_TOKENS,
} from './image-token-usage';
import type { BillingPriceSnapshot } from './pricing-profile';

const GPT_IMAGE_2_PRICES: BillingPriceSnapshot = {
	input_price: 5,
	output_price: 0,
	cache_read_price: 1.25,
	cache_write_price: null,
	image_input_price: 8,
	image_input_cache_price: 2,
	image_output_price: 30,
};

describe('parseOpenAiImageUsage', () => {
	it('parses input/output token details', () => {
		const usage = parseOpenAiImageUsage({
			usage: {
				input_tokens: 120,
				output_tokens: 5500,
				total_tokens: 5620,
				input_tokens_details: {
					text_tokens: 100,
					image_tokens: 20,
					cached_text_tokens: 10,
				},
				output_tokens_details: {
					image_tokens: 5500,
				},
			},
		});
		assert.ok(usage);
		assert.equal(usage!.text_tokens, 100);
		assert.equal(usage!.image_input_tokens, 20);
		assert.equal(usage!.cached_text_tokens, 10);
		assert.equal(usage!.image_output_tokens, 5500);
		assert.equal(usage!.total_tokens, 5620);
		assert.ok(usage!.raw_usage?.includes('input_tokens_details'));
	});

	it('falls back to totals when details missing', () => {
		const usage = parseOpenAiImageUsage({
			usage: { input_tokens: 50, output_tokens: 200, total_tokens: 250 },
		});
		assert.ok(usage);
		assert.equal(usage!.text_tokens, 50);
		assert.equal(usage!.image_input_tokens, 0);
		assert.equal(usage!.image_output_tokens, 200);
	});

	it('parses Seedream-style usage (output_tokens only, generated_images)', () => {
		const usage = parseOpenAiImageUsage({
			usage: {
				generated_images: 1,
				output_tokens: SEEDREAM_TYPICAL_OUTPUT_TOKENS,
				total_tokens: SEEDREAM_TYPICAL_OUTPUT_TOKENS,
			},
		});
		assert.ok(usage);
		assert.equal(usage!.text_tokens, 0);
		assert.equal(usage!.image_input_tokens, 0);
		assert.equal(usage!.image_output_tokens, SEEDREAM_TYPICAL_OUTPUT_TOKENS);
		assert.equal(usage!.total_tokens, SEEDREAM_TYPICAL_OUTPUT_TOKENS);
	});

	it('returns null without usage', () => {
		assert.equal(parseOpenAiImageUsage({ data: [] }), null);
	});
});

describe('SEEDREAM_TYPICAL_OUTPUT_TOKENS (token-precheck constant only)', () => {
	it('documents historical fold math (per_image models no longer use this for billing)', () => {
		const cost = computeImageTokenMeteredCost(
			{
				text_tokens: 0,
				cached_text_tokens: 0,
				image_input_tokens: 0,
				cached_image_input_tokens: 0,
				image_output_tokens: SEEDREAM_TYPICAL_OUTPUT_TOKENS,
				total_tokens: SEEDREAM_TYPICAL_OUTPUT_TOKENS,
				raw_usage: null,
			},
			{
				input_price: 0,
				output_price: 0,
				cache_read_price: null,
				cache_write_price: null,
				image_input_price: null,
				image_input_cache_price: null,
				image_output_price: 13.43,
			}
		);
		// 16384 * 13.43 / 1e6 ≈ 0.2200 (legacy fold; Seedream now uses per_image.default)
		assert.ok(Math.abs(cost - 0.22) < 0.001);
	});
});

describe('computeImageTokenMeteredCost', () => {
	it('charges high 1536x1024-like output primarily via image_output ($30/M)', () => {
		const cost = computeImageTokenMeteredCost(
			{
				text_tokens: 20,
				cached_text_tokens: 0,
				image_input_tokens: 0,
				cached_image_input_tokens: 0,
				image_output_tokens: 5500,
				total_tokens: 5520,
				raw_usage: null,
			},
			GPT_IMAGE_2_PRICES
		);
		// 20*5/1e6 + 5500*30/1e6 = 0.0001 + 0.165 = 0.1651
		assert.ok(Math.abs(cost - 0.1651) < 1e-9);
	});

	it('includes image_input for edits', () => {
		const cost = computeImageTokenMeteredCost(
			{
				text_tokens: 40,
				cached_text_tokens: 0,
				image_input_tokens: 1000,
				cached_image_input_tokens: 0,
				image_output_tokens: 1767,
				total_tokens: 2807,
				raw_usage: null,
			},
			GPT_IMAGE_2_PRICES
		);
		const expected = (40 * 5 + 1000 * 8 + 1767 * 30) / 1_000_000;
		assert.ok(Math.abs(cost - expected) < 1e-12);
	});

	it('uses cached rates for cached portions', () => {
		const cost = computeImageTokenMeteredCost(
			{
				text_tokens: 100,
				cached_text_tokens: 40,
				image_input_tokens: 200,
				cached_image_input_tokens: 50,
				image_output_tokens: 0,
				total_tokens: 300,
				raw_usage: null,
			},
			GPT_IMAGE_2_PRICES
		);
		// uncached text 60*5 + cached text 40*1.25 + uncached img 150*8 + cached img 50*2
		const expected = (60 * 5 + 40 * 1.25 + 150 * 8 + 50 * 2) / 1_000_000;
		assert.ok(Math.abs(cost - expected) < 1e-12);
	});
});

describe('estimateImageOutputTokensForPrecheck', () => {
	it('uses exact table for known quality×size', () => {
		assert.equal(estimateImageOutputTokensForPrecheck('high', '1536x1024'), 5500);
	});

	it('takes upper bound for auto quality on GPT sizes', () => {
		assert.equal(estimateImageOutputTokensForPrecheck('auto', '1024x1024'), 7033);
	});

	it('uses Seedream typical tokens for 2K/4K aliases', () => {
		assert.equal(estimateImageOutputTokensForPrecheck(null, '2K'), SEEDREAM_TYPICAL_OUTPUT_TOKENS);
		assert.equal(
			estimateImageOutputTokensForPrecheck('auto', '4k'),
			SEEDREAM_TYPICAL_OUTPUT_TOKENS * 2
		);
	});

	it('uses Seedream-scale estimate for large explicit pixel sizes', () => {
		assert.equal(
			estimateImageOutputTokensForPrecheck('ultra', '4096x4096'),
			SEEDREAM_TYPICAL_OUTPUT_TOKENS * 2
		);
		assert.equal(
			estimateImageOutputTokensForPrecheck(null, '2048x2048'),
			SEEDREAM_TYPICAL_OUTPUT_TOKENS
		);
	});

	it('uses max of GPT and Seedream when both quality and size are auto', () => {
		assert.equal(
			estimateImageOutputTokensForPrecheck('auto', 'auto'),
			SEEDREAM_TYPICAL_OUTPUT_TOKENS
		);
	});
});

describe('buildImagePrecheckUsage', () => {
	it('scales edit image_input by reference count up to max', () => {
		const one = buildImagePrecheckUsage({
			quality: 'medium',
			size: '1024x1024',
			isEdit: true,
			imageCount: 1,
			referenceCount: 1,
		});
		assert.equal(one.image_input_tokens, IMAGE_PRECHECK_IMAGE_INPUT_TOKEN_HEADROOM);

		const five = buildImagePrecheckUsage({
			quality: 'medium',
			size: '1024x1024',
			isEdit: true,
			imageCount: 1,
			referenceCount: 5,
		});
		assert.equal(
			five.image_input_tokens,
			IMAGE_PRECHECK_MAX_REFERENCE_COUNT * IMAGE_PRECHECK_IMAGE_INPUT_TOKEN_HEADROOM
		);

		const omitted = buildImagePrecheckUsage({
			quality: 'medium',
			size: '1024x1024',
			isEdit: true,
			imageCount: 1,
		});
		assert.equal(omitted.image_input_tokens, five.image_input_tokens);
	});
});
