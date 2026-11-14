/**
 * DeepSeek Search API 客户端（https://api.deepseek.com/v1/tools/search）。
 *
 * - 查询词最多 128 个字符，超长在这里截断，对外接口行为不变。
 * - 上游没有域名过滤参数：能放进 128 字符就拼 `site:` / `-site:`；放不下就多取结果再本地过滤。
 */

import {
	callDeepSeekTool,
	DEEPSEEK_QUERY_MAX_CHARS,
	DEEPSEEK_SEARCH_MAX_COUNT,
	deepSeekQueryLength,
	truncateDeepSeekQuery,
} from '../deepseek/client';
import { clampCount, filterResults, normalizeHost } from './domain-filter';
import { WebSearchProviderError, type WebSearchParams, type WebSearchResult } from './types';

type DeepSeekSearchItem = {
	title?: string;
	url?: string;
	snippet?: string;
	summary?: string;
	site_name?: string | null;
	date?: string | null;
};

type DeepSeekSearchResponse = {
	results?: DeepSeekSearchItem[];
};

function clean(value: string | null | undefined): string | undefined {
	const t = typeof value === 'string' ? value.trim() : '';
	return t || undefined;
}

/** 生成域名过滤后缀；无域名返回空串。 */
function buildDomainOperators(allowed?: string[], blocked?: string[]): string {
	const allow = allowed?.map(normalizeHost).filter(Boolean) ?? [];
	if (allow.length > 0) {
		return allow.map((d) => `site:${d}`).join(' OR ');
	}
	const block = blocked?.map(normalizeHost).filter(Boolean) ?? [];
	return block.map((d) => `-site:${d}`).join(' ');
}

export async function searchDeepSeekWeb(params: WebSearchParams): Promise<WebSearchResult[]> {
	const wanted = clampCount(params.count);
	const base = truncateDeepSeekQuery(params.query);
	const operators = buildDomainOperators(params.allowedDomains, params.blockedDomains);

	let query = base;
	let requestCount = wanted;
	if (operators) {
		const candidate = `${base} ${operators}`;
		if (deepSeekQueryLength(candidate) <= DEEPSEEK_QUERY_MAX_CHARS) {
			query = candidate;
		} else {
			// 放不下：多取结果，靠本地过滤。按请求次数计费，多取不增加成本。
			requestCount = DEEPSEEK_SEARCH_MAX_COUNT;
		}
	}

	const json = await callDeepSeekTool<DeepSeekSearchResponse, WebSearchProviderError>({
		path: 'search',
		apiKey: params.apiKey,
		body: { query, count: requestCount },
		fetchImpl: params.fetchImpl,
		createError: (message, status) => new WebSearchProviderError(message, status, 'deepseek'),
	});

	const items = Array.isArray(json.results) ? json.results : [];
	const mapped: WebSearchResult[] = items
		.filter((p) => typeof p.url === 'string' && p.url.trim())
		.map((p) => ({
			title: (p.title || p.url || '').trim(),
			url: (p.url || '').trim(),
			snippet: clean(p.snippet),
			summary: clean(p.summary),
			siteName: clean(p.site_name),
			datePublished: clean(p.date),
		}));

	return filterResults(mapped, params.allowedDomains, params.blockedDomains).slice(0, wanted);
}
