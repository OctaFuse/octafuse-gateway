import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlaygroundResolvedRoute } from './playground-service';
import { buildPlaygroundGeminiUpstreamRequest } from './playground-service';

function route(base: string, apiKey: string): PlaygroundResolvedRoute {
	return {
		upstreamProtocol: 'gemini',
		providerEndpoints: { gemini: { base } },
		providerId: 'p1',
		providerApiKey: apiKey,
		providerModelName: 'gemini-2.5-flash',
		customParams: null,
		providerKeyId: 'k1',
		providerKeyLabel: 'default',
		isImageModel: false,
	};
}

describe('buildPlaygroundGeminiUpstreamRequest', () => {
	it('uses query key for official Gemini upstream', () => {
		const result = buildPlaygroundGeminiUpstreamRequest(
			route('https://generativelanguage.googleapis.com/v1beta/models', 'provider-key'),
			'generateContent'
		);
		const u = new URL(result.url);
		assert.equal(u.searchParams.get('key'), 'provider-key');
		assert.equal(result.headers.Authorization, undefined);
	});

	it('uses Authorization Bearer for bypass/vertex upstream', () => {
		const result = buildPlaygroundGeminiUpstreamRequest(
			route('https://api.qnaigc.com//bypass/vertex/v1/models', 'provider-token'),
			'streamGenerateContent'
		);
		const u = new URL(result.url);
		assert.equal(
			u.pathname,
			'/bypass/vertex/v1/models/gemini-2.5-flash:streamGenerateContent'
		);
		assert.equal(u.searchParams.has('key'), false);
		assert.equal(u.searchParams.get('alt'), 'sse');
		assert.equal(result.headers.Authorization, 'Bearer provider-token');
	});
});
