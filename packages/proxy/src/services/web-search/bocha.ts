/**
 * 博查 Web Search API 客户端（https://api.bochaai.com/v1/web-search）。
 */

import { clampCount, filterResults, normalizeHost } from './domain-filter';
import { WebSearchProviderError, type WebSearchParams, type WebSearchResult } from './types';

type BochaRawPage = {
	name?: string;
	url?: string;
	snippet?: string;
	summary?: string;
	siteName?: string;
	datePublished?: string;
};

type BochaRawResponse = {
	code?: number;
	msg?: string;
	message?: string;
	data?: {
		webPages?: {
			value?: BochaRawPage[];
		};
	};
};

const BOCHA_ENDPOINT = 'https://api.bochaai.com/v1/web-search';

export async function searchBochaWeb(params: WebSearchParams): Promise<WebSearchResult[]> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const count = clampCount(params.count);
	const body: Record<string, unknown> = {
		query: params.query,
		freshness: 'noLimit',
		summary: true,
		count,
	};
	// 博查 include/exclude：用 | 连接；失败时仍可依赖本地过滤
	if (params.allowedDomains?.length) {
		body.include = params.allowedDomains.map(normalizeHost).filter(Boolean).join('|');
	} else if (params.blockedDomains?.length) {
		body.exclude = params.blockedDomains.map(normalizeHost).filter(Boolean).join('|');
	}

	const response = await fetchImpl(BOCHA_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const text = await response.text();
	let json: BochaRawResponse;
	try {
		json = JSON.parse(text) as BochaRawResponse;
	} catch {
		throw new WebSearchProviderError(
			`Bocha returned non-JSON (HTTP ${response.status})`,
			response.status || 502,
			'bocha'
		);
	}

	if (!response.ok) {
		const msg = json.msg || json.message || `Bocha HTTP ${response.status}`;
		throw new WebSearchProviderError(msg, response.status, 'bocha');
	}

	// 博查成功码多为 200；部分错误也会 HTTP 200 + code != 200
	if (typeof json.code === 'number' && json.code !== 200) {
		throw new WebSearchProviderError(
			json.msg || json.message || `Bocha error code ${json.code}`,
			502,
			'bocha'
		);
	}

	const pages = json.data?.webPages?.value ?? [];
	const mapped: WebSearchResult[] = pages
		.filter((p) => typeof p.url === 'string' && p.url.trim())
		.map((p) => ({
			title: (p.name || p.url || '').trim(),
			url: (p.url || '').trim(),
			snippet: p.snippet?.trim() || undefined,
			summary: p.summary?.trim() || undefined,
			siteName: p.siteName?.trim() || undefined,
			datePublished: p.datePublished?.trim() || undefined,
		}));

	return filterResults(mapped, params.allowedDomains, params.blockedDomains);
}
