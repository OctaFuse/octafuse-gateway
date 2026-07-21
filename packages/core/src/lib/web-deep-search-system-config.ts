/**
 * Agent Web Deep Search（`POST /v1/tools/web-deep-search`）的 `system_config` 键与解析。
 * 权威配置：`WEB_DEEP_SEARCH_ACTIVE` + `WEB_DEEP_SEARCH_CATALOG`（JSON）；无旧三键兼容。
 * 引擎为「搜 + 读」一体（Firecrawl Search / Jina Search），有别于普通 `web-search`。
 */

import type { GatewayRepositories } from '../storage/repositories';
import { roundGatewayMoney } from './money-precision';

export const WEB_DEEP_SEARCH_ACTIVE_KEY = 'WEB_DEEP_SEARCH_ACTIVE';
export const WEB_DEEP_SEARCH_CATALOG_KEY = 'WEB_DEEP_SEARCH_CATALOG';

/** 已实现的 deep search 引擎 */
export const WEB_DEEP_SEARCH_PROVIDERS = ['firecrawl', 'jina'] as const;
export type WebDeepSearchProvider = (typeof WEB_DEEP_SEARCH_PROVIDERS)[number];

export const DEFAULT_WEB_DEEP_SEARCH_PROVIDER: WebDeepSearchProvider = 'firecrawl';
/** 默认单价（高于普通 search）；单位随 `BILLING_CURRENCY`。 */
export const DEFAULT_WEB_DEEP_SEARCH_COST = 0.01;

export type WebDeepSearchCatalogEntry = {
	apiKey: string;
	cost: number;
};

export type WebDeepSearchCatalog = Partial<Record<WebDeepSearchProvider, WebDeepSearchCatalogEntry>>;

export function isWebDeepSearchProvider(value: string): value is WebDeepSearchProvider {
	return (WEB_DEEP_SEARCH_PROVIDERS as readonly string[]).includes(value);
}

export function parseWebDeepSearchProviderInput(raw: string | null | undefined): WebDeepSearchProvider | null {
	const v = raw?.trim().toLowerCase() ?? '';
	if (!v) {
		return null;
	}
	return isWebDeepSearchProvider(v) ? v : null;
}

export function parseWebDeepSearchCostInput(raw: string | null | undefined): number | null {
	if (raw == null || !String(raw).trim()) {
		return null;
	}
	const n = Number(String(raw).trim());
	if (!Number.isFinite(n) || n < 0) {
		return null;
	}
	return roundGatewayMoney(n);
}

export function parseWebDeepSearchActiveInput(raw: string | null | undefined): WebDeepSearchProvider | null {
	return parseWebDeepSearchProviderInput(raw);
}

/** 严格解析（Admin 写入校验）；未知 provider / 非法项 → `null`。 */
export function parseWebDeepSearchCatalogInput(raw: string | null | undefined): WebDeepSearchCatalog | null {
	if (raw == null || !String(raw).trim()) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(raw)) as unknown;
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return null;
	}
	const out: WebDeepSearchCatalog = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const provider = parseWebDeepSearchProviderInput(key);
		if (!provider) {
			return null;
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return null;
		}
		const rec = value as Record<string, unknown>;
		if (typeof rec.apiKey !== 'string') {
			return null;
		}
		const costRaw = rec.cost;
		let cost: number;
		if (costRaw === undefined || costRaw === null || costRaw === '') {
			cost = DEFAULT_WEB_DEEP_SEARCH_COST;
		} else if (typeof costRaw === 'number') {
			if (!Number.isFinite(costRaw) || costRaw < 0) {
				return null;
			}
			cost = roundGatewayMoney(costRaw);
		} else if (typeof costRaw === 'string') {
			const parsedCost = parseWebDeepSearchCostInput(costRaw);
			if (parsedCost == null) {
				return null;
			}
			cost = parsedCost;
		} else {
			return null;
		}
		out[provider] = { apiKey: rec.apiKey.trim(), cost };
	}
	return out;
}

