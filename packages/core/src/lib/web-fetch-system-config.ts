/**
 * Agent Web Fetch（`POST /v1/tools/web-fetch`）的 `system_config` 键与解析。
 * 权威配置：`WEB_FETCH_ACTIVE` + `WEB_FETCH_CATALOG`（JSON）；旧三键仅读时兼容。
 */

import type { GatewayRepositories } from '../storage/repositories';
import { roundGatewayMoney } from './money-precision';

/** @deprecated 旧全局三键；仅读时兼容，Admin 不再写入 */
export const WEB_FETCH_PROVIDER_KEY = 'WEB_FETCH_PROVIDER';
/** @deprecated 旧全局三键；仅读时兼容，Admin 不再写入 */
export const WEB_FETCH_API_KEY_KEY = 'WEB_FETCH_API_KEY';
/** @deprecated 旧全局三键；仅读时兼容，Admin 不再写入 */
export const WEB_FETCH_COST_KEY = 'WEB_FETCH_COST';

export const WEB_FETCH_ACTIVE_KEY = 'WEB_FETCH_ACTIVE';
export const WEB_FETCH_CATALOG_KEY = 'WEB_FETCH_CATALOG';

/** 已实现的抓取引擎（Admin 下拉仅允许这些值） */
export const WEB_FETCH_PROVIDERS = ['firecrawl', 'tavily', 'jina'] as const;
export type WebFetchProvider = (typeof WEB_FETCH_PROVIDERS)[number];

export const DEFAULT_WEB_FETCH_PROVIDER: WebFetchProvider = 'firecrawl';
/** 默认单价；数值单位随 Gateway `system_config.BILLING_CURRENCY`（USD/CNY…），非固定美元。 */
export const DEFAULT_WEB_FETCH_COST = 0.002;

export type WebFetchCatalogEntry = {
	apiKey: string;
	cost: number;
};

export type WebFetchCatalog = Partial<Record<WebFetchProvider, WebFetchCatalogEntry>>;

export function isWebFetchProvider(value: string): value is WebFetchProvider {
	return (WEB_FETCH_PROVIDERS as readonly string[]).includes(value);
}

export function parseWebFetchProviderInput(raw: string | null | undefined): WebFetchProvider | null {
	const v = raw?.trim().toLowerCase() ?? '';
	if (!v) {
		return null;
	}
	return isWebFetchProvider(v) ? v : null;
}

/** @deprecated 旧 COST 键解析；catalog 写入请用 {@link parseWebFetchCatalogInput} */
export function parseWebFetchCostInput(raw: string | null | undefined): number | null {
	if (raw == null || !String(raw).trim()) {
		return null;
	}
	const n = Number(String(raw).trim());
	if (!Number.isFinite(n) || n < 0) {
		return null;
	}
	return roundGatewayMoney(n);
}

export function parseWebFetchActiveInput(raw: string | null | undefined): WebFetchProvider | null {
	return parseWebFetchProviderInput(raw);
}

/**
 * 解析 catalog JSON。非法 JSON / 非对象 → `null`。
 * 白名单外的 key 丢弃；单项非法 → 整包 `null`（写入校验用）。
 */
export function parseWebFetchCatalogInput(raw: string | null | undefined): WebFetchCatalog | null {
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
	const out: WebFetchCatalog = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const provider = parseWebFetchProviderInput(key);
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
			cost = DEFAULT_WEB_FETCH_COST;
		} else if (typeof costRaw === 'number') {
			if (!Number.isFinite(costRaw) || costRaw < 0) {
				return null;
			}
			cost = roundGatewayMoney(costRaw);
		} else if (typeof costRaw === 'string') {
			const parsedCost = parseWebFetchCostInput(costRaw);
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

/** 宽松解析：丢弃非法单项与未知 provider（供 resolve / UI seed）。 */
export function parseWebFetchCatalogLenient(raw: string | null | undefined): WebFetchCatalog | null {
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
	const out: WebFetchCatalog = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const provider = parseWebFetchProviderInput(key);
		if (!provider || !value || typeof value !== 'object' || Array.isArray(value)) {
			continue;
		}
		const rec = value as Record<string, unknown>;
		if (typeof rec.apiKey !== 'string') {
			continue;
		}
		let cost = DEFAULT_WEB_FETCH_COST;
		if (typeof rec.cost === 'number' && Number.isFinite(rec.cost) && rec.cost >= 0) {
			cost = roundGatewayMoney(rec.cost);
		} else if (typeof rec.cost === 'string') {
			const parsedCost = parseWebFetchCostInput(rec.cost);
			if (parsedCost != null) {
				cost = parsedCost;
			}
		}
		out[provider] = { apiKey: rec.apiKey.trim(), cost };
	}
	return out;
}

