import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deepSearchByProvider } from '../web-deep-search/dispatch';
import { WebDeepSearchProviderError } from '../web-deep-search/types';
import { fetchUrlByProvider } from '../web-fetch/dispatch';
import { WebFetchProviderError } from '../web-fetch/types';
import { searchWebByProvider } from '../web-search/dispatch';
import { WebSearchProviderError } from '../web-search/types';
import { DEEPSEEK_QUERY_MAX_CHARS, truncateDeepSeekQuery } from './client';

type Captured = { url: string; init: RequestInit; body: Record<string, unknown> };

function mockFetch(status: number, payload: unknown, captured: Captured[] = []): typeof fetch {
	return (async (url: string | URL | Request, init?: RequestInit) => {
		captured.push({
			url: String(url),
			init: init ?? {},
			body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
		});
		const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
		return new Response(text, { status });
	}) as typeof fetch;
}

const item = (n: number, host = 'example.com') => ({
	rerank_score: 2,
	title: `T${n}`,
	url: `https://${host}/p${n}`,
	snippet: `snippet ${n}`,
	summary: `summary ${n}`,
	content: `content ${n}`,
	site_name: 'Example',
	site_icon: null,
	date: '2026-06-01T00:00:00+00:00',
	authority: 3,
});

describe('truncateDeepSeekQuery', () => {
	it('trims and keeps short queries', () => {
		assert.equal(truncateDeepSeekQuery('  hello  '), 'hello');
	});

	it('truncates by Unicode characters, not UTF-16 units', () => {
		const q = '𠮷'.repeat(200);
		const out = truncateDeepSeekQuery(q);
		assert.equal([...out].length, DEEPSEEK_QUERY_MAX_CHARS);
	});
});

describe('deepseek web-search', () => {
	it('maps fields and sends bearer auth', async () => {
		const cap: Captured[] = [];
		const results = await searchWebByProvider('deepseek', {
			apiKey: 'sk-test',
			query: 'deepseek v4',
			count: 3,
			fetchImpl: mockFetch(200, { results: [item(1)] }, cap),
		});
		assert.equal(cap[0].url, 'https://api.deepseek.com/v1/tools/search');
		assert.equal((cap[0].init.headers as Record<string, string>).Authorization, 'Bearer sk-test');
		assert.deepEqual(cap[0].body, { query: 'deepseek v4', count: 3 });
		assert.deepEqual(results, [
			{
				title: 'T1',
				url: 'https://example.com/p1',
				snippet: 'snippet 1',
				summary: 'summary 1',
				siteName: 'Example',
				datePublished: '2026-06-01T00:00:00+00:00',
			},
		]);
	});

	it('truncates over-long queries to 128 characters', async () => {
		const cap: Captured[] = [];
		await searchWebByProvider('deepseek', {
			apiKey: 'k',
			query: 'a'.repeat(300),
			fetchImpl: mockFetch(200, { results: [] }, cap),
		});
		assert.equal([...String(cap[0].body.query)].length, 128);
	});

	it('appends site: operators for allowed domains when they fit', async () => {
		const cap: Captured[] = [];
		await searchWebByProvider('deepseek', {
			apiKey: 'k',
			query: 'ts release',
			count: 5,
			allowedDomains: ['https://github.com/x', 'typescriptlang.org'],
			fetchImpl: mockFetch(200, { results: [] }, cap),
		});
		assert.equal(cap[0].body.query, 'ts release site:github.com OR site:typescriptlang.org');
		assert.equal(cap[0].body.count, 5);
	});

	it('appends -site: operators for blocked domains', async () => {
		const cap: Captured[] = [];
		await searchWebByProvider('deepseek', {
			apiKey: 'k',
			query: 'ts release',
			blockedDomains: ['a.com', 'b.com'],
			fetchImpl: mockFetch(200, { results: [] }, cap),
		});
		assert.equal(cap[0].body.query, 'ts release -site:a.com -site:b.com');
	});

	it('falls back to count 50 + local filter when operators do not fit', async () => {
		const cap: Captured[] = [];
		const items = [
			...Array.from({ length: 6 }, (_, i) => item(i, 'keep.com')),
			...Array.from({ length: 6 }, (_, i) => item(i + 10, 'other.com')),
		];
		const results = await searchWebByProvider('deepseek', {
			apiKey: 'k',
			query: 'q'.repeat(125),
			count: 4,
			allowedDomains: ['keep.com'],
			fetchImpl: mockFetch(200, { results: items }, cap),
		});
		assert.equal(cap[0].body.query, 'q'.repeat(125));
		assert.equal(cap[0].body.count, 50);
		assert.equal(results.length, 4);
		assert.ok(results.every((r) => r.url.includes('keep.com')));
	});

	it('returns empty array for empty results', async () => {
		const results = await searchWebByProvider('deepseek', {
			apiKey: 'k',
			query: 'nothing',
			fetchImpl: mockFetch(200, { results: [] }),
		});
		assert.deepEqual(results, []);
	});

	it('maps upstream errors', async () => {
		const err = (status: number) =>
			searchWebByProvider('deepseek', {
				apiKey: 'k',
				query: 'q',
				fetchImpl: mockFetch(status, { error: { message: 'boom' } }),
			});
		await assert.rejects(err(400), (e: unknown) => e instanceof WebSearchProviderError && e.status === 400 && e.message === 'boom');
		await assert.rejects(err(401), (e: unknown) => e instanceof WebSearchProviderError && e.status === 401);
		await assert.rejects(err(402), (e: unknown) => e instanceof WebSearchProviderError && e.status === 401);
		await assert.rejects(err(429), (e: unknown) => e instanceof WebSearchProviderError && e.status === 502);
		await assert.rejects(err(500), (e: unknown) => e instanceof WebSearchProviderError && e.status === 502 && e.provider === 'deepseek');
	});
});

