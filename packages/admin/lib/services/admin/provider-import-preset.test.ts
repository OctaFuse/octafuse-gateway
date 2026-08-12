import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	inferStaticProviderIconKey,
	inferStaticProviderVendorKey,
	listStaticProviderImportPresets,
} from '@/lib/provider-import-preset';
import type { ProviderEndpointsMap } from '@octafuse/core/provider-endpoints';

function replaceEndpointPaths(endpoints: ProviderEndpointsMap): ProviderEndpointsMap {
	const copy = structuredClone(endpoints);
	for (const config of Object.values(copy)) {
		const replacePath = (rawUrl: string): string => {
			const url = new URL(rawUrl);
			url.pathname = '/custom/gateway/v1';
			url.search = '';
			url.hash = '';
			return url.toString().replace(/\/$/, '');
		};
		if (config?.base) config.base = replacePath(config.base);
		for (const capability of Object.keys(config?.endpoints ?? {})) {
			const key = capability as keyof NonNullable<typeof config.endpoints>;
			const rawUrl = config?.endpoints?.[key];
			if (rawUrl && config?.endpoints) config.endpoints[key] = replacePath(rawUrl);
		}
	}
	return copy;
}

describe('provider import preset catalog metadata', () => {
	it('includes the limited Qwen Token Plan DashScope audio endpoints', () => {
		const qwenTokenPlan = listStaticProviderImportPresets().find(
			(row) => row.name === 'Qwen AI Platform (Token Plan)'
		);
		assert.ok(qwenTokenPlan);
		assert.deepEqual(qwenTokenPlan.endpoints.dashscope?.endpoints, {
			'audio.speech':
				'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
			'audio.realtime.inference':
				'wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
			'audio.realtime.session':
				'wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime',
		});
	});

	it('keeps localized catalog copy and an official platform link for every preset', () => {
		const rows = listStaticProviderImportPresets();

		assert.ok(rows.length > 0);
		for (const row of rows) {
			assert.ok(row.catalog?.i18n.zh.name.trim(), row.name);
			assert.ok(row.catalog?.i18n.zh.description.trim(), row.name);
			assert.ok(row.catalog?.i18n.en.name.trim(), row.name);
			assert.ok(row.catalog?.i18n.en.description.trim(), row.name);
			assert.match(row.catalog?.links?.platform ?? '', /^https:\/\//, row.name);
			if (row.catalog?.links?.api_keys) {
				assert.match(row.catalog.links.api_keys, /^https:\/\//, row.name);
			}
		}
	});

	it('infers an imported Provider vendor without storing a database column', () => {
		const rows = listStaticProviderImportPresets();
		const deepseek = rows.find((row) => row.name === 'DeepSeek');
		assert.ok(deepseek);

		assert.equal(inferStaticProviderVendorKey({ name: deepseek.name }), 'deepseek');
		assert.equal(inferStaticProviderVendorKey({ name: `${deepseek.name} (2)` }), 'deepseek');
		assert.equal(
			inferStaticProviderVendorKey({
				name: 'Renamed production upstream',
				endpoints: deepseek.endpoints,
			}),
			'deepseek'
		);
		assert.equal(
			inferStaticProviderVendorKey({
				name: 'Private upstream',
				endpoints: {
					openai: { endpoints: { chat: 'https://example.com/v1/chat/completions' } },
				},
			}),
			'other'
		);
	});

	it('prefers a product icon over the parent vendor logo without storing a database column', () => {
		const rows = listStaticProviderImportPresets();
		const mimo = rows.find((row) => row.name === 'Xiaomi MiMo');
		assert.ok(mimo);

		assert.equal(mimo.vendor_key, 'xiaomi');
		assert.equal(mimo.icon_key, 'xiaomimimo');
		assert.equal(inferStaticProviderIconKey({ name: mimo.name }), 'xiaomimimo');
		assert.equal(
			inferStaticProviderIconKey({
				name: 'Renamed MiMo upstream',
				endpoints: mimo.endpoints,
				vendor_key: mimo.vendor_key,
			}),
			'xiaomimimo'
		);
		assert.equal(inferStaticProviderIconKey({ name: 'Private upstream', vendor_key: 'openai' }), 'openai');
	});

	it('recognizes every preset by hostname even when its name and URL paths are customized', () => {
		for (const row of listStaticProviderImportPresets()) {
			const expectedIcon = row.icon_key ?? row.vendor_key;
			const provider = {
				name: 'Renamed production upstream',
				endpoints: replaceEndpointPaths(row.endpoints),
			};
			assert.equal(inferStaticProviderVendorKey(provider), row.vendor_key, row.name);
			assert.equal(
				inferStaticProviderIconKey({ ...provider, vendor_key: row.vendor_key }),
				expectedIcon,
				row.name
			);
		}
	});

	it('recognizes a catalog product from base URL or a localized custom name', () => {
		const bailianBaseOnly = {
			name: '百炼-谷仓',
			endpoints: {
				openai: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
			},
		} satisfies { name: string; endpoints: ProviderEndpointsMap };
		assert.equal(inferStaticProviderVendorKey(bailianBaseOnly), 'aliyun');
		assert.equal(inferStaticProviderIconKey(bailianBaseOnly), 'bailian');

		const proxiedMimo = {
			name: '小米 MiMo 私有代理',
			endpoints: {
				openai: { base: 'https://llm.example.com/v1' },
			},
		} satisfies { name: string; endpoints: ProviderEndpointsMap };
		assert.equal(inferStaticProviderVendorKey(proxiedMimo), 'xiaomi');
		assert.equal(inferStaticProviderIconKey(proxiedMimo), 'xiaomimimo');
	});

	it('includes the DashScope base needed to derive Alibaba audio endpoints', () => {
		const bailian = listStaticProviderImportPresets().find(
			(row) => row.name === 'Alibaba Cloud Bailian'
		);
		assert.ok(bailian);
		assert.equal(bailian.endpoints.dashscope?.base, 'https://dashscope.aliyuncs.com/api/v1');
	});

	it('does not guess when configured endpoints identify different vendors', () => {
		const conflicting = {
			name: 'Mixed upstream',
			endpoints: {
				openai: { base: 'https://api.openai.com/v1' },
				anthropic: { base: 'https://api.anthropic.com' },
			},
		} satisfies { name: string; endpoints: ProviderEndpointsMap };

		assert.equal(inferStaticProviderVendorKey(conflicting), 'other');
		assert.equal(inferStaticProviderIconKey(conflicting), 'other');
	});
});
