/**
 * Web Deep Search 引擎客户端（`POST /v1/tools/web-deep-search`）。
 */

export { deepSearchByProvider } from './dispatch';
export { deepSearchFirecrawl } from './firecrawl';
export { deepSearchJina } from './jina';
export {
	DEFAULT_WEB_DEEP_SEARCH_COUNT,
	MAX_WEB_DEEP_SEARCH_COUNT,
	WebDeepSearchProviderError,
	clampDeepSearchCount,
	type WebDeepSearchParams,
	type WebDeepSearchResult,
} from './types';
