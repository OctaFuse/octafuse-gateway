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
				'doubao-seedream-5-0-flash',
				'doubao-seedream-5-0-pro',
			].sort()
		);
		assert.equal(
			ids.every((id) => id.startsWith('doubao-')),
			true
		);
	});

	it('Volcengine Ark template keeps OpenAI chat and Seedream on volcengine.base', () => {
		const ark = listStaticProviderImportPresets().find((p) => p.name === 'Volcengine Ark');
		assert.ok(ark);
		assert.equal(ark!.endpoints.openai?.base, undefined);
		assert.equal(
			ark!.endpoints.openai?.endpoints?.chat,
			'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
		);
		assert.equal(ark!.endpoints.openai?.endpoints?.['images.generations'], undefined);
		assert.equal(ark!.endpoints.openai?.endpoints?.['images.edits'], undefined);
		assert.equal(ark!.endpoints.volcengine?.base, 'https://ark.cn-beijing.volces.com/api/v3');
		const byteplus = listStaticProviderImportPresets().find((p) => p.name === 'BytePlus ModelArk');
		assert.ok(byteplus);
		assert.equal(byteplus!.endpoints.openai?.base, undefined);
		assert.equal(byteplus!.endpoints.openai?.endpoints?.['images.generations'], undefined);
		assert.equal(byteplus!.endpoints.volcengine?.base, 'https://ark.ap-southeast.bytepluses.com/api/v3');
	});
});
