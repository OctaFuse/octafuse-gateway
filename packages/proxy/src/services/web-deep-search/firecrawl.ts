/**
 * Firecrawl Search API（搜 + 可选正文）：https://api.firecrawl.dev/v1/search
 */

import {
	clampDeepSearchCount,
	WebDeepSearchProviderError,
	type WebDeepSearchParams,
	type WebDeepSearchResult,
} from './types';

type FirecrawlSearchItem = {
	title?: string;
	url?: string;
	description?: string;
	markdown?: string;
	content?: string;
};

type FirecrawlRawResponse = {
	success?: boolean;
	data?: FirecrawlSearchItem[] | { web?: FirecrawlSearchItem[] };
	error?: string;
	message?: string;
};

const FIRECRAWL_SEARCH_ENDPOINT = 'https://api.firecrawl.dev/v1/search';

function extractErrorMessage(json: FirecrawlRawResponse, fallback: string): string {
	if (typeof json.error === 'string' && json.error.trim()) {
		return json.error.trim();
	}
	if (typeof json.message === 'string' && json.message.trim()) {
		return json.message.trim();
	}
	return fallback;
}

function normalizeItems(data: FirecrawlRawResponse['data']): FirecrawlSearchItem[] {
	if (!data) {
		return [];
	}
	if (Array.isArray(data)) {
		return data;
	}
	if (typeof data === 'object' && Array.isArray(data.web)) {
		return data.web;
	}
	return [];
}

export async function deepSearchFirecrawl(params: WebDeepSearchParams): Promise<WebDeepSearchResult[]> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const limit = clampDeepSearchCount(params.count);
	const response = await fetchImpl(FIRECRAWL_SEARCH_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			query: params.query,
			limit,
			// 请求结果带 markdown 正文（deep search）
			scrapeOptions: { formats: ['markdown'] },
		}),
	});

	const text = await response.text();
	let json: FirecrawlRawResponse;
	try {
		json = JSON.parse(text) as FirecrawlRawResponse;
	} catch {
		throw new WebDeepSearchProviderError(
			`Firecrawl returned non-JSON (HTTP ${response.status})`,
			response.status || 502,
			'firecrawl'
		);
	}

	if (!response.ok) {
		throw new WebDeepSearchProviderError(
			extractErrorMessage(json, `Firecrawl HTTP ${response.status}`),
			response.status,
			'firecrawl'
		);
	}

	const items = normalizeItems(json.data);
	return items
		.filter((p) => typeof p.url === 'string' && p.url.trim())
		.map((p) => {
			const content =
				(typeof p.markdown === 'string' && p.markdown.trim() ? p.markdown.trim() : undefined) ||
				(typeof p.content === 'string' && p.content.trim() ? p.content.trim() : undefined);
			const snippet =
				typeof p.description === 'string' && p.description.trim()
					? p.description.trim()
					: content?.slice(0, 240);
			return {
				title: (p.title || p.url || '').trim(),
				url: (p.url || '').trim(),
				snippet,
				content,
			};
		});
}
