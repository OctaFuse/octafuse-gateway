/**
 * Tavily Extract API（https://api.tavily.com/extract）。
 */

import { WebFetchProviderError, type WebFetchParams, type WebFetchResult } from './types';

type TavilyExtractResult = {
	url?: string;
	raw_content?: string;
	content?: string;
	title?: string;
};

type TavilyRawResponse = {
	results?: TavilyExtractResult[];
	failed_results?: Array<{ url?: string; error?: string }>;
	detail?: { error?: string } | string;
	error?: string;
	message?: string;
};

const TAVILY_EXTRACT_ENDPOINT = 'https://api.tavily.com/extract';

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

export async function fetchTavilyUrl(params: WebFetchParams): Promise<WebFetchResult> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const response = await fetchImpl(TAVILY_EXTRACT_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			urls: [params.url],
		}),
	});

	const text = await response.text();
	let json: TavilyRawResponse;
	try {
		json = JSON.parse(text) as TavilyRawResponse;
	} catch {
		throw new WebFetchProviderError(
			`Tavily returned non-JSON (HTTP ${response.status})`,
			response.status || 502,
			'tavily'
		);
	}

	if (!response.ok) {
		throw new WebFetchProviderError(
			extractErrorMessage(json, `Tavily HTTP ${response.status}`),
			response.status,
			'tavily'
		);
	}

	const first = json.results?.[0];
	if (!first) {
		const failed = json.failed_results?.[0];
		const failMsg =
			typeof failed?.error === 'string' && failed.error.trim()
				? failed.error.trim()
				: 'Tavily extract returned no results';
		throw new WebFetchProviderError(failMsg, 502, 'tavily');
	}

	const content =
		(typeof first.raw_content === 'string' && first.raw_content.trim()
			? first.raw_content.trim()
			: undefined) ||
		(typeof first.content === 'string' && first.content.trim() ? first.content.trim() : undefined) ||
		'';
	if (!content) {
		throw new WebFetchProviderError('Tavily returned empty content', 502, 'tavily');
	}

	const title =
		typeof first.title === 'string' && first.title.trim() ? first.title.trim() : undefined;
	const finalUrl =
		typeof first.url === 'string' && first.url.trim() ? first.url.trim() : params.url;

	return { title, url: finalUrl, content };
}
