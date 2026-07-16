/**
 * 腾讯云联网搜索 API（WSA）客户端。
 * POST https://api.wsa.cloud.tencent.com/SearchPro
 */

export type TencentWsaWebSearchResult = {
	title: string;
	url: string;
	snippet?: string;
	summary?: string;
	siteName?: string;
	datePublished?: string;
};

export type TencentWsaWebSearchParams = {
	apiKey: string;
	query: string;
	count?: number;
	allowedDomains?: string[];
	blockedDomains?: string[];
	/** fetch 实现；默认 globalThis.fetch */
	fetchImpl?: typeof fetch;
};

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
const DEFAULT_COUNT = 8;
const MAX_COUNT = 10;

function clampCount(count: number | undefined): number {
	if (typeof count !== 'number' || !Number.isFinite(count)) {
		return DEFAULT_COUNT;
	}
	return Math.min(Math.max(Math.trunc(count), 1), MAX_COUNT);
}

function normalizeHost(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '');
}

function hostMatches(urlStr: string, domains: string[]): boolean {
	let host: string;
	try {
		host = new URL(urlStr).hostname.toLowerCase();
	} catch {
		return false;
	}
	return domains.some((d) => {
		const domain = normalizeHost(d);
		return domain && (host === domain || host.endsWith(`.${domain}`));
	});
}

function filterResults(
	results: TencentWsaWebSearchResult[],
	allowedDomains?: string[],
	blockedDomains?: string[]
): TencentWsaWebSearchResult[] {
	const allowed = allowedDomains?.map(normalizeHost).filter(Boolean) ?? [];
	const blocked = blockedDomains?.map(normalizeHost).filter(Boolean) ?? [];
	return results.filter((r) => {
		if (allowed.length > 0 && !hostMatches(r.url, allowed)) {
			return false;
		}
		if (blocked.length > 0 && hostMatches(r.url, blocked)) {
			return false;
		}
		return true;
	});
}

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

export class TencentWsaWebSearchError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'TencentWsaWebSearchError';
	}
}

export async function searchTencentWsaWeb(
	params: TencentWsaWebSearchParams
): Promise<TencentWsaWebSearchResult[]> {
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
		throw new TencentWsaWebSearchError(
			`Tencent WSA returned non-JSON (HTTP ${response.status})`,
			response.status || 502
		);
	}

	const err = json.Response?.Error;
	if (err?.Code || err?.Message) {
		throw new TencentWsaWebSearchError(
			err.Message || err.Code || 'Tencent WSA error',
			mapErrorStatus(err.Code)
		);
	}

	if (!response.ok) {
		throw new TencentWsaWebSearchError(
			json.message || json.error || json.Response?.Msg || `Tencent WSA HTTP ${response.status}`,
			response.status
		);
	}

	const pagesRaw = json.Response?.Pages ?? [];
	const mapped: TencentWsaWebSearchResult[] = [];
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
