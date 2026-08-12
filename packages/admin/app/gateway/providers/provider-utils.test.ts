import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	formDataToEndpointsMap,
	providerToFormData,
	tryCollapseGeminiLegacyEndpoints,
} from './provider-utils';
import { EMPTY_PROVIDER_FORM } from './types';
import type { GatewayProvider } from '@/lib/types';

function providerWithEndpoints(endpoints: unknown): GatewayProvider {
	return {
		id: 'p1',
		name: 'P1',
		status: 'active',
		endpoints: JSON.stringify(endpoints),
		description: null,
		created_at: '',
	} as GatewayProvider;
}

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
});
