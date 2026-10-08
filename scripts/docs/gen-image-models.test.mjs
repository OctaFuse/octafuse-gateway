import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
	DOC_PATH,
	loadImagePresets,
	renderImageModelsBlock,
	replaceGeneratedBlock,
} from './gen-image-models.mjs';

describe('image-models.md generated catalog', () => {
	it('matches the static model presets', () => {
		const doc = readFileSync(DOC_PATH, 'utf8');
		const next = replaceGeneratedBlock(doc, renderImageModelsBlock(loadImagePresets()));
		assert.equal(doc, next, 'image-models.md is stale; run `npm run docs:image-models`');
	});

	it('rejects image vendors without a vendor doc', () => {
		assert.throws(
			() =>
				renderImageModelsBlock([
					{
						id: 'x',
						display_name: 'X',
						vendor: 'unknown',
						presetFile: 'x.json',
						pricing: { usd: { image_billing_mode: 'per_image', image: { default: 1 } } },
					},
				]),
			/VENDOR_DOCS/
		);
	});
});
