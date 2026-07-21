import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ParsedPricingProfile } from '@octafuse/core/db/pricing-profile';
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

/** Preset JSON pricing shape used by catalog price locks (may omit `tiers`). */
type PresetPricingJson = Partial<ParsedPricingProfile> & {
	tiers?: ParsedPricingProfile['tiers'];
};

const asPricing = (raw: unknown): PresetPricingJson => raw as PresetPricingJson;

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
		const seedreamCny = asPricing(seedream.pricing.cny);
		const seedreamUsd = asPricing(seedream.pricing.usd);
		assert.equal(seedreamCny.image_billing_mode, 'per_image');
		assert.equal(seedreamCny.tiers, undefined);
		assert.equal(seedreamCny.image?.default, 0.22);
		assert.equal(seedreamUsd.image?.default, 0.035);
		assert.equal(seedreamCny.image?.by_quality_size?.['flat:4k'], undefined);

		const seedreamPro = byId.get('doubao-seedream-5-0-pro')!;
		const seedreamProCny = asPricing(seedreamPro.pricing.cny);
		const seedreamProUsd = asPricing(seedreamPro.pricing.usd);
		assert.equal(seedreamProCny.image?.default, 0.3);
		assert.equal(seedreamProCny.image?.by_size?.['3k'], 0.6);
		assert.equal(seedreamProCny.image?.input?.default, 0.02);
		assert.equal(seedreamProUsd.image?.default, 0.045);
		assert.equal(seedreamProUsd.image?.by_size?.['3k'], 0.09);
		assert.equal(seedreamProUsd.image?.input?.default, 0.003);

		const glm = byId.get('glm-image')!;
		assert.equal(asPricing(glm.pricing.cny).image?.default, 0.1);
		assert.equal(asPricing(glm.pricing.usd).image?.default, 0.014);

		const grok = byId.get('grok-imagine-image-quality')!;
		const grokUsd = asPricing(grok.pricing.usd);
		assert.equal(grokUsd.image?.default, 0.05);
		assert.equal(grokUsd.image?.by_size?.['2k'], 0.07);
		assert.equal(grokUsd.image?.input?.default, 0.01);

		const gpt = byId.get('gpt-image-2')!;
		const gptUsd = asPricing(gpt.pricing.usd);
		const gptTier = gptUsd.tiers?.[0];
		assert.ok(gptTier);
		assert.equal(gptUsd.image_billing_mode, 'token');
		assert.equal(gptTier.input_price, 5);
		assert.equal(gptTier.image_input_price, 8);
		assert.equal(gptTier.image_output_price, 30);

		const flash = byId.get('gemini-3.1-flash-image')!;
		const flashTier = asPricing(flash.pricing.usd).tiers?.[0];
		assert.ok(flashTier);
		assert.equal(flashTier.input_price, 0.5);
		assert.equal(flashTier.output_price, 3);
		assert.equal(flashTier.image_output_price, 60);

		const pro = byId.get('gemini-3-pro-image-preview')!;
		const proTier = asPricing(pro.pricing.usd).tiers?.[0];
		assert.ok(proTier);
		assert.equal(proTier.input_price, 2);
		assert.equal(proTier.output_price, 12);
		assert.equal(proTier.image_output_price, 120);
	});
});

