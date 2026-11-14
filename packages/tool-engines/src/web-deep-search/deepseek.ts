/**
 * DeepSeek Search API（`need_content: true`，一次请求取到正文）：
 * https://api.deepseek.com/v1/tools/search
 */

import { callDeepSeekTool, truncateDeepSeekQuery } from '../deepseek/client';
import {
	clampDeepSearchCount,
	WebDeepSearchProviderError,
	type WebDeepSearchParams,
	type WebDeepSearchResult,
} from './types';

type DeepSeekSearchItem = {
	title?: string;
	url?: string;
	snippet?: string;
	summary?: string;
	content?: string;
};

type DeepSeekSearchResponse = {
	results?: DeepSeekSearchItem[];
};

function clean(value: string | null | undefined): string | undefined {
	const t = typeof value === 'string' ? value.trim() : '';
	return t || undefined;
}

export async function deepSearchDeepSeek(params: WebDeepSearchParams): Promise<WebDeepSearchResult[]> {
	const json = await callDeepSeekTool<DeepSeekSearchResponse, WebDeepSearchProviderError>({
		path: 'search',
		apiKey: params.apiKey,
		body: {
			query: truncateDeepSeekQuery(params.query),
			count: clampDeepSearchCount(params.count),
			need_content: true,
		},
		fetchImpl: params.fetchImpl,
		createError: (message, status) => new WebDeepSearchProviderError(message, status, 'deepseek'),
	});

	const items = Array.isArray(json.results) ? json.results : [];
	return items
		.filter((p) => typeof p.url === 'string' && p.url.trim())
		.map((p) => {
			const content = clean(p.content);
			return {
				title: (p.title || p.url || '').trim(),
				url: (p.url || '').trim(),
				snippet: clean(p.snippet) ?? clean(p.summary)?.slice(0, 240),
				content,
			};
		});
}
