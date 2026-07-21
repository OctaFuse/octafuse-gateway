/**
 * Jina Reader（https://r.jina.ai/）— Bearer 为 Admin 配置的 API Key。
 */

import { WebFetchProviderError, type WebFetchParams, type WebFetchResult } from './types';

type JinaRawResponse = {
	data?: {
		title?: string;
		url?: string;
		content?: string;
	};
	code?: number;
	status?: number;
	message?: string;
	error?: string;
};

const JINA_ENDPOINT = 'https://r.jina.ai/';

function extractErrorMessage(json: JinaRawResponse, fallback: string): string {
	if (typeof json.error === 'string' && json.error.trim()) {
		return json.error.trim();
	}
	if (typeof json.message === 'string' && json.message.trim()) {
		return json.message.trim();
	}
	return fallback;
}

export async function fetchJinaUrl(params: WebFetchParams): Promise<WebFetchResult> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const response = await fetchImpl(JINA_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'X-Return-Format': 'markdown',
		},
		body: JSON.stringify({ url: params.url }),
	});

	const text = await response.text();
	let json: JinaRawResponse;
	try {
		json = JSON.parse(text) as JinaRawResponse;
	} catch {
		throw new WebFetchProviderError(
			`Jina returned non-JSON (HTTP ${response.status})`,
			response.status || 502,
			'jina'
		);
	}

	if (!response.ok) {
		throw new WebFetchProviderError(
			extractErrorMessage(json, `Jina HTTP ${response.status}`),
			response.status,
			'jina'
		);
	}

	const data = json.data;
	if (!data || typeof data !== 'object') {
		throw new WebFetchProviderError('Jina response missing data', 502, 'jina');
	}

	const content = typeof data.content === 'string' ? data.content.trim() : '';
	if (!content) {
		throw new WebFetchProviderError('Jina returned empty content', 502, 'jina');
	}

	const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined;
	const finalUrl = typeof data.url === 'string' && data.url.trim() ? data.url.trim() : params.url;

	return { title, url: finalUrl, content };
}
