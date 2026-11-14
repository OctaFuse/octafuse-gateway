/**
 * DeepSeek Fetch API 客户端（https://api.deepseek.com/v1/tools/fetch）。
 * 上游只返回 `{ title, content }`（Markdown），不返回跳转后的最终地址。
 */

import { callDeepSeekTool } from '../deepseek/client';
import { WebFetchProviderError, type WebFetchParams, type WebFetchResult } from './types';

type DeepSeekFetchResponse = {
	title?: string;
	content?: string;
};

export async function fetchDeepSeekUrl(params: WebFetchParams): Promise<WebFetchResult> {
	const json = await callDeepSeekTool<DeepSeekFetchResponse, WebFetchProviderError>({
		path: 'fetch',
		apiKey: params.apiKey,
		body: { url: params.url },
		fetchImpl: params.fetchImpl,
		createError: (message, status) => new WebFetchProviderError(message, status, 'deepseek'),
	});

	const content = typeof json.content === 'string' ? json.content.trim() : '';
	if (!content) {
		throw new WebFetchProviderError('DeepSeek returned empty content', 502, 'deepseek');
	}
	const title = typeof json.title === 'string' && json.title.trim() ? json.title.trim() : undefined;

	return { title, url: params.url, content };
}
