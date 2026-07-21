/**
 * Tools → Configuration：Web Search 引擎下拉（与 `@octafuse/core` 白名单一致）。
 */
import {
	DEFAULT_WEB_SEARCH_COST,
	DEFAULT_WEB_SEARCH_PROVIDER,
	WEB_SEARCH_ACTIVE_KEY,
	WEB_SEARCH_API_KEY_KEY,
	WEB_SEARCH_CATALOG_KEY,
	WEB_SEARCH_COST_KEY,
	WEB_SEARCH_PROVIDER_KEY,
	WEB_SEARCH_PROVIDERS,
	type WebSearchProvider,
} from '@octafuse/core/lib/web-search-system-config';

export {
	DEFAULT_WEB_SEARCH_COST,
	DEFAULT_WEB_SEARCH_PROVIDER,
	WEB_SEARCH_ACTIVE_KEY,
	WEB_SEARCH_API_KEY_KEY,
	WEB_SEARCH_CATALOG_KEY,
	WEB_SEARCH_COST_KEY,
	WEB_SEARCH_PROVIDER_KEY,
	WEB_SEARCH_PROVIDERS,
	type WebSearchProvider,
};

export type WebSearchProviderOption = { value: WebSearchProvider; label: string };

/** 各引擎官网 / 申请 API Key 入口（非 i18n） */
export const WEB_SEARCH_PROVIDER_DOCS_URL: Record<WebSearchProvider, string> = {
	bocha: 'https://open.bochaai.com/',
	tavily: 'https://app.tavily.com/',
	cleversee: 'https://help.aliyun.com/zh/product/3037946.html',
	tencent_wsa: 'https://cloud.tencent.com/product/wsa',
};

type WebSearchProviderLabelKey = `webSearch.providers.${WebSearchProvider}`;

/** 展示名；value 必须落在 `WEB_SEARCH_PROVIDERS`。 */
export function getWebSearchProviderOptions(
	t: (key: WebSearchProviderLabelKey) => string
): ReadonlyArray<WebSearchProviderOption> {
	return WEB_SEARCH_PROVIDERS.map((value) => ({
		value,
		label: t(`webSearch.providers.${value}`),
	}));
}
