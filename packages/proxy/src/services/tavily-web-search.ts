/**
 * Tavily Web Search API 客户端（https://api.tavily.com/search）。
 */

export type TavilyWebSearchResult = {
	title: string;
	url: string;
	snippet?: string;
	summary?: string;
	siteName?: string;
	datePublished?: string;
};

export type TavilyWebSearchParams = {
	apiKey: string;
	query: string;
	count?: number;
	allowedDomains?: string[];
	blockedDomains?: string[];
	/** fetch 实现；默认 globalThis.fetch */
	fetchImpl?: typeof fetch;
};

type TavilyRawResult = {
	title?: string;
	url?: string;
	content?: string;
	published_date?: string;
};

type TavilyRawResponse = {
	results?: TavilyRawResult[];
	detail?: { error?: string } | string;
	error?: string;
	message?: string;
};

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
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
	results: TavilyWebSearchResult[],
	allowedDomains?: string[],
	blockedDomains?: string[]
): TavilyWebSearchResult[] {
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

function extractErrorMessage(json: TavilyRawResponse, fallback: string): string {
	if (typeof json.error === 'string' && json.error.trim()) {
		return json.error.trim();
	}
	if (typeof json.message === 'string' && json.message.trim()) {
		return json.message.trim();
	}
	if (typeof json.detail === 'string' && json.detail.trim()) {
		return json.detail.trim();
	}
	if (json.detail && typeof json.detail === 'object' && typeof json.detail.error === 'string') {
		return json.detail.error.trim() || fallback;
	}
	return fallback;
}

export class TavilyWebSearchError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'TavilyWebSearchError';
	}
}

export async function searchTavilyWeb(params: TavilyWebSearchParams): Promise<TavilyWebSearchResult[]> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const maxResults = clampCount(params.count);
	const body: Record<string, unknown> = {
		query: params.query,
		max_results: maxResults,
		search_depth: 'basic',
	};
	if (params.allowedDomains?.length) {
		body.include_domains = params.allowedDomains.map(normalizeHost).filter(Boolean);
	} else if (params.blockedDomains?.length) {
		body.exclude_domains = params.blockedDomains.map(normalizeHost).filter(Boolean);
	}

	const response = await fetchImpl(TAVILY_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const text = await response.text();
	let json: TavilyRawResponse;
	try {
		json = JSON.parse(text) as TavilyRawResponse;
	} catch {
		throw new TavilyWebSearchError(`Tavily returned non-JSON (HTTP ${response.status})`, response.status || 502);
	}

	if (!response.ok) {
		throw new TavilyWebSearchError(
			extractErrorMessage(json, `Tavily HTTP ${response.status}`),
			response.status
		);
	}

	const pages = json.results ?? [];
	const mapped: TavilyWebSearchResult[] = pages
		.filter((p) => typeof p.url === 'string' && p.url.trim())
		.map((p) => {
			const content = p.content?.trim() || undefined;
			return {
				title: (p.title || p.url || '').trim(),
				url: (p.url || '').trim(),
				snippet: content,
				summary: content,
				datePublished: p.published_date?.trim() || undefined,
			};
		});

	return filterResults(mapped, params.allowedDomains, params.blockedDomains);
}
