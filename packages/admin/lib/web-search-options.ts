/**
 * Tools → Configuration：Web Search 引擎下拉（与 `@octafuse/core` 白名单一致）。
 */
import {
	DEFAULT_WEB_SEARCH_COST_USD,
	DEFAULT_WEB_SEARCH_PROVIDER,
	WEB_SEARCH_API_KEY_KEY,
	WEB_SEARCH_COST_KEY,
	WEB_SEARCH_PROVIDER_KEY,
	WEB_SEARCH_PROVIDERS,
	type WebSearchProvider,
} from '@octafuse/core/lib/web-search-system-config';

export {
	DEFAULT_WEB_SEARCH_COST_USD,
	DEFAULT_WEB_SEARCH_PROVIDER,
	WEB_SEARCH_API_KEY_KEY,
	WEB_SEARCH_COST_KEY,
	WEB_SEARCH_PROVIDER_KEY,
	WEB_SEARCH_PROVIDERS,
	type WebSearchProvider,
};

export type WebSearchProviderOption = { value: WebSearchProvider; label: string };

/** 展示名；value 必须落在 `WEB_SEARCH_PROVIDERS`。 */
export function getWebSearchProviderOptions(
	t: (key: 'webSearch.providers.bocha') => string
): ReadonlyArray<WebSearchProviderOption> {
	return WEB_SEARCH_PROVIDERS.map((value) => ({
		value,
		label: t(`webSearch.providers.${value}` as 'webSearch.providers.bocha'),
	}));
}
