import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyGeminiStreamQueryParams,
	buildGeminiUpstreamActionUrl,
	normalizeGeminiUpstreamBaseForAuthMatch,
	prepareGeminiUpstreamFetch,
	resolveGeminiUpstreamAuth,
} from './gemini-upstream-url';

describe('buildGeminiUpstreamActionUrl', () => {
	it('rejects empty base URL', () => {
		assert.throws(() =>
			buildGeminiUpstreamActionUrl('', 'gemini-2.5-pro', 'generateContent')
		, /base URL is empty/);
		assert.throws(() =>
			buildGeminiUpstreamActionUrl('   ', 'gemini-2.5-pro', 'generateContent')
		, /base URL is empty/);
	});

	it('rejects bare host without path prefix', () => {
		assert.throws(() =>
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com',
				'gemini-2.5-pro',
				'streamGenerateContent'
			)
		, /must include path prefix/);
		assert.throws(() =>
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com/',
				'gemini-2.5-pro',
				'streamGenerateContent'
			)
		, /must include path prefix/);
	});

	it('developer API full prefix', () => {
		assert.equal(
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com/v1beta/models',
				'gemini-2.5-flash',
				'generateContent'
			)
		, 
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
		);
	});

	it('vertex express prefix', () => {
		assert.equal(
			buildGeminiUpstreamActionUrl(
				'https://aiplatform.googleapis.com/v1/publishers/google/models',
				'gemini-2.5-flash',
				'streamGenerateContent'
			)
		, 
			'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent'
		);
	});

	it('trims trailing slash from base URL', () => {
		assert.equal(
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com/v1beta/models/',
				'gemini-2.5-flash',
				'generateContent'
			)
		, 
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
		);
	});

	it('encodes model name', () => {
		assert.ok(
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com/v1beta/models',
				'model/with/slash',
				'generateContent'
			)
		.includes('model%2Fwith%2Fslash'));
	});

	it('collapses duplicate slashes in base path (qnaigc bypass/vertex)', () => {
		assert.equal(
			buildGeminiUpstreamActionUrl(
				'https://api.qnaigc.com//bypass/vertex/v1/models',
				'gemini-3.1-flash-lite-preview',
				'streamGenerateContent'
			)
		, 
			'https://api.qnaigc.com/bypass/vertex/v1/models/gemini-3.1-flash-lite-preview:streamGenerateContent'
		);
	});
});

describe('applyGeminiStreamQueryParams', () => {
	it('sets alt=sse for streamGenerateContent', () => {
		const u = new URL(
			'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?key=test'
		);
		applyGeminiStreamQueryParams(u, 'streamGenerateContent');
		assert.equal(u.searchParams.get('alt'), 'sse');
	});

	it('overrides existing alt for streamGenerateContent', () => {
		const u = new URL(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=json'
		);
		applyGeminiStreamQueryParams(u, 'streamGenerateContent');
		assert.equal(u.searchParams.get('alt'), 'sse');
	});

	it('does not set alt for generateContent', () => {
		const u = new URL(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test'
		);
		applyGeminiStreamQueryParams(u, 'generateContent');
		assert.equal(u.searchParams.has('alt'), false);
	});
});

describe('resolveGeminiUpstreamAuth', () => {
	it('defaults to query-key when auth is omitted', () => {
		assert.equal(resolveGeminiUpstreamAuth(), 'query-key');
		assert.equal(resolveGeminiUpstreamAuth(null), 'query-key');
	});

	it('returns the configured scheme', () => {
		assert.equal(resolveGeminiUpstreamAuth('query-key'), 'query-key');
		assert.equal(resolveGeminiUpstreamAuth('bearer'), 'bearer');
	});

	it('normalizes trailing slash, host case, and duplicate slashes', () => {
		assert.equal(
			normalizeGeminiUpstreamBaseForAuthMatch(
				'https://api.qnaigc.com//bypass/vertex/v1/models/'
			)
		, 'https://api.qnaigc.com/bypass/vertex/v1/models');
	});
});

describe('prepareGeminiUpstreamFetch', () => {
	it('uses query key for official Gemini upstream', () => {
		const { url, headers } = prepareGeminiUpstreamFetch({
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
			modelName: 'gemini-2.5-flash',
			action: 'generateContent',
			apiKey: 'provider-key',
		});
		assert.equal(url.searchParams.get('key'), 'provider-key');
		assert.equal(headers.Authorization, undefined);
	});

	it('uses Authorization Bearer when auth is bearer', () => {
		const { url, headers } = prepareGeminiUpstreamFetch({
			baseUrl: 'https://api.modelink.ai/bypass/vertex/v1/models',
			modelName: 'gemini-2.5-flash',
			action: 'generateContent',
			apiKey: 'provider-token',
			auth: 'bearer',
		});
		assert.equal(url.searchParams.has('key'), false);
		assert.equal(headers.Authorization, 'Bearer provider-token');
	});

	it('uses configured bearer on any host', () => {
		const { url, headers } = prepareGeminiUpstreamFetch({
			baseUrl: 'https://zenmux.ai/api/vertex-ai/v1/publishers/google/models',
			modelName: 'gemini-2.5-flash',
			action: 'generateContent',
			apiKey: 'zm-key',
			auth: 'bearer',
		});
		assert.equal(url.searchParams.has('key'), false);
		assert.equal(headers.Authorization, 'Bearer zm-key');
	});

	it('sets alt=sse for streamGenerateContent on bearer upstream', () => {
		const { url } = prepareGeminiUpstreamFetch({
			baseUrl: 'https://api.qnaigc.com/bypass/vertex/v1/models',
			modelName: 'gemini-2.5-flash',
			action: 'streamGenerateContent',
			apiKey: 'provider-token',
			auth: 'bearer',
		});
		assert.equal(url.searchParams.get('alt'), 'sse');
		assert.equal(url.searchParams.has('key'), false);
	});
});