describe('deepseek web-deep-search', () => {
	it('requests need_content and maps content/snippet', async () => {
		const cap: Captured[] = [];
		const results = await deepSearchByProvider('deepseek', {
			apiKey: 'k',
			query: 'q',
			count: 2,
			fetchImpl: mockFetch(
				200,
				{
					results: [
						item(1),
						{ title: 'No snippet', url: 'https://a.com/x', snippet: '', summary: 's'.repeat(500), content: '   ' },
					],
				},
				cap
			),
		});
		assert.deepEqual(cap[0].body, { query: 'q', count: 2, need_content: true });
		assert.equal(results[0].content, 'content 1');
		assert.equal(results[0].snippet, 'snippet 1');
		assert.equal(results[1].content, undefined);
		assert.equal(results[1].snippet?.length, 240);
	});

	it('clamps count to the deep search maximum', async () => {
		const cap: Captured[] = [];
		await deepSearchByProvider('deepseek', {
			apiKey: 'k',
			query: 'q',
			count: 99,
			fetchImpl: mockFetch(200, { results: [] }, cap),
		});
		assert.equal(cap[0].body.count, 10);
	});

	it('throws WebDeepSearchProviderError on upstream failure', async () => {
		await assert.rejects(
			deepSearchByProvider('deepseek', {
				apiKey: 'k',
				query: 'q',
				fetchImpl: mockFetch(504, { error: { message: 'timeout' } }),
			}),
			(e: unknown) => e instanceof WebDeepSearchProviderError && e.status === 502
		);
	});
});

describe('deepseek web-fetch', () => {
	it('maps title and markdown content, keeps requested url', async () => {
		const cap: Captured[] = [];
		const result = await fetchUrlByProvider('deepseek', {
			apiKey: 'k',
			url: 'https://example.com/a',
			fetchImpl: mockFetch(200, { title: ' Hello ', content: '# Hello\n\nbody ' }, cap),
		});
		assert.equal(cap[0].url, 'https://api.deepseek.com/v1/tools/fetch');
		assert.deepEqual(cap[0].body, { url: 'https://example.com/a' });
		assert.deepEqual(result, { title: 'Hello', url: 'https://example.com/a', content: '# Hello\n\nbody' });
	});

	it('empty title becomes undefined', async () => {
		const result = await fetchUrlByProvider('deepseek', {
			apiKey: 'k',
			url: 'https://example.com/a',
			fetchImpl: mockFetch(200, { title: '', content: 'x' }),
		});
		assert.equal(result.title, undefined);
	});

	it('throws on empty content', async () => {
		await assert.rejects(
			fetchUrlByProvider('deepseek', {
				apiKey: 'k',
				url: 'https://example.com/a',
				fetchImpl: mockFetch(200, { title: 't', content: '  ' }),
			}),
			(e: unknown) => e instanceof WebFetchProviderError && e.status === 502
		);
	});

	it('maps upstream status codes', async () => {
		const err = (status: number) =>
			fetchUrlByProvider('deepseek', {
				apiKey: 'k',
				url: 'https://example.com/a',
				fetchImpl: mockFetch(status, { error: { message: 'upstream msg' } }),
			});
		await assert.rejects(err(400), (e: unknown) => e instanceof WebFetchProviderError && e.status === 400);
		await assert.rejects(err(401), (e: unknown) => e instanceof WebFetchProviderError && e.status === 401);
		await assert.rejects(err(402), (e: unknown) => e instanceof WebFetchProviderError && e.status === 401);
		await assert.rejects(
			err(403),
			(e: unknown) => e instanceof WebFetchProviderError && e.status === 502 && /security policy/.test(e.message)
		);
		await assert.rejects(
			err(404),
			(e: unknown) => e instanceof WebFetchProviderError && e.status === 502 && /usable content/.test(e.message)
		);
		await assert.rejects(err(429), (e: unknown) => e instanceof WebFetchProviderError && e.status === 502);
	});

	it('handles non-JSON error bodies', async () => {
		await assert.rejects(
			fetchUrlByProvider('deepseek', {
				apiKey: 'k',
				url: 'https://example.com/a',
				fetchImpl: mockFetch(500, '<html>oops</html>'),
			}),
			(e: unknown) => e instanceof WebFetchProviderError && e.status === 502 && /HTTP 500/.test(e.message)
		);
	});
});
