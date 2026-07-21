import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listStaticModelPresetCatalogForAdmin } from './models-service';
import { listStaticProviderImportPresets } from '@/lib/provider-import-preset';

describe('Seedream catalog + Volcengine Ark provider preset', () => {
	it('uses official Volcengine model ids for all bytedance presets', () => {
		const rows = listStaticModelPresetCatalogForAdmin().filter((r) => r.vendor === 'bytedance');
		const ids = rows.map((r) => r.id);
		assert.deepEqual(
			ids.sort(),
			[
				'doubao-seed-2-0-lite-260215',
				'doubao-seed-2-0-mini-260215',
				'doubao-seed-2-0-pro-260215',
				'doubao-seed-2-1-pro-260628',
				'doubao-seed-2-1-turbo-260628',
				'doubao-seed-evolving',
				'doubao-seedream-5-0',
				'doubao-seedream-5-0-pro',
			].sort()
		);
		assert.equal(
			ids.every((id) => id.startsWith('doubao-')),
			true
		);
	});

	it('Volcengine Ark template uses capability URLs only (no base → no derived edits)', () => {
		const ark = listStaticProviderImportPresets().find((p) => p.name === 'Volcengine Ark');
		assert.ok(ark);
		assert.equal(ark!.endpoints.openai?.base, undefined);
		assert.equal(
			ark!.endpoints.openai?.endpoints?.chat,
			'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
		);
		assert.equal(
			ark!.endpoints.openai?.endpoints?.['images.generations'],
			'https://ark.cn-beijing.volces.com/api/v3/images/generations'
		);
		assert.equal(ark!.endpoints.openai?.endpoints?.['images.edits'], undefined);
	});
});
