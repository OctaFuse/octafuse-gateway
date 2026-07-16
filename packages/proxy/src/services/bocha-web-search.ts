/**
 * 博查 Web Search API 客户端（https://api.bochaai.com/v1/web-search）。
 */

export type BochaWebSearchResult = {
	title: string;
	url: string;
	snippet?: string;
	summary?: string;
	siteName?: string;
	datePublished?: string;
};

export type BochaWebSearchParams = {
	apiKey: string;
	query: string;
	count?: number;
	allowedDomains?: string[];
	blockedDomains?: string[];
	/** fetch 实现；默认 globalThis.fetch */
	fetchImpl?: typeof fetch;
};

type BochaRawPage = {
	name?: string;
	url?: string;
	snippet?: string;
	summary?: string;
	siteName?: string;
	datePublished?: string;
};

type BochaRawResponse = {
	code?: number;
	msg?: string;
	message?: string;
	data?: {
		webPages?: {
			value?: BochaRawPage[];
		};
	};
};

const BOCHA_ENDPOINT = 'https://api.bochaai.com/v1/web-search';
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
	results: BochaWebSearchResult[],
	allowedDomains?: string[],
	blockedDomains?: string[]
): BochaWebSearchResult[] {
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

export class BochaWebSearchError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'BochaWebSearchError';
	}
}

export async function searchBochaWeb(params: BochaWebSearchParams): Promise<BochaWebSearchResult[]> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const count = clampCount(params.count);
	const body: Record<string, unknown> = {
		query: params.query,
		freshness: 'noLimit',
		summary: true,
		count,
	};
	// 博查 include/exclude：用 | 连接；失败时仍可依赖本地过滤
	if (params.allowedDomains?.length) {
		body.include = params.allowedDomains.map(normalizeHost).filter(Boolean).join('|');
	} else if (params.blockedDomains?.length) {
		body.exclude = params.blockedDomains.map(normalizeHost).filter(Boolean).join('|');
	}

	const response = await fetchImpl(BOCHA_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const text = await response.text();
	let json: BochaRawResponse;
	try {
		json = JSON.parse(text) as BochaRawResponse;
	} catch {
		throw new BochaWebSearchError(`Bocha returned non-JSON (HTTP ${response.status})`, response.status || 502);
	}

	if (!response.ok) {
		const msg = json.msg || json.message || `Bocha HTTP ${response.status}`;
		throw new BochaWebSearchError(msg, response.status);
	}

	// 博查成功码多为 200；部分错误也会 HTTP 200 + code != 200
	if (typeof json.code === 'number' && json.code !== 200) {
		throw new BochaWebSearchError(json.msg || json.message || `Bocha error code ${json.code}`, 502);
	}

	const pages = json.data?.webPages?.value ?? [];
	const mapped: BochaWebSearchResult[] = pages
		.filter((p) => typeof p.url === 'string' && p.url.trim())
		.map((p) => ({
			title: (p.name || p.url || '').trim(),
			url: (p.url || '').trim(),
			snippet: p.snippet?.trim() || undefined,
			summary: p.summary?.trim() || undefined,
			siteName: p.siteName?.trim() || undefined,
			datePublished: p.datePublished?.trim() || undefined,
		}));

	return filterResults(mapped, params.allowedDomains, params.blockedDomains);
}
