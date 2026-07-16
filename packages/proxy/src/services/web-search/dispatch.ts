/**
 * 按 `WEB_SEARCH_PROVIDER` 分发到已实现的引擎客户端。
 */

import type { WebSearchProvider } from '@octafuse/core/lib/web-search-system-config';
import { searchBochaWeb } from './bocha';
import { searchCleverSeeWeb } from './cleversee';
import { searchTavilyWeb } from './tavily';
import { searchTencentWsaWeb } from './tencent-wsa';
import { WebSearchProviderError, type WebSearchParams, type WebSearchResult } from './types';

export async function searchWebByProvider(
	provider: WebSearchProvider,
	params: WebSearchParams
): Promise<WebSearchResult[]> {
	switch (provider) {
		case 'bocha':
			return searchBochaWeb(params);
		case 'tavily':
			return searchTavilyWeb(params);
		case 'cleversee':
			return searchCleverSeeWeb(params);
		case 'tencent_wsa':
			return searchTencentWsaWeb(params);
		default: {
			const _exhaustive: never = provider;
			throw new WebSearchProviderError(
				`Web search provider is not implemented: ${String(_exhaustive)}`,
				503,
				String(provider)
			);
		}
	}
}