export function serializeWebFetchCatalog(catalog: WebFetchCatalog): string {
	return JSON.stringify(catalog);
}

export type ResolvedWebFetchConfig = {
	provider: WebFetchProvider;
	apiKey: string | null;
	/** 单价；单位随 Gateway 计费币种（`BILLING_CURRENCY`）。 */
	cost: number;
	sources: {
		provider: 'system_config' | 'default';
		apiKey: 'system_config' | 'missing';
		cost: 'system_config' | 'default';
		mode: 'catalog' | 'legacy';
	};
};

export type ResolveWebFetchConfigResult =
	| { ok: true; config: ResolvedWebFetchConfig }
	| { ok: false; reason: 'invalid_provider'; raw: string }
	| { ok: false; reason: 'invalid_catalog' }
	| { ok: false; reason: 'active_missing_key'; provider: string };

/**
 * 从 `system_config` 解析 Web Fetch 配置。
 * 优先 `WEB_FETCH_CATALOG` + `WEB_FETCH_ACTIVE`；无 catalog 时回退旧三键（不落库）。
 */
export async function resolveWebFetchConfig(
	repos: GatewayRepositories
): Promise<ResolveWebFetchConfigResult> {
	const [catalogRaw, activeRaw, legacyProviderRaw, legacyApiKeyRaw, legacyCostRaw] = await Promise.all([
		repos.systemConfig.getConfig(WEB_FETCH_CATALOG_KEY),
		repos.systemConfig.getConfig(WEB_FETCH_ACTIVE_KEY),
		repos.systemConfig.getConfig(WEB_FETCH_PROVIDER_KEY),
		repos.systemConfig.getConfig(WEB_FETCH_API_KEY_KEY),
		repos.systemConfig.getConfig(WEB_FETCH_COST_KEY),
	]);

	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;
	if (catalogPresent) {
		const catalog = parseWebFetchCatalogLenient(catalogRaw);
		if (catalog == null) {
			return { ok: false, reason: 'invalid_catalog' };
		}

		const activeTrimmed = activeRaw?.trim() ?? '';
		let provider: WebFetchProvider;
		let providerSource: ResolvedWebFetchConfig['sources']['provider'];
		if (activeTrimmed) {
			const parsed = parseWebFetchActiveInput(activeTrimmed);
			if (!parsed) {
				return { ok: false, reason: 'invalid_provider', raw: activeTrimmed };
			}
			provider = parsed;
			providerSource = 'system_config';
		} else {
			provider = DEFAULT_WEB_FETCH_PROVIDER;
			providerSource = 'default';
		}

		const entry = catalog[provider];
		const apiKey = entry?.apiKey?.trim() || '';
		if (!apiKey) {
			return { ok: false, reason: 'active_missing_key', provider };
		}

		const cost = entry?.cost ?? DEFAULT_WEB_FETCH_COST;
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

	const providerTrimmed = legacyProviderRaw?.trim() ?? '';
	if (providerTrimmed) {
		const parsed = parseWebFetchProviderInput(providerTrimmed);
		if (!parsed) {
			return { ok: false, reason: 'invalid_provider', raw: providerTrimmed };
		}
		return { ok: true, config: buildLegacyResolved(parsed, 'system_config', legacyApiKeyRaw, legacyCostRaw) };
	}

	return {
		ok: true,
		config: buildLegacyResolved(DEFAULT_WEB_FETCH_PROVIDER, 'default', legacyApiKeyRaw, legacyCostRaw),
	};
}

function buildLegacyResolved(
	provider: WebFetchProvider,
	providerSource: ResolvedWebFetchConfig['sources']['provider'],
	apiKeyRaw: string | null,
	costRaw: string | null
): ResolvedWebFetchConfig {
	const configKey = apiKeyRaw?.trim() || '';
	const parsedCost = parseWebFetchCostInput(costRaw);

	return {
		provider,
		apiKey: configKey || null,
		cost: parsedCost ?? DEFAULT_WEB_FETCH_COST,
		sources: {
			provider: providerSource,
			apiKey: configKey ? 'system_config' : 'missing',
			cost: parsedCost != null ? 'system_config' : 'default',
			mode: 'legacy',
		},
	};
}
