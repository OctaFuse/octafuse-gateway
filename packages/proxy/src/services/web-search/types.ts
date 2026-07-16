/**
 * Web Search 引擎共享类型与统一错误。
 */

export type WebSearchResult = {
	title: string;
	url: string;
	snippet?: string;
	summary?: string;
	siteName?: string;
	datePublished?: string;
};

export type WebSearchParams = {
	apiKey: string;
	query: string;
	count?: number;
	allowedDomains?: string[];
	blockedDomains?: string[];
	/** fetch 实现；默认 globalThis.fetch */
	fetchImpl?: typeof fetch;
};

/** 上游引擎错误；路由层据此映射 HTTP 状态，勿把 401 透出为用户 Key 无效。 */
export class WebSearchProviderError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly provider: string
	) {
		super(message);
		this.name = 'WebSearchProviderError';
	}
}
