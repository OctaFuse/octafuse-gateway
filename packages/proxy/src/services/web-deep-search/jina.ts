/**
 * Jina Search API（`https://s.jina.ai/`）：搜 + 读 top 结果正文。
 */

import {
	clampDeepSearchCount,
	WebDeepSearchProviderError,
	type WebDeepSearchParams,
	type WebDeepSearchResult,
} from './types';

type JinaSearchItem = {
	title?: string;
	url?: string;
	description?: string;
	content?: string;
};

type JinaRawResponse = {
	data?: JinaSearchItem[];
	code?: number;
	status?: number;
	message?: string;
	error?: string;
};

const JINA_SEARCH_ENDPOINT = 'https://s.jina.ai/';

function extractErrorMessage(json: JinaRawResponse, fallback: string): string {
	if (typeof json.error === 'string' && json.error.trim()) {
		return json.error.trim();
	}
	if (typeof json.message === 'string' && json.message.trim()) {
		return json.message.trim();
	}
	return fallback;
}

export async function deepSearchJina(params: WebDeepSearchParams): Promise<WebDeepSearchResult[]> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const limit = clampDeepSearchCount(params.count);
	const response = await fetchImpl(JINA_SEARCH_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'X-Return-Format': 'markdown',
		},
		body: JSON.stringify({
			q: params.query,
			num: limit,
		}),
	});

	const text = await response.text();
	let json: JinaRawResponse;
	try {
		json = JSON.parse(text) as JinaRawResponse;
	} catch {
		throw new WebDeepSearchProviderError(
			`Jina returned non-JSON (HTTP ${response.status})`,
			response.status || 502,
			'jina'
		);
	}

	if (!response.ok) {
		throw new WebDeepSearchProviderError(
			extractErrorMessage(json, `Jina HTTP ${response.status}`),
			response.status,
			'jina'
		);
	}

	const items = Array.isArray(json.data) ? json.data : [];
	return items
		.filter((p) => typeof p.url === 'string' && p.url.trim())
		.slice(0, limit)
		.map((p) => {
			const content = typeof p.content === 'string' && p.content.trim() ? p.content.trim() : undefined;
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
