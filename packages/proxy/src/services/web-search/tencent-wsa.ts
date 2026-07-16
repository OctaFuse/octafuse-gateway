/**
 * 腾讯云联网搜索 API（WSA）客户端。
 * POST https://api.wsa.cloud.tencent.com/SearchPro
 */

import { clampCount, filterResults, normalizeHost } from './domain-filter';
import { WebSearchProviderError, type WebSearchParams, type WebSearchResult } from './types';

type TencentWsaPage = {
	title?: string;
	url?: string;
	passage?: string;
	content?: string;
	site?: string;
	date?: string;
};

type TencentWsaRawResponse = {
	Response?: {
		Query?: string;
		Pages?: string[];
		Version?: string;
		Msg?: string;
		RequestId?: string;
		Error?: {
			Code?: string;
			Message?: string;
		};
	};
	error?: string;
	message?: string;
};

const TENCENT_WSA_ENDPOINT = 'https://api.wsa.cloud.tencent.com/SearchPro';

function mapErrorStatus(code: string | undefined): number {
	switch (code) {
		case 'UnauthorizedOperation':
			return 401;
		case 'InvalidParameter':
			return 400;
		case 'RequestLimitExceeded':
			return 429;
		case 'ResourceNotFound':
		case 'ResourceUnavailable':
			return 403;
		default:
			return 502;
	}
}

export async function searchTencentWsaWeb(params: WebSearchParams): Promise<WebSearchResult[]> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const count = clampCount(params.count);
	const allowed = params.allowedDomains?.map(normalizeHost).filter(Boolean) ?? [];

	const body: Record<string, unknown> = {
		Query: params.query,
		Mode: 0,
		Cnt: count,
	};
	// Site 仅支持单域名站内搜；多域名 / 黑名单依赖本地过滤
	if (allowed.length === 1) {
		body.Site = allowed[0];
	}

	const response = await fetchImpl(TENCENT_WSA_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json; charset=utf-8',
		},
		body: JSON.stringify(body),
	});

	const text = await response.text();
	let json: TencentWsaRawResponse;
	try {
		json = JSON.parse(text) as TencentWsaRawResponse;
	} catch {
		throw new WebSearchProviderError(
			`Tencent WSA returned non-JSON (HTTP ${response.status})`,
			response.status || 502,
			'tencent_wsa'
		);
	}

	const err = json.Response?.Error;
	if (err?.Code || err?.Message) {
		throw new WebSearchProviderError(
			err.Message || err.Code || 'Tencent WSA error',
			mapErrorStatus(err.Code),
			'tencent_wsa'
		);
	}

	if (!response.ok) {
		throw new WebSearchProviderError(
			json.message || json.error || json.Response?.Msg || `Tencent WSA HTTP ${response.status}`,
			response.status,
			'tencent_wsa'
		);
	}

	const pagesRaw = json.Response?.Pages ?? [];
	const mapped: WebSearchResult[] = [];
	for (const pageStr of pagesRaw) {
		if (typeof pageStr !== 'string' || !pageStr.trim()) {
			continue;
		}
		let page: TencentWsaPage;
		try {
			page = JSON.parse(pageStr) as TencentWsaPage;
		} catch {
			continue;
		}
		const url = typeof page.url === 'string' ? page.url.trim() : '';
		if (!url) {
			continue;
		}
		const snippet = page.passage?.trim() || page.content?.trim() || undefined;
		mapped.push({
			title: (page.title || url).trim(),
			url,
			snippet,
			summary: snippet,
			siteName: page.site?.trim() || undefined,
			datePublished: page.date?.trim() || undefined,
		});
	}

	return filterResults(mapped, params.allowedDomains, params.blockedDomains).slice(0, count);
}
