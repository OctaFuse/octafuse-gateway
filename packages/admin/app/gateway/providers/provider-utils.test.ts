import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseProviderEndpoints } from '@octafuse/core/provider-endpoints';
import { listStaticProviderImportCatalogForAdmin } from '@/lib/provider-import-preset';
import {
	formDataToEndpointsMap,
	getProviderKeyStatus,
	providerMatchesListFilter,
	providerToFormData,
	tryCollapseGeminiLegacyEndpoints,
} from './provider-utils';
import { EMPTY_PROVIDER_FORM } from './types';
import type { GatewayProvider } from '@/lib/types';

function providerWithEndpoints(endpoints: unknown, extras: Partial<GatewayProvider> = {}): GatewayProvider {
	return {
		id: 'p1',
		name: 'P1',
		status: 'active',
		endpoints: JSON.stringify(endpoints),
		description: null,
		created_at: '',
		...extras,
	} as GatewayProvider;
}

describe('getProviderKeyStatus / providerMatchesListFilter', () => {
	it('classifies pending, disabled, no_key, and key_set', () => {
		assert.equal(
			getProviderKeyStatus(providerWithEndpoints({}, { has_pending_key: true, api_key: '(empty)' })),
			'pending'
		);
		assert.equal(
			getProviderKeyStatus(providerWithEndpoints({}, { status: 'disabled', api_key: 'sk-****' })),
			'disabled'
		);
		assert.equal(
			getProviderKeyStatus(providerWithEndpoints({}, { api_key: '(empty)' })),
			'no_key'
		);
		assert.equal(
			getProviderKeyStatus(providerWithEndpoints({}, { api_key: 'sk-****' })),
			'key_set'
		);
	});

	it('matches protocol and status filters', () => {
		const openai = providerWithEndpoints({
			openai: { base: 'https://api.openai.com/v1' },
		}, { api_key: 'sk-****' });
		assert.equal(providerMatchesListFilter(openai, 'openai'), true);
		assert.equal(providerMatchesListFilter(openai, 'anthropic'), false);
		assert.equal(providerMatchesListFilter(openai, 'active'), true);
		assert.equal(providerMatchesListFilter(openai, 'pending'), false);
	});
});

describe('tryCollapseGeminiLegacyEndpoints', () => {
	it('collapses URLs that differ only by trailing action', () => {
		assert.equal(
			tryCollapseGeminiLegacyEndpoints(
				'https://x.example/models/{model}:generateContent',
				'https://x.example/models/{model}:streamGenerateContent'
			),
			'https://x.example/models/{model}:{action}'
		);
	});

	it('returns null when hosts differ', () => {
		assert.equal(
			tryCollapseGeminiLegacyEndpoints(
				'https://a.example/models/{model}:generateContent',
				'https://b.example/models/{model}:streamGenerateContent'
			),
			null
		);
	});
});

describe('provider gemini form fold / round-trip', () => {
	it('folds compatible legacy keys into modelsGenerate', () => {
		const form = providerToFormData(
			providerWithEndpoints({
				gemini: {
					endpoints: {
						generateContent: 'https://x.example/models/{model}:generateContent',
						streamGenerateContent: 'https://x.example/models/{model}:streamGenerateContent',
					},
				},
			})
		);
		assert.equal(form.gemini.modelsGenerate, 'https://x.example/models/{model}:{action}');
		assert.equal(form.gemini.legacyPerAction, null);
		const map = formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, ...form, id: 'p1', name: 'P1', description: '' });
		assert.equal(map.gemini?.endpoints?.['models.generate'], 'https://x.example/models/{model}:{action}');
		assert.equal(map.gemini?.endpoints?.generateContent, undefined);
	});

	it('preserves incompatible legacy per-action URLs on save', () => {
		const form = providerToFormData(
			providerWithEndpoints({
				gemini: {
					endpoints: {
						generateContent: 'https://a.example/models/{model}:generateContent',
						streamGenerateContent: 'https://b.example/models/{model}:streamGenerateContent',
					},
				},
			})
		);
		assert.ok(form.gemini.legacyPerAction);
		const map = formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, ...form, id: 'p1', name: 'P1', description: '' });
		assert.equal(map.gemini?.endpoints?.generateContent, 'https://a.example/models/{model}:generateContent');
		assert.equal(
			map.gemini?.endpoints?.streamGenerateContent,
			'https://b.example/models/{model}:streamGenerateContent'
		);
		assert.equal(map.gemini?.endpoints?.['models.generate'], undefined);
	});

	it('round-trips gemini.auth and omits auto', () => {
		const form = providerToFormData(
			providerWithEndpoints({
				gemini: {
					base: 'https://zenmux.ai/api/vertex-ai/v1/publishers/google/models',
					auth: 'bearer',
				},
			})
		);
		assert.equal(form.gemini.auth, 'bearer');
		const map = formDataToEndpointsMap({
			...EMPTY_PROVIDER_FORM,
			...form,
			id: 'p1',
			name: 'P1',
			description: '',
		});
		assert.equal(map.gemini?.auth, 'bearer');
		const autoForm = {
			...form,
			gemini: { ...form.gemini, auth: 'auto' as const },
		};
		const autoMap = formDataToEndpointsMap({
			...EMPTY_PROVIDER_FORM,
			...autoForm,
			id: 'p1',
			name: 'P1',
			description: '',
		});
		assert.equal(autoMap.gemini?.auth, undefined);
	});
});

describe('Qiniu and ZenMux import presets', () => {
	it('prefill Gemini Vertex prefix with bearer auth', () => {
		const rows = listStaticProviderImportCatalogForAdmin();
		const qiniu = rows.find((row) => row.vendor_key === 'qiniu');
		const zenmux = rows.find((row) => row.vendor_key === 'zenmux');
		assert.ok(qiniu);
		assert.ok(zenmux);
		const qiniuMap = parseProviderEndpoints({ endpoints: qiniu.endpoints });
		const zenmuxMap = parseProviderEndpoints({ endpoints: zenmux.endpoints });
		assert.equal(qiniuMap.gemini?.base, 'https://api.qnaigc.com/bypass/vertex/v1/models');
		assert.equal(qiniuMap.gemini?.auth, 'bearer');
		assert.equal(
			zenmuxMap.gemini?.base,
			'https://zenmux.ai/api/vertex-ai/v1/publishers/google/models'
		);
		assert.equal(zenmuxMap.gemini?.auth, 'bearer');
	});
});
