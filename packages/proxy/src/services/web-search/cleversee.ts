/**
 * 阿里云 CleverSee（开析）联网搜索客户端。
 * POST https://maasaisearchproxy.aliyuncs.com/api/web-search
 */

import { clampCount, filterResults, normalizeHost } from './domain-filter';
import { WebSearchProviderError, type WebSearchParams, type WebSearchResult } from './types';

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

export async function searchCleverSeeWeb(params: WebSearchParams): Promise<WebSearchResult[]> {
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
		throw new WebSearchProviderError(
			`CleverSee returned non-JSON (HTTP ${response.status})`,
			response.status || 502,
			'cleversee'
		);
	}

	if (!response.ok) {
		throw new WebSearchProviderError(
			json.message || `CleverSee HTTP ${response.status}`,
			response.status,
			'cleversee'
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
		throw new WebSearchProviderError(
			json.message || `CleverSee error code ${json.code}`,
			status,
			'cleversee'
		);
	}

	const pages = json.data?.result ?? [];
	const mapped: WebSearchResult[] = pages
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
