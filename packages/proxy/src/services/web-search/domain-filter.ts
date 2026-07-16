/**
 * Web Search 结果数限制与域名过滤（各引擎共用）。
 */

import type { WebSearchResult } from './types';

export const DEFAULT_WEB_SEARCH_COUNT = 8;
export const MAX_WEB_SEARCH_COUNT = 10;

export function clampCount(count: number | undefined): number {
	if (typeof count !== 'number' || !Number.isFinite(count)) {
		return DEFAULT_WEB_SEARCH_COUNT;
	}
	return Math.min(Math.max(Math.trunc(count), 1), MAX_WEB_SEARCH_COUNT);
}

export function normalizeHost(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '');
}

export function hostMatches(urlStr: string, domains: string[]): boolean {
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

export function filterResults(
	results: WebSearchResult[],
	allowedDomains?: string[],
	blockedDomains?: string[]
): WebSearchResult[] {
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
