import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCatalogImagePricingDisplay, summarizePricingAuditJson } from './pricing-ui';

describe('getCatalogImagePricingDisplay', () => {
	it('shows image token rates and estimate matrix', () => {
		const display = getCatalogImagePricingDisplay(
			{
				pricing_profile: JSON.stringify({
					tiers: [
						{
							upto: null,
							input_price: 5,
							output_price: 0,
							cache_read_price: 1.25,
							image_input_price: 8,
							image_input_cache_price: 2,
							image_output_price: 30,
						},
					],
				}),
			},
			'USD'
		);
		assert.ok(display);
		assert.equal(display!.billingKind, 'image_tokens');
		assert.equal(display!.tokenRates.imageOutput, '30');
		assert.equal(display!.matrixIsEstimate, true);
		assert.ok(display!.matrix);
		assert.equal(display!.matrix!.cells.high?.['1536x1024'], '0.165');
	});

	it('includes Seedream flat×2k estimate row', () => {
		const display = getCatalogImagePricingDisplay(
			{
				pricing_profile: JSON.stringify({
					tiers: [
						{
							upto: null,
							input_price: 0,
							output_price: 0,
							image_output_price: 13.43,
						},
					],
				}),
			},
			'CNY'
		);
		assert.ok(display);
		assert.ok(display!.matrix?.cells.flat?.['2k']);
		// 16384 * 13.43 / 1e6 ≈ 0.22
		const flat2k = Number(display!.matrix!.cells.flat!['2k']);
		assert.ok(Math.abs(flat2k - 0.22) < 0.001);
	});

	it('returns null for legacy per-image-only profiles', () => {
		const display = getCatalogImagePricingDisplay(
			{
				pricing_profile: JSON.stringify({
					tiers: [{ upto: null, input_price: 0, output_price: 0 }],
					image: {
						default: 0.053,
						by_quality_size: { 'high:1536x1024': 0.165 },
					},
				}),
			},
			'USD'
		);
		assert.equal(display, null);
	});
});

describe('summarizePricingAuditJson', () => {
	it('summarizes image_tokens audit', () => {
		const line = summarizePricingAuditJson(
			JSON.stringify({
				v: 4,
				kind: 'image_tokens',
				quality: 'high',
				size: '1536x1024',
				tokens: { text: 20, image_input: 0, image_output: 5500 },
				snapshot: { user_charge: { source: 'model_x_factor', effective_factor: 1.2 } },
			})
		);
		assert.ok(line);
		assert.ok(line!.includes('image_tokens'));
		assert.ok(line!.includes('text/img-in/img-out 20/0/5500'));
		assert.ok(line!.includes('high×1536x1024'));
		assert.ok(line!.includes('×1.2'));
	});
});
