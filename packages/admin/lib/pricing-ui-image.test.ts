import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCatalogImagePricingDisplay, summarizePricingAuditJson } from './pricing-ui';

describe('getCatalogImagePricingDisplay', () => {
	it('shows image token rates without estimate matrix', () => {
		const display = getCatalogImagePricingDisplay(
			{
				pricing_profile: JSON.stringify({
					image_billing_mode: 'token',
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
		assert.equal(display!.tokenRates?.imageOutput, '30');
		assert.equal(display!.tokenRates?.imageInput, '8');
		assert.equal(display!.defaultLine, '30 $/M');
	});

	it('shows authoritative per_image default price', () => {
		const display = getCatalogImagePricingDisplay(
			{
				pricing_profile: JSON.stringify({
					image_billing_mode: 'per_image',
					image: {
						default: 0.22,
						uncertain_result_policy: 'requested',
					},
				}),
			},
			'CNY'
		);
		assert.ok(display);
		assert.equal(display!.billingKind, 'image_per_image');
		assert.equal(display!.perImageDefault, '0.22');
		assert.equal(display!.defaultLine, '0.22 ¥/image');
	});

	it('returns null for legacy image-only block without mode', () => {
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

	it('summarizes image_per_image audit', () => {
		const line = summarizePricingAuditJson(
			JSON.stringify({
				v: 4,
				kind: 'image_per_image',
				input_image_count: 1,
				output_image_count: 2,
				output_unit_price: 0.22,
				input_unit_price: 0.05,
				result_confirmed: false,
				uncertain_result_policy: 'requested',
			})
		);
		assert.ok(line);
		assert.ok(line!.includes('image_per_image'));
		assert.ok(line!.includes('1 in / 2 out'));
		assert.ok(line!.includes('out 0.22/img'));
		assert.ok(line!.includes('uncertain'));
	});
});
