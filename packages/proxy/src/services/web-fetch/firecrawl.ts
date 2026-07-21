/**
 * Firecrawl Scrape API（https://api.firecrawl.dev/v1/scrape）。
 */

import { WebFetchProviderError, type WebFetchParams, type WebFetchResult } from './types';

type FirecrawlRawResponse = {
	success?: boolean;
	data?: {
		markdown?: string;
		metadata?: {
			title?: string;
			sourceURL?: string;
			url?: string;
		};
	};
	error?: string;
	message?: string;
};

const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v1/scrape';

function extractErrorMessage(json: FirecrawlRawResponse, fallback: string): string {
	if (typeof json.error === 'string' && json.error.trim()) {
		return json.error.trim();
	}
	if (typeof json.message === 'string' && json.message.trim()) {
		return json.message.trim();
	}
	return fallback;
}

export async function fetchFirecrawlUrl(params: WebFetchParams): Promise<WebFetchResult> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const response = await fetchImpl(FIRECRAWL_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			url: params.url,
			formats: ['markdown'],
		}),
	});

	const text = await response.text();
	let json: FirecrawlRawResponse;
	try {
		json = JSON.parse(text) as FirecrawlRawResponse;
	} catch {
		throw new WebFetchProviderError(
			`Firecrawl returned non-JSON (HTTP ${response.status})`,
			response.status || 502,
			'firecrawl'
		);
	}

	if (!response.ok) {
		throw new WebFetchProviderError(
			extractErrorMessage(json, `Firecrawl HTTP ${response.status}`),
			response.status,
			'firecrawl'
		);
	}

	const markdown = json.data?.markdown?.trim() ?? '';
	if (!markdown) {
		throw new WebFetchProviderError('Firecrawl returned empty content', 502, 'firecrawl');
	}

	const meta = json.data?.metadata;
	const title =
		typeof meta?.title === 'string' && meta.title.trim() ? meta.title.trim() : undefined;
	const finalUrl =
		(typeof meta?.sourceURL === 'string' && meta.sourceURL.trim()
			? meta.sourceURL.trim()
			: undefined) ||
		(typeof meta?.url === 'string' && meta.url.trim() ? meta.url.trim() : undefined) ||
		params.url;

	return { title, url: finalUrl, content: markdown };
}
