import { describe, expect, it } from 'vitest';
import {
	applyGeminiStreamQueryParams,
	buildGeminiUpstreamActionUrl,
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
