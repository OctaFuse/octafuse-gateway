import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPlaygroundGeminiUpstreamRequest } from './playground-service';

describe('buildPlaygroundGeminiUpstreamRequest', () => {
	it('uses query key for official Gemini upstream', () => {
		const result = buildPlaygroundGeminiUpstreamRequest(
			'https://generativelanguage.googleapis.com/v1beta/models',
			'gemini-2.5-flash',
			'generateContent',
			'provider-key'
		);
		const u = new URL(result.url);
		assert.equal(u.searchParams.get('key'), 'provider-key');
		assert.equal(result.headers.Authorization, undefined);
	});

	it('uses Authorization Bearer for bypass/vertex upstream', () => {
		const result = buildPlaygroundGeminiUpstreamRequest(
			'https://api.qnaigc.com//bypass/vertex/v1/models',
			'gemini-2.5-flash',
			'streamGenerateContent',
			'provider-token'
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
