/**
 * Tools → Configuration：Web Fetch 引擎下拉（与 `@octafuse/core` 白名单一致）。
 */
import {
	DEFAULT_WEB_FETCH_COST,
	DEFAULT_WEB_FETCH_PROVIDER,
	WEB_FETCH_ACTIVE_KEY,
	WEB_FETCH_API_KEY_KEY,
	WEB_FETCH_CATALOG_KEY,
	WEB_FETCH_COST_KEY,
	WEB_FETCH_PROVIDER_KEY,
	WEB_FETCH_PROVIDERS,
	type WebFetchProvider,
} from '@octafuse/core/lib/web-fetch-system-config';

export {
	DEFAULT_WEB_FETCH_COST,
	DEFAULT_WEB_FETCH_PROVIDER,
	WEB_FETCH_ACTIVE_KEY,
	WEB_FETCH_API_KEY_KEY,
	WEB_FETCH_CATALOG_KEY,
	WEB_FETCH_COST_KEY,
	WEB_FETCH_PROVIDER_KEY,
	WEB_FETCH_PROVIDERS,
	type WebFetchProvider,
};

export type WebFetchProviderOption = { value: WebFetchProvider; label: string };

/** 各引擎官网 / 申请 API Key 入口（非 i18n） */
export const WEB_FETCH_PROVIDER_DOCS_URL: Record<WebFetchProvider, string> = {
	firecrawl: 'https://docs.firecrawl.dev/',
	tavily: 'https://docs.tavily.com/documentation/api-reference/endpoint/extract',
	jina: 'https://jina.ai/reader/',
};

type WebFetchProviderLabelKey = `webFetch.providers.${WebFetchProvider}`;

/** 展示名；value 必须落在 `WEB_FETCH_PROVIDERS`。 */
export function getWebFetchProviderOptions(
	t: (key: WebFetchProviderLabelKey) => string
): ReadonlyArray<WebFetchProviderOption> {
	return WEB_FETCH_PROVIDERS.map((value) => ({
		value,
		label: t(`webFetch.providers.${value}`),
	}));
}
