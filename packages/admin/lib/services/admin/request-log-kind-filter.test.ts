import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requestLogKindMatchGroups, requestLogKindsNeedCatalog } from './request-log-kind-filter';

const catalog = [
	{ id: 'gpt-5', kind: 'llm' as const },
	{ id: 'gpt-image-1', kind: 'image' as const },
	{ id: 'tts-1', kind: 'tts' as const },
	{ id: 'whisper-1', kind: 'asr' as const },
];
const invocationProviders = ['octafuse-tools', 'octafuse-mcp'];
const nonLlmCatalog = { image: ['gpt-image-1'], tts: ['tts-1'], asr: ['whisper-1'] };

describe('request log kind filter', () => {
	it('does not filter when nothing or everything is selected', () => {
		assert.equal(requestLogKindMatchGroups([], catalog), undefined);
		assert.equal(requestLogKindMatchGroups(['mcp', 'model', 'tool'], catalog), undefined);
	});

	it('keeps model requests by excluding the two tool providers', () => {
		assert.deepEqual(requestLogKindMatchGroups(['model'], catalog), [{ excludeProviderIds: invocationProviders }]);
	});

	it('passes the selected model kinds with the non-LLM part of the catalog', () => {
		assert.equal(requestLogKindsNeedCatalog(['model', 'tool:web-search']), false);
		assert.equal(requestLogKindsNeedCatalog(['model:image']), true);
		assert.deepEqual(requestLogKindMatchGroups(['model:tts', 'model:llm'], catalog), [
			{
				excludeProviderIds: invocationProviders,
				modelKinds: { kinds: ['llm', 'tts'], catalog: nonLlmCatalog },
			},
		]);
	});

	it('unions tools and MCP servers with model requests', () => {
		assert.deepEqual(
			requestLogKindMatchGroups(['mcp:docs', 'tool:web-fetch', 'model:image', 'tool:web-search', 'mcp:wiki'], catalog),
			[
				{ excludeProviderIds: invocationProviders, modelKinds: { kinds: ['image'], catalog: nonLlmCatalog } },
				{ providerIds: ['octafuse-tools'], modelIds: ['tool:web-search', 'tool:web-fetch'] },
				{ providerIds: ['octafuse-mcp'], modelIdPrefix: 'mcp:docs/' },
				{ providerIds: ['octafuse-mcp'], modelIdPrefix: 'mcp:wiki/' },
			],
		);
		assert.deepEqual(requestLogKindMatchGroups(['tool', 'mcp', 'tool:web-search'], catalog), [
			{ providerIds: ['octafuse-tools'] },
			{ providerIds: ['octafuse-mcp'] },
		]);
	});
});
