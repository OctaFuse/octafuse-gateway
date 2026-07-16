/**
 * 阿里云 CleverSee（开析）联网搜索客户端。
 * POST https://maasaisearchproxy.aliyuncs.com/api/web-search
 */

export type CleverSeeWebSearchResult = {
	title: string;
	url: string;
	snippet?: string;
	summary?: string;
	siteName?: string;
	datePublished?: string;
};

export type CleverSeeWebSearchParams = {
	apiKey: string;
	query: string;
	count?: number;
	allowedDomains?: string[];
	blockedDomains?: string[];
	/** fetch 实现；默认 globalThis.fetch */
	fetchImpl?: typeof fetch;
};

type CleverSeeRawResult = {
	title?: string;
	url?: string;
	snippet?: string;
	date?: string;
	source?: { name?: string; domain?: string };
};

type CleverSeeRawResponse = {
	code?: number;
	message?: string;
	data?: {
		total?: number;
		result?: CleverSeeRawResult[];
	};
};

const CLEVERSEE_ENDPOINT = 'https://maasaisearchproxy.aliyuncs.com/api/web-search';
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
	results: CleverSeeWebSearchResult[],
	allowedDomains?: string[],
	blockedDomains?: string[]
): CleverSeeWebSearchResult[] {
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

export class CleverSeeWebSearchError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'CleverSeeWebSearchError';
	}
}

export async function searchCleverSeeWeb(
	params: CleverSeeWebSearchParams
): Promise<CleverSeeWebSearchResult[]> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const limit = clampCount(params.count);
	const allowed = params.allowedDomains?.map(normalizeHost).filter(Boolean) ?? [];
	const blocked = params.blockedDomains?.map(normalizeHost).filter(Boolean) ?? [];

	const body: Record<string, unknown> = {
		query: params.query,
		limit,
		searchType: 'pro',
		region: 'mainland_china',
	};
	// includeDomain 仅 region=global 时生效；excludeDomain 在 pro 下可用
	if (allowed.length > 0) {
		body.region = 'global';
		body.includeDomain = allowed.slice(0, 30);
	} else if (blocked.length > 0) {
		body.excludeDomain = blocked.slice(0, 30);
	}

	const response = await fetchImpl(CLEVERSEE_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json',
			'x-acs-action': 'WebSearch',
			'x-acs-version': '2026-04-24',
		},
		body: JSON.stringify(body),
	});

	const text = await response.text();
	let json: CleverSeeRawResponse;
	try {
		json = JSON.parse(text) as CleverSeeRawResponse;
	} catch {
		throw new CleverSeeWebSearchError(
			`CleverSee returned non-JSON (HTTP ${response.status})`,
			response.status || 502
		);
	}

	if (!response.ok) {
		throw new CleverSeeWebSearchError(
			json.message || `CleverSee HTTP ${response.status}`,
			response.status
		);
	}

	// 业务码：200 成功；201 部分结果仍可用
	if (typeof json.code === 'number' && json.code !== 200 && json.code !== 201) {
		const status =
			json.code === 401 || json.code === 400 || json.code === 301
				? json.code === 301
					? 400
					: json.code
				: 502;
		throw new CleverSeeWebSearchError(
			json.message || `CleverSee error code ${json.code}`,
			status
		);
	}

	const pages = json.data?.result ?? [];
	const mapped: CleverSeeWebSearchResult[] = pages
		.filter((p) => typeof p.url === 'string' && p.url.trim())
		.map((p) => ({
			title: (p.title || p.url || '').trim(),
			url: (p.url || '').trim(),
			snippet: p.snippet?.trim() || undefined,
			summary: p.snippet?.trim() || undefined,
			siteName: p.source?.name?.trim() || p.source?.domain?.trim() || undefined,
			datePublished: p.date?.trim() || undefined,
		}));

	return filterResults(mapped, params.allowedDomains, params.blockedDomains);
}
