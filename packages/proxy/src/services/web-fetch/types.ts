/**
 * Web Fetch 引擎共享类型与统一错误。
 */

export type WebFetchResult = {
	title?: string;
	url: string;
	/** Markdown 正文 */
	content: string;
};

export type WebFetchParams = {
	apiKey: string;
	url: string;
	/** fetch 实现；默认 globalThis.fetch */
	fetchImpl?: typeof fetch;
};

/** 上游引擎错误；路由层据此映射 HTTP 状态，勿把 401 透出为用户 Key 无效。 */
export class WebFetchProviderError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly provider: string
	) {
		super(message);
		this.name = 'WebFetchProviderError';
	}
}
