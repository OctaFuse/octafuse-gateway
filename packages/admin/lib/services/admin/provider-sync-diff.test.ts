import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listStaticProviderImportPresets } from '@/lib/provider-import-preset';
import { buildProviderSyncPatch, diffProviderAgainstPreset } from '@/lib/provider-sync-diff';

const preset = {
	description: 'Official description',
	endpoints: {
		openai: { endpoints: { chat: 'https://api.example.com/v1/chat/completions' } },
		anthropic: { base: 'https://api.example.com/anthropic' },
	},
};

describe('diffProviderAgainstPreset', () => {
	it('returns no fields when provider matches the preset', () => {
		const fields = diffProviderAgainstPreset(
			{ description: 'Official description', endpoints: JSON.stringify(preset.endpoints) },
			preset
		);
		assert.deepEqual(fields, []);
	});

	it('treats blank and null descriptions as equal and ignores surrounding whitespace', () => {
		assert.deepEqual(
			diffProviderAgainstPreset(
				{ description: '  Official description \n', endpoints: preset.endpoints },
				preset
			),
			[]
		);
		assert.deepEqual(
			diffProviderAgainstPreset(
				{ description: '   ', endpoints: preset.endpoints },
				{ ...preset, description: null }
			),
			[]
		);
	});

	it('reports a changed description and defaults to using the official value', () => {
		const [field] = diffProviderAgainstPreset(
			{ description: 'Old', endpoints: preset.endpoints },
			preset
		);
		assert.equal(field.key, 'description');
		assert.equal(field.status, 'changed');
		assert.equal(field.default_apply, true);
		assert.equal(field.key === 'description' && field.current, 'Old');
		assert.equal(field.key === 'description' && field.official, 'Official description');
	});

	it('keeps a local-only description by default', () => {
		const [field] = diffProviderAgainstPreset(
			{ description: 'Mine', endpoints: preset.endpoints },
			{ ...preset, description: null }
		);
		assert.equal(field.status, 'removed');
		assert.equal(field.default_apply, false);
	});

	it('reports per-protocol endpoint rows for changed URLs', () => {
		const fields = diffProviderAgainstPreset(
			{
				description: preset.description,
				endpoints: {
					openai: { endpoints: { chat: 'https://proxy.local/v1/chat/completions' } },
					anthropic: preset.endpoints.anthropic,
				},
			},
			preset
		);
		assert.equal(fields.length, 1);
		const [field] = fields;
		assert.equal(field.key, 'endpoints.openai');
		assert.equal(field.status, 'changed');
		assert.deepEqual(
			field.key === 'endpoints.openai' ? field.rows : [],
			[
				{
					slot: 'chat',
					status: 'changed',
					current: 'https://proxy.local/v1/chat/completions',
					official: 'https://api.example.com/v1/chat/completions',
				},
			]
		);
	});

	it('reports a protocol added by the official template', () => {
		const [field] = diffProviderAgainstPreset(
			{ description: preset.description, endpoints: { openai: preset.endpoints.openai } },
			preset
		);
		assert.equal(field.key, 'endpoints.anthropic');
		assert.equal(field.status, 'added');
		assert.equal(field.default_apply, true);
	});

	it('reports a protocol that only exists locally and keeps it by default', () => {
		const [field] = diffProviderAgainstPreset(
			{
				description: preset.description,
				endpoints: {
					...preset.endpoints,
					gemini: { base: 'https://gemini.local' },
				},
			},
			preset
		);
		assert.equal(field.key, 'endpoints.gemini');
		assert.equal(field.status, 'removed');
		assert.equal(field.default_apply, false);
	});

	it('detects base vs per-capability differences and gemini auth changes', () => {
		const [field] = diffProviderAgainstPreset(
			{ description: null, endpoints: { gemini: { base: 'https://g.example.com', auth: 'bearer' } } },
			{ description: null, endpoints: { gemini: { base: 'https://g.example.com' } } }
		);
		assert.equal(field.key, 'endpoints.gemini');
		assert.deepEqual(
			field.key === 'endpoints.gemini' ? field.rows.map((r) => [r.slot, r.status]) : [],
			[['auth', 'removed']]
		);
	});

	it('treats filled Vertex and Azure deployment slots as already matching the template', () => {
		const presets = listStaticProviderImportPresets();
		const vertex = presets.find((row) => row.name === 'Google Vertex AI');
		const azure = presets.find((row) => row.name === 'Azure OpenAI');
		assert.ok(vertex);
		assert.ok(azure);

		const vertexFilled = JSON.parse(
			JSON.stringify(vertex.endpoints).replaceAll('YOUR_PROJECT_ID', 'p-mhjphev1')
		) as typeof vertex.endpoints;
		assert.deepEqual(
			diffProviderAgainstPreset(
				{ description: vertex.description, endpoints: vertexFilled },
				vertex
			),
			[]
		);

		const vertexRegional = JSON.parse(
			JSON.stringify(vertexFilled).replaceAll('/locations/global/', '/locations/us-central1/')
		) as typeof vertex.endpoints;
		assert.deepEqual(
			diffProviderAgainstPreset(
				{ description: vertex.description, endpoints: vertexRegional },
				vertex
			),
			[]
		);

		const azureFilled = JSON.parse(
			JSON.stringify(azure.endpoints).replaceAll('YOUR_RESOURCE_NAME', 'contoso')
		) as typeof azure.endpoints;
		assert.deepEqual(
			diffProviderAgainstPreset({ description: azure.description, endpoints: azureFilled }, azure),
			[]
		);

		const foundryFilled = JSON.parse(
			JSON.stringify(azure.endpoints).replaceAll(
				'YOUR_RESOURCE_NAME.openai.azure.com',
				'soloent-east-us-2-resource.services.ai.azure.com'
			)
		) as typeof azure.endpoints;
		assert.deepEqual(
			diffProviderAgainstPreset({ description: azure.description, endpoints: foundryFilled }, azure),
			[]
		);
	});

	it('still flags an Azure base that is missing the OpenAI v1 path', () => {
		const azure = listStaticProviderImportPresets().find((row) => row.name === 'Azure OpenAI');
		assert.ok(azure);
		const legacy = JSON.parse(
			JSON.stringify(azure.endpoints).replaceAll('/openai/v1', '/openai').replaceAll('YOUR_RESOURCE_NAME', 'contoso')
		) as typeof azure.endpoints;
		const fields = diffProviderAgainstPreset(
			{ description: azure.description, endpoints: legacy },
			azure
		);
		assert.deepEqual(
			fields.map((field) => field.key),
			['endpoints.openai']
		);
		assert.equal(fields[0]?.key === 'endpoints.openai' && fields[0].rows[0]?.slot, 'base');
	});

	it('still flags a deployment URL whose path no longer matches the template', () => {
		const vertex = listStaticProviderImportPresets().find((row) => row.name === 'Google Vertex AI');
		assert.ok(vertex);
		const endpoints = JSON.parse(
			JSON.stringify(vertex.endpoints).replaceAll('YOUR_PROJECT_ID', 'p-mhjphev1')
		) as {
			openai: { endpoints: { chat: string } };
			gemini: { base: string; auth?: string };
		};
		endpoints.openai.endpoints.chat = endpoints.openai.endpoints.chat.replace(
			'/endpoints/openapi/chat/completions',
			'/endpoints/openapi/v2/chat/completions'
		);
		const fields = diffProviderAgainstPreset(
			{ description: vertex.description, endpoints },
			vertex
		);
		assert.deepEqual(
			fields.map((field) => field.key),
			['endpoints.openai']
		);
		assert.equal(fields[0]?.key === 'endpoints.openai' && fields[0].rows[0]?.slot, 'chat');
	});

	it('is a no-op for every bundled preset compared with itself', () => {
		for (const row of listStaticProviderImportPresets()) {
			assert.deepEqual(
				diffProviderAgainstPreset({ description: row.description, endpoints: row.endpoints }, row),
				[],
				row.name
			);
		}
	});
});

