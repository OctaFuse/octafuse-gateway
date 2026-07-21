import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listStaticModelPresets } from '@/lib/model-preset';
import { listStaticModelPresetCatalogForAdmin } from './models-service';

const EXPECTED_IMAGE_IDS = [
	'doubao-seedream-5-0',
	'doubao-seedream-5-0-pro',
	'gemini-3.1-flash-image',
	'gemini-3-pro-image-preview',
	'glm-image',
	'gpt-image-2',
	'grok-imagine-image-quality',
].sort();

describe('static image model presets (*-image.json)', () => {
	it('every image-output preset has output modalities including image', () => {
		const imageRows = listStaticModelPresets().filter((r) =>
			(r.modalities?.output ?? []).includes('image')
		);
		assert.deepEqual(
			imageRows.map((r) => r.id).sort(),
			EXPECTED_IMAGE_IDS
		);
		for (const row of imageRows) {
			assert.ok(row.vendor, `vendor required for ${row.id}`);
			assert.equal((row.modalities?.output ?? []).includes('text'), false);
		}
	});

	it('Admin import catalog marks image kind for the same ids', () => {
		const imageCatalog = listStaticModelPresetCatalogForAdmin().filter((r) => r.kind === 'image');
		assert.deepEqual(
			imageCatalog.map((r) => r.id).sort(),
			EXPECTED_IMAGE_IDS
		);
	});

	it('locks official catalog unit prices (per_image + token)', () => {
		const byId = new Map(listStaticModelPresets().map((r) => [r.id, r]));

		const seedream = byId.get('doubao-seedream-5-0')!;
		assert.equal(seedream.pricing.cny.image_billing_mode, 'per_image');
		assert.equal((seedream.pricing.cny as { tiers?: unknown }).tiers, undefined);
		assert.equal(seedream.pricing.cny.image?.default, 0.22);
		assert.equal(seedream.pricing.usd.image?.default, 0.035);
		assert.equal(seedream.pricing.cny.image?.by_quality_size?.['flat:4k'], undefined);

		const seedreamPro = byId.get('doubao-seedream-5-0-pro')!;
		assert.equal(seedreamPro.pricing.cny.image?.default, 0.3);
		assert.equal(seedreamPro.pricing.cny.image?.by_size?.['3k'], 0.6);
		assert.equal(seedreamPro.pricing.cny.image?.input?.default, 0.02);
		assert.equal(seedreamPro.pricing.usd.image?.default, 0.045);
		assert.equal(seedreamPro.pricing.usd.image?.by_size?.['3k'], 0.09);
		assert.equal(seedreamPro.pricing.usd.image?.input?.default, 0.003);

		const glm = byId.get('glm-image')!;
		assert.equal(glm.pricing.cny.image?.default, 0.1);
		assert.equal(glm.pricing.usd.image?.default, 0.014);

		const grok = byId.get('grok-imagine-image-quality')!;
		assert.equal(grok.pricing.usd.image?.default, 0.05);
		assert.equal(grok.pricing.usd.image?.by_size?.['2k'], 0.07);
		assert.equal(grok.pricing.usd.image?.input?.default, 0.01);

		const gpt = byId.get('gpt-image-2')!;
		const gptTier = gpt.pricing.usd.tiers[0];
		assert.equal(gpt.pricing.usd.image_billing_mode, 'token');
		assert.equal(gptTier.input_price, 5);
		assert.equal(gptTier.image_input_price, 8);
		assert.equal(gptTier.image_output_price, 30);

		const flash = byId.get('gemini-3.1-flash-image')!;
		assert.equal(flash.pricing.usd.tiers[0].input_price, 0.5);
		assert.equal(flash.pricing.usd.tiers[0].output_price, 3);
		assert.equal(flash.pricing.usd.tiers[0].image_output_price, 60);

		const pro = byId.get('gemini-3-pro-image-preview')!;
		assert.equal(pro.pricing.usd.tiers[0].input_price, 2);
		assert.equal(pro.pricing.usd.tiers[0].output_price, 12);
		assert.equal(pro.pricing.usd.tiers[0].image_output_price, 120);
	});
});

