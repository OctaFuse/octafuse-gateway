/**
 * Web Deep Search 引擎共享类型与统一错误。
 */

export type WebDeepSearchResult = {
	title: string;
	url: string;
	/** 短摘要 / description */
	snippet?: string;
	/** 页面正文（markdown / 文本）；deep search 的核心字段 */
	content?: string;
};

export type WebDeepSearchParams = {
	apiKey: string;
	query: string;
	count?: number;
	fetchImpl?: typeof fetch;
};

export class WebDeepSearchProviderError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly provider: string
	) {
		super(message);
		this.name = 'WebDeepSearchProviderError';
	}
}

export const DEFAULT_WEB_DEEP_SEARCH_COUNT = 5;
export const MAX_WEB_DEEP_SEARCH_COUNT = 10;

export function clampDeepSearchCount(count: number | undefined): number {
	if (count == null || !Number.isFinite(count)) {
		return DEFAULT_WEB_DEEP_SEARCH_COUNT;
	}
	return Math.min(Math.max(Math.trunc(count), 1), MAX_WEB_DEEP_SEARCH_COUNT);
}
