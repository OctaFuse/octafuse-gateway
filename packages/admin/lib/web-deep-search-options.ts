/**
 * Tools → Configuration：Web Deep Search 引擎下拉。
 */
import {
	DEFAULT_WEB_DEEP_SEARCH_COST,
	DEFAULT_WEB_DEEP_SEARCH_PROVIDER,
	WEB_DEEP_SEARCH_ACTIVE_KEY,
	WEB_DEEP_SEARCH_CATALOG_KEY,
	WEB_DEEP_SEARCH_PROVIDERS,
	type WebDeepSearchProvider,
} from '@octafuse/core/lib/web-deep-search-system-config';

export {
	DEFAULT_WEB_DEEP_SEARCH_COST,
	DEFAULT_WEB_DEEP_SEARCH_PROVIDER,
	WEB_DEEP_SEARCH_ACTIVE_KEY,
	WEB_DEEP_SEARCH_CATALOG_KEY,
	WEB_DEEP_SEARCH_PROVIDERS,
	type WebDeepSearchProvider,
};

export type WebDeepSearchProviderOption = { value: WebDeepSearchProvider; label: string };

export const WEB_DEEP_SEARCH_PROVIDER_DOCS_URL: Record<WebDeepSearchProvider, string> = {
	firecrawl: 'https://docs.firecrawl.dev/features/search',
	jina: 'https://jina.ai/reader/',
};

type WebDeepSearchProviderLabelKey = `webDeepSearch.providers.${WebDeepSearchProvider}`;

export function getWebDeepSearchProviderOptions(
	t: (key: WebDeepSearchProviderLabelKey) => string
): ReadonlyArray<WebDeepSearchProviderOption> {
	return WEB_DEEP_SEARCH_PROVIDERS.map((value) => ({
		value,
		label: t(`webDeepSearch.providers.${value}`),
	}));
}
