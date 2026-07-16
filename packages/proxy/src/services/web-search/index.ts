/**
 * Web Search 引擎客户端（`POST /v1/tools/web-search`）。
 */

export { searchWebByProvider } from './dispatch';
export { searchBochaWeb } from './bocha';
export { searchCleverSeeWeb } from './cleversee';
export { searchTavilyWeb } from './tavily';
export { searchTencentWsaWeb } from './tencent-wsa';
export {
	WebSearchProviderError,
	type WebSearchParams,
	type WebSearchResult,
} from './types';
export {
	DEFAULT_WEB_SEARCH_COUNT,
	MAX_WEB_SEARCH_COUNT,
	clampCount,
	filterResults,
	normalizeHost,
} from './domain-filter';
