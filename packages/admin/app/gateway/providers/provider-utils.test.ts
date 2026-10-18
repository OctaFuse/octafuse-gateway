import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseProviderEndpoints } from '@octafuse/core/provider-endpoints';
import { listStaticProviderImportCatalogForAdmin } from '@/lib/provider-import-preset';
import {
	providerApiKeyPreview,
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
		note: null,
		created_at: '',
		...extras,
	} as GatewayProvider;
}

describe('getProviderKeyStatus / providerMatchesListFilter', () => {
	it('classifies the key only, including when the provider is disabled', () => {
		assert.equal(
			getProviderKeyStatus(providerWithEndpoints({}, { has_pending_key: true, api_key: '(empty)' })),
			'pending'
		);
		assert.equal(
			getProviderKeyStatus(providerWithEndpoints({}, { status: 'disabled', api_key: 'sk-****' })),
			'key_set'
		);
		assert.equal(
			getProviderKeyStatus(providerWithEndpoints({}, { status: 'disabled', api_key: '(empty)' })),
			'no_key'
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
		const map = formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, ...form, id: 'p1', name: 'P1', note: '' });
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
		const map = formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, ...form, id: 'p1', name: 'P1', note: '' });
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
			note: '',
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
			note: '',
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


describe('providerApiKeyPreview', () => {
	it('shows only the first three and last four characters with a fixed middle mask', () => {
		assert.equal(providerApiKeyPreview('sk-1234567890abcdef'), 'sk-••••••••••••cdef');
		assert.equal(providerApiKeyPreview('  tok-1234567890  '), 'tok••••••••••••7890');
	});

	it('does not reveal any part of short credentials', () => {
		for (const key of ['a', 'abcd', '12345678']) assert.equal(providerApiKeyPreview(key), '••••••••••••');
	});

	it('keeps an empty field empty instead of showing a fake credential', () => {
		assert.equal(providerApiKeyPreview(''), '');
		assert.equal(providerApiKeyPreview('   '), '');
	});

	it('shows the service-account identity without exposing its private key', () => {
		const credential = JSON.stringify({ type: 'service_account', client_email: 'test@example.com', private_key: '-----BEGIN PRIVATE KEY-----\nprivate-test-material\n-----END PRIVATE KEY-----' });
		assert.equal(providerApiKeyPreview(credential), 'sa:test@example.com');
		assert.equal(providerApiKeyPreview(credential).includes('private-test-material'), false);
	});
});
