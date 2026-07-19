import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listStaticModelPresets } from '@/lib/model-preset';
import { listStaticModelPresetCatalogForAdmin } from './models-service';

const EXPECTED_IMAGE_IDS = [
	'doubao-seedream-5-0-260128',
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
});
