/**
 * 按 `WEB_FETCH_PROVIDER` 分发到已实现的抓取客户端。
 */

import type { WebFetchProvider } from '@octafuse/core/lib/web-fetch-system-config';
import { fetchFirecrawlUrl } from './firecrawl';
import { fetchJinaUrl } from './jina';
import { fetchTavilyUrl } from './tavily';
import { WebFetchProviderError, type WebFetchParams, type WebFetchResult } from './types';

export async function fetchUrlByProvider(
	provider: WebFetchProvider,
	params: WebFetchParams
): Promise<WebFetchResult> {
	switch (provider) {
		case 'firecrawl':
			return fetchFirecrawlUrl(params);
		case 'tavily':
			return fetchTavilyUrl(params);
		case 'jina':
			return fetchJinaUrl(params);
		default: {
			const _exhaustive: never = provider;
			throw new WebFetchProviderError(
				`Web fetch provider is not implemented: ${String(_exhaustive)}`,
				503,
				String(provider)
			);
		}
	}
}
