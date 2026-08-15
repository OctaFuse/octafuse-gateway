import { describe, expect, it } from 'vitest';
import {
	applyGeminiStreamQueryParams,
	buildGeminiUpstreamActionUrl,
	normalizeGeminiUpstreamBaseForAuthMatch,
	prepareGeminiUpstreamFetch,
	resolveGeminiUpstreamAuth,
} from './gemini-upstream-url';

describe('buildGeminiUpstreamActionUrl', () => {
	it('rejects empty base URL', () => {
		expect(() =>
			buildGeminiUpstreamActionUrl('', 'gemini-2.5-pro', 'generateContent')
		).toThrow(/base URL is empty/);
		expect(() =>
			buildGeminiUpstreamActionUrl('   ', 'gemini-2.5-pro', 'generateContent')
		).toThrow(/base URL is empty/);
	});

	it('rejects bare host without path prefix', () => {
		expect(() =>
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com',
				'gemini-2.5-pro',
				'streamGenerateContent'
			)
		).toThrow(/must include path prefix/);
		expect(() =>
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com/',
				'gemini-2.5-pro',
				'streamGenerateContent'
			)
		).toThrow(/must include path prefix/);
	});

	it('developer API full prefix', () => {
		expect(
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com/v1beta/models',
				'gemini-2.5-flash',
				'generateContent'
			)
		).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
		);
	});

	it('vertex express prefix', () => {
		expect(
			buildGeminiUpstreamActionUrl(
				'https://aiplatform.googleapis.com/v1/publishers/google/models',
				'gemini-2.5-flash',
				'streamGenerateContent'
			)
		).toBe(
			'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent'
		);
	});

	it('trims trailing slash from base URL', () => {
		expect(
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com/v1beta/models/',
				'gemini-2.5-flash',
				'generateContent'
			)
		).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
		);
	});

	it('encodes model name', () => {
		expect(
			buildGeminiUpstreamActionUrl(
				'https://generativelanguage.googleapis.com/v1beta/models',
				'model/with/slash',
				'generateContent'
			)
		).toContain('model%2Fwith%2Fslash');
	});

	it('collapses duplicate slashes in base path (qnaigc bypass/vertex)', () => {
		expect(
			buildGeminiUpstreamActionUrl(
				'https://api.qnaigc.com//bypass/vertex/v1/models',
				'gemini-3.1-flash-lite-preview',
				'streamGenerateContent'
			)
		).toBe(
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
		expect(u.searchParams.get('alt')).toBe('sse');
	});

	it('overrides existing alt for streamGenerateContent', () => {
		const u = new URL(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=json'
		);
		applyGeminiStreamQueryParams(u, 'streamGenerateContent');
		expect(u.searchParams.get('alt')).toBe('sse');
	});

	it('does not set alt for generateContent', () => {
		const u = new URL(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test'
		);
		applyGeminiStreamQueryParams(u, 'generateContent');
		expect(u.searchParams.has('alt')).toBe(false);
	});
});

describe('resolveGeminiUpstreamAuth', () => {
	it('defaults to query-key when auth is omitted', () => {
		expect(resolveGeminiUpstreamAuth()).toBe('query-key');
		expect(resolveGeminiUpstreamAuth(null)).toBe('query-key');
	});

	it('returns the configured scheme', () => {
		expect(resolveGeminiUpstreamAuth('query-key')).toBe('query-key');
		expect(resolveGeminiUpstreamAuth('bearer')).toBe('bearer');
	});

	it('normalizes trailing slash, host case, and duplicate slashes', () => {
		expect(
			normalizeGeminiUpstreamBaseForAuthMatch(
				'https://api.qnaigc.com//bypass/vertex/v1/models/'
			)
		).toBe('https://api.qnaigc.com/bypass/vertex/v1/models');
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
		expect(url.searchParams.get('key')).toBe('provider-key');
		expect(headers.Authorization).toBeUndefined();
	});

	it('uses Authorization Bearer when auth is bearer', () => {
		const { url, headers } = prepareGeminiUpstreamFetch({
			baseUrl: 'https://api.modelink.ai/bypass/vertex/v1/models',
			modelName: 'gemini-2.5-flash',
			action: 'generateContent',
			apiKey: 'provider-token',
			auth: 'bearer',
		});
		expect(url.searchParams.has('key')).toBe(false);
		expect(headers.Authorization).toBe('Bearer provider-token');
	});

	it('uses configured bearer on any host', () => {
		const { url, headers } = prepareGeminiUpstreamFetch({
			baseUrl: 'https://zenmux.ai/api/vertex-ai/v1/publishers/google/models',
			modelName: 'gemini-2.5-flash',
			action: 'generateContent',
			apiKey: 'zm-key',
			auth: 'bearer',
		});
		expect(url.searchParams.has('key')).toBe(false);
		expect(headers.Authorization).toBe('Bearer zm-key');
	});

	it('sets alt=sse for streamGenerateContent on bearer upstream', () => {
		const { url } = prepareGeminiUpstreamFetch({
			baseUrl: 'https://api.qnaigc.com/bypass/vertex/v1/models',
			modelName: 'gemini-2.5-flash',
			action: 'streamGenerateContent',
			apiKey: 'provider-token',
			auth: 'bearer',
		});
		expect(url.searchParams.get('alt')).toBe('sse');
		expect(url.searchParams.has('key')).toBe(false);
	});
});
