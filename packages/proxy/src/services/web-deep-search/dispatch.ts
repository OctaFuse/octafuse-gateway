/**
 * 按 `WEB_DEEP_SEARCH_ACTIVE` 分发到 deep search 客户端。
 */

import type { WebDeepSearchProvider } from '@octafuse/core/lib/web-deep-search-system-config';
import { deepSearchFirecrawl } from './firecrawl';
import { deepSearchJina } from './jina';
import { WebDeepSearchProviderError, type WebDeepSearchParams, type WebDeepSearchResult } from './types';

export async function deepSearchByProvider(
	provider: WebDeepSearchProvider,
	params: WebDeepSearchParams
): Promise<WebDeepSearchResult[]> {
	switch (provider) {
		case 'firecrawl':
			return deepSearchFirecrawl(params);
		case 'jina':
			return deepSearchJina(params);
		default: {
			const _exhaustive: never = provider;
			throw new WebDeepSearchProviderError(
				`Web deep search provider is not implemented: ${String(_exhaustive)}`,
				503,
				String(provider)
			);
		}
	}
}
