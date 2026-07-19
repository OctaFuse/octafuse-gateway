import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listStaticModelPresetCatalogForAdmin } from './models-service';

describe('import catalog pricing preview follows billing currency', () => {
	it('USD branch uses $ and usd tier amounts', () => {
		const row = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen3.8-max-preview');
		assert.ok(row);
		assert.equal(row!.pricing_label, '$2.5 / $7.5 /M');
		assert.match(row!.pricing_preview ?? '', /\$\/M/);
	});

	it('CNY branch uses ¥ and cny tier amounts', () => {
		const row = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen3.8-max-preview');
		assert.ok(row);
		assert.equal(row!.pricing_label, '¥12 / ¥36 /M');
		assert.match(row!.pricing_preview ?? '', /¥\/M/);
		assert.doesNotMatch(row!.pricing_preview ?? '', /\$\/M/);
	});
});
