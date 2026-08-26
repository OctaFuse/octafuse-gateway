import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listStaticModelPresets } from '@/lib/model-preset';
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
