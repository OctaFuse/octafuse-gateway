import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePricingProfile } from '@octafuse/core/db/pricing-profile';
import { listStaticModelPresets, pickPresetPricingRawForBillingCurrency } from '@/lib/model-preset';
import { coerceModelPricingProfileInput } from './pricing-input';
import { listStaticModelPresetCatalogForAdmin } from './models-service';

describe('import catalog pricing preview follows billing currency', () => {
	it('USD branch uses $ and usd tier amounts', () => {
		const row = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen3.8-max');
		assert.ok(row);
		assert.equal(row!.pricing_label, '$2.5 / $7.5 /M');
		assert.match(row!.pricing_preview ?? '', /\$\/M/);
	});

	it('CNY branch uses ¥ and cny tier amounts', () => {
		const row = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen3.8-max');
		assert.ok(row);
		assert.equal(row!.pricing_label, '¥12 / ¥36 /M');
		assert.match(row!.pricing_preview ?? '', /¥\/M/);
		assert.doesNotMatch(row!.pricing_preview ?? '', /\$\/M/);
	});

	it('includes glm-5.3 with GLM-5.2-aligned list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'glm-5.3');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'glm-5.3');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'GLM-5.3');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$1.4 / $4.4 /M');
		assert.equal(cny!.pricing_label, '¥8 / ¥28 /M');
	});

	it('includes glm-5.3-flash with official Z.AI and BigModel list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'glm-5.3-flash');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'glm-5.3-flash');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'GLM-5.3-Flash');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$0.15 / $0.5 /M');
		assert.equal(cny!.pricing_label, '¥0.8 / ¥2.8 /M');
	});

	it('includes hy4-preview with official TokenHub list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'hy4-preview');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'hy4-preview');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Hy4 preview');
		assert.equal(usd!.context_window, 1024000);
		assert.equal(usd!.max_tokens, 64000);
		assert.equal(usd!.pricing_label, '$0.834 / $2.501 /M');
		assert.equal(cny!.pricing_label, '¥6 / ¥18 /M');
	});

	it('includes qwen3.8-flash with official Model Studio list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen3.8-flash');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen3.8-flash');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Qwen3.8 Flash');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$0.16 / $0.47 /M');
		assert.equal(cny!.pricing_label, '¥1 / ¥3 /M');
	});
});

describe('import catalog localized model metadata', () => {
	it('provides English and Chinese descriptions for every static preset', () => {
		const rows = listStaticModelPresetCatalogForAdmin('USD');
		assert.ok(rows.length > 0);
		for (const row of rows) {
			assert.ok(row.description?.trim(), `${row.id}: English fallback`);
			assert.ok(row.i18n?.en.trim(), `${row.id}: English catalog description`);
			assert.ok(row.i18n?.zh.trim(), `${row.id}: Chinese catalog description`);
		}
	});
});

describe('static model presets do not seed tags', () => {
	it('omits tags so import does not write model_tags', () => {
		for (const preset of listStaticModelPresets()) {
			assert.equal(
				(preset as { tags?: unknown }).tags,
				undefined,
				`${preset.id}: presets must not include tags`
			);
		}
	});
});

const DEEPSEEK_V4_PEAK_SCHEDULE = [
	{ start: '09:00', end: '12:00', factor: 2, days: [1, 2, 3, 4, 5] },
	{ start: '14:00', end: '18:00', factor: 2, days: [1, 2, 3, 4, 5] },
];

describe('static preset import writes catalog schedule', () => {
	it('keeps DeepSeek V4 official peak windows on both currency branches', () => {
		for (const id of ['deepseek-v4-pro', 'deepseek-v4-flash']) {
			const preset = listStaticModelPresets().find((p) => p.id === id);
			assert.ok(preset, id);
			for (const billing of ['USD', 'CNY'] as const) {
				const json = coerceModelPricingProfileInput(
					pickPresetPricingRawForBillingCurrency(preset!, billing)
				);
				assert.ok(json, `${id} ${billing}`);
				const profile = parsePricingProfile(json!);
				assert.ok(profile, `${id} ${billing} parsed`);
				assert.deepEqual(profile!.schedule, DEEPSEEK_V4_PEAK_SCHEDULE, `${id} ${billing}`);
			}
		}
	});

	it('does not invent a schedule for DeepSeek V3.2', () => {
		const preset = listStaticModelPresets().find((p) => p.id === 'deepseek-v3.2');
		assert.ok(preset);
		const json = coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'));
		assert.ok(json);
		assert.deepEqual(parsePricingProfile(json!)?.schedule, []);
	});
});
