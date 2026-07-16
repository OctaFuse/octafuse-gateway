/**
 * Tavily Web Search API 客户端（https://api.tavily.com/search）。
 */

import { clampCount, filterResults, normalizeHost } from './domain-filter';
import { WebSearchProviderError, type WebSearchParams, type WebSearchResult } from './types';

type TavilyRawResult = {
	title?: string;
	url?: string;
	content?: string;
	published_date?: string;
};

type TavilyRawResponse = {
	results?: TavilyRawResult[];
	detail?: { error?: string } | string;
	error?: string;
	message?: string;
};

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

function extractErrorMessage(json: TavilyRawResponse, fallback: string): string {
	if (typeof json.error === 'string' && json.error.trim()) {
		return json.error.trim();
	}
	if (typeof json.message === 'string' && json.message.trim()) {
		return json.message.trim();
	}
	if (typeof json.detail === 'string' && json.detail.trim()) {
		return json.detail.trim();
	}
	if (json.detail && typeof json.detail === 'object' && typeof json.detail.error === 'string') {
		return json.detail.error.trim() || fallback;
	}
	return fallback;
}

export async function searchTavilyWeb(params: WebSearchParams): Promise<WebSearchResult[]> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const maxResults = clampCount(params.count);
	const body: Record<string, unknown> = {
		query: params.query,
		max_results: maxResults,
		search_depth: 'basic',
	};
	if (params.allowedDomains?.length) {
		body.include_domains = params.allowedDomains.map(normalizeHost).filter(Boolean);
	} else if (params.blockedDomains?.length) {
		body.exclude_domains = params.blockedDomains.map(normalizeHost).filter(Boolean);
	}

	const response = await fetchImpl(TAVILY_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const text = await response.text();
	let json: TavilyRawResponse;
	try {
		json = JSON.parse(text) as TavilyRawResponse;
	} catch {
		throw new WebSearchProviderError(
			`Tavily returned non-JSON (HTTP ${response.status})`,
			response.status || 502,
			'tavily'
		);
	}

	if (!response.ok) {
		throw new WebSearchProviderError(
			extractErrorMessage(json, `Tavily HTTP ${response.status}`),
			response.status,
			'tavily'
		);
	}

	const pages = json.results ?? [];
	const mapped: WebSearchResult[] = pages
		.filter((p) => typeof p.url === 'string' && p.url.trim())
		.map((p) => {
			const content = p.content?.trim() || undefined;
			return {
				title: (p.title || p.url || '').trim(),
				url: (p.url || '').trim(),
				snippet: content,
				summary: content,
				datePublished: p.published_date?.trim() || undefined,
			};
		});

	return filterResults(mapped, params.allowedDomains, params.blockedDomains);
}