/** 宽松解析（resolve / UI seed）。 */
export function parseWebDeepSearchCatalogLenient(raw: string | null | undefined): WebDeepSearchCatalog | null {
	if (raw == null || !String(raw).trim()) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(raw)) as unknown;
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return null;
	}
	const out: WebDeepSearchCatalog = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const provider = parseWebDeepSearchProviderInput(key);
		if (!provider || !value || typeof value !== 'object' || Array.isArray(value)) {
			continue;
		}
		const rec = value as Record<string, unknown>;
		if (typeof rec.apiKey !== 'string') {
			continue;
		}
		let cost = DEFAULT_WEB_DEEP_SEARCH_COST;
		if (typeof rec.cost === 'number' && Number.isFinite(rec.cost) && rec.cost >= 0) {
			cost = roundGatewayMoney(rec.cost);
		} else if (typeof rec.cost === 'string') {
			const parsedCost = parseWebDeepSearchCostInput(rec.cost);
			if (parsedCost != null) {
				cost = parsedCost;
			}
		}
		out[provider] = { apiKey: rec.apiKey.trim(), cost };
	}
	return out;
}

export function serializeWebDeepSearchCatalog(catalog: WebDeepSearchCatalog): string {
	return JSON.stringify(catalog);
}

export type ResolvedWebDeepSearchConfig = {
	provider: WebDeepSearchProvider;
	apiKey: string | null;
	cost: number;
	sources: {
		provider: 'system_config' | 'default';
		apiKey: 'system_config' | 'missing';
		cost: 'system_config' | 'default';
		mode: 'catalog';
	};
};

export type ResolveWebDeepSearchConfigResult =
	| { ok: true; config: ResolvedWebDeepSearchConfig }
	| { ok: false; reason: 'invalid_provider'; raw: string }
	| { ok: false; reason: 'invalid_catalog' }
	| { ok: false; reason: 'active_missing_key'; provider: string };

/**
 * 从 `system_config` 解析 Web Deep Search。
 * 无 catalog → 默认 provider + missing key（路由侧 503）。
 */
export async function resolveWebDeepSearchConfig(
	repos: GatewayRepositories
): Promise<ResolveWebDeepSearchConfigResult> {
	const [catalogRaw, activeRaw] = await Promise.all([
		repos.systemConfig.getConfig(WEB_DEEP_SEARCH_CATALOG_KEY),
		repos.systemConfig.getConfig(WEB_DEEP_SEARCH_ACTIVE_KEY),
	]);

	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;
	if (!catalogPresent) {
		return {
			ok: true,
			config: {
				provider: DEFAULT_WEB_DEEP_SEARCH_PROVIDER,
				apiKey: null,
				cost: DEFAULT_WEB_DEEP_SEARCH_COST,
				sources: {
					provider: 'default',
					apiKey: 'missing',
					cost: 'default',
					mode: 'catalog',
				},
			},
		};
	}

	const catalog = parseWebDeepSearchCatalogLenient(catalogRaw);
	if (catalog == null) {
		return { ok: false, reason: 'invalid_catalog' };
	}

	const activeTrimmed = activeRaw?.trim() ?? '';
	let provider: WebDeepSearchProvider;
	let providerSource: ResolvedWebDeepSearchConfig['sources']['provider'];
	if (activeTrimmed) {
		const parsed = parseWebDeepSearchActiveInput(activeTrimmed);
		if (!parsed) {
			return { ok: false, reason: 'invalid_provider', raw: activeTrimmed };
		}
		provider = parsed;
		providerSource = 'system_config';
	} else {
		provider = DEFAULT_WEB_DEEP_SEARCH_PROVIDER;
		providerSource = 'default';
	}

	const entry = catalog[provider];
	const apiKey = entry?.apiKey?.trim() || '';
	if (!apiKey) {
		return { ok: false, reason: 'active_missing_key', provider };
	}

	const cost = entry?.cost ?? DEFAULT_WEB_DEEP_SEARCH_COST;
	return {
		ok: true,
		config: {
			provider,
			apiKey,
			cost,
			sources: {
				provider: providerSource,
				apiKey: 'system_config',
				cost: entry?.cost != null ? 'system_config' : 'default',
				mode: 'catalog',
			},
		},
	};
}