describe('buildProviderSyncPatch', () => {
	const provider = {
		description: 'Old',
		endpoints: JSON.stringify({
			openai: { endpoints: { chat: 'https://proxy.local/chat' } },
			gemini: { base: 'https://gemini.local' },
		}),
	};

	it('only applies the selected fields', () => {
		const patch = buildProviderSyncPatch(provider, preset, ['description']);
		assert.deepEqual(patch, { description: 'Official description' });
	});

	it('replaces selected protocols and keeps the others untouched', () => {
		const patch = buildProviderSyncPatch(provider, preset, ['endpoints.openai', 'endpoints.anthropic']);
		assert.equal(patch.description, undefined);
		assert.deepEqual(patch.endpoints, {
			openai: { endpoints: { chat: 'https://api.example.com/v1/chat/completions' } },
			anthropic: { base: 'https://api.example.com/anthropic' },
			gemini: { base: 'https://gemini.local' },
		});
	});

	it('removes a local-only protocol when it is selected', () => {
		const patch = buildProviderSyncPatch(provider, preset, ['endpoints.gemini']);
		assert.deepEqual(Object.keys(patch.endpoints ?? {}).sort(), ['openai']);
	});

	it('ignores unknown keys and keys that no longer differ', () => {
		const synced = { description: preset.description, endpoints: preset.endpoints };
		assert.deepEqual(buildProviderSyncPatch(synced, preset, ['description', 'endpoints.openai']), {});
		assert.deepEqual(buildProviderSyncPatch(provider, preset, ['name', 'api_key', 'endpoints.nope']), {});
	});

	it('keeps a filled Vertex project and region when applying a real path change', () => {
		const vertex = listStaticProviderImportPresets().find((row) => row.name === 'Google Vertex AI');
		assert.ok(vertex);
		const current = JSON.parse(
			JSON.stringify(vertex.endpoints)
				.replaceAll('YOUR_PROJECT_ID', 'p-mhjphev1')
				.replaceAll('/locations/global/', '/locations/us-central1/')
		) as {
			openai: { endpoints: { chat: string } };
			gemini: { base: string; auth: string };
		};
		const official = JSON.parse(JSON.stringify(vertex.endpoints)) as typeof vertex.endpoints;
		const officialOpenAi = official.openai?.endpoints;
		assert.ok(officialOpenAi?.chat);
		officialOpenAi.chat = officialOpenAi.chat.replace(
			'/endpoints/openapi/chat/completions',
			'/endpoints/openapi/v2/chat/completions'
		);
		officialOpenAi.responses =
			'https://aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/global/endpoints/openapi/v2/responses';

		const patch = buildProviderSyncPatch(
			{ description: vertex.description, endpoints: current },
			{ description: vertex.description, endpoints: official },
			['endpoints.openai']
		);
		assert.equal(
			patch.endpoints?.openai?.endpoints?.chat,
			'https://aiplatform.googleapis.com/v1/projects/p-mhjphev1/locations/us-central1/endpoints/openapi/v2/chat/completions'
		);
		assert.equal(
			patch.endpoints?.openai?.endpoints?.responses,
			'https://aiplatform.googleapis.com/v1/projects/p-mhjphev1/locations/us-central1/endpoints/openapi/v2/responses'
		);
		assert.equal(patch.endpoints?.gemini?.base, current.gemini.base);
	});

	it('keeps the Foundry host when applying the OpenAI v1 path', () => {
		const azure = listStaticProviderImportPresets().find((row) => row.name === 'Azure OpenAI');
		assert.ok(azure);
		const patch = buildProviderSyncPatch(
			{
				description: azure.description,
				endpoints: {
					openai: { base: 'https://soloent-east-us-2-resource.services.ai.azure.com/openai' },
				},
			},
			azure,
			['endpoints.openai']
		);
		assert.equal(
			patch.endpoints?.openai?.base,
			'https://soloent-east-us-2-resource.services.ai.azure.com/openai/v1'
		);
	});

	it('can clear the description when the official one is empty', () => {
		const patch = buildProviderSyncPatch(
			{ description: 'Mine', endpoints: preset.endpoints },
			{ ...preset, description: null },
			['description']
		);
		assert.deepEqual(patch, { description: null });
	});
});
