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

	it('includes official OpenAI/Anthropic endpoints for newly added import presets', () => {
		const rows = listStaticProviderImportPresets();
		const byName = new Map(rows.map((row) => [row.name, row]));
		const chatOf = (name: string) => byName.get(name)?.endpoints.openai?.endpoints?.chat;
		const openaiBaseOf = (name: string) => byName.get(name)?.endpoints.openai?.base;
		const anthropicBaseOf = (name: string) => byName.get(name)?.endpoints.anthropic?.base;

		assert.equal(
			chatOf('Command Code'),
			'https://api.commandcode.ai/provider/v1/chat/completions'
		);
		assert.equal(anthropicBaseOf('Command Code'), 'https://api.commandcode.ai/provider');
		assert.equal(chatOf('Cerebras'), 'https://api.cerebras.ai/v1/chat/completions');
		assert.equal(
			chatOf('Hugging Face Inference Providers'),
			'https://router.huggingface.co/v1/chat/completions'
		);
		assert.equal(openaiBaseOf('Vercel AI Gateway'), 'https://ai-gateway.vercel.sh/v1');
		assert.equal(anthropicBaseOf('Vercel AI Gateway'), 'https://ai-gateway.vercel.sh');
		assert.equal(chatOf('SambaNova Cloud'), 'https://api.sambanova.ai/v1/chat/completions');
		assert.equal(anthropicBaseOf('SambaNova Cloud'), 'https://api.sambanova.ai');
		assert.equal(
			chatOf('DeepInfra'),
			'https://api.deepinfra.com/v1/openai/chat/completions'
		);
		assert.equal(chatOf('Novita AI'), 'https://api.novita.ai/openai/v1/chat/completions');
		assert.equal(chatOf('Meta Model API'), 'https://api.meta.ai/v1/chat/completions');
		assert.equal(anthropicBaseOf('Meta Model API'), 'https://api.meta.ai');
		assert.equal(
			chatOf('Alibaba Cloud Bailian (International)'),
			'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'
		);
		assert.equal(
			byName.get('Alibaba Cloud Bailian (International)')?.endpoints.dashscope?.base,
			'https://dashscope-intl.aliyuncs.com/api/v1'
		);
		assert.equal(
			chatOf('Alibaba Cloud Bailian (Coding Plan International)'),
			'https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions'
		);
		assert.equal(
			anthropicBaseOf('Alibaba Cloud Bailian (Coding Plan International)'),
			'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic'
		);
		assert.equal(
			chatOf('BytePlus ModelArk'),
			'https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions'
		);
		assert.equal(
			chatOf('BytePlus ModelArk (Coding Plan)'),
			'https://ark.ap-southeast.bytepluses.com/api/coding/v3/chat/completions'
		);
		assert.equal(chatOf('SCNet'), 'https://api.scnet.cn/api/llm/v1/chat/completions');
		assert.equal(anthropicBaseOf('SCNet'), 'https://api.scnet.cn/api/llm/anthropic');
	});

	it('keeps Vertex Express on Gemini query-key and adds project-scoped OpenAI chat', () => {
		const rows = listStaticProviderImportPresets();
		const express = rows.find((row) => row.name === 'Google Vertex AI (Express Mode · API Key)');
		const projectScoped = rows.find((row) => row.name === 'Google Vertex AI (replace project ID)');

		assert.ok(express);
		assert.equal(
			express.endpoints.gemini?.base,
			'https://aiplatform.googleapis.com/v1/publishers/google/models'
		);
		assert.equal(express.endpoints.gemini?.auth, undefined);
		assert.equal(express.endpoints.openai, undefined);

		assert.ok(projectScoped);
		assert.equal(projectScoped.icon_key, 'vertexai');
		assert.equal(
			projectScoped.endpoints.openai?.endpoints?.chat,
			'https://aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/global/endpoints/openapi/chat/completions'
		);
		assert.equal(projectScoped.endpoints.openai?.base, undefined);
		assert.equal(
			projectScoped.endpoints.gemini?.base,
			'https://aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/global/publishers/google/models'
		);
		assert.equal(projectScoped.endpoints.gemini?.auth, 'bearer');
		assert.match(projectScoped.description ?? '', /service account JSON/i);
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
