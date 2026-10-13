/**
 * Agent Web Search（`POST /v1/tools/web-search`）的 `system_config` 键与解析。
 * 权威配置：`WEB_SEARCH_ACTIVE` + `WEB_SEARCH_CATALOG`（JSON）；旧三键仅读时兼容。
 * Catalog 新价格存 pricing（标准价与倍率）；旧三账本单价及 `cost` 继续兼容读取。
 */

import type { GatewayRepositories } from '../storage/repositories';
import { roundGatewayMoney } from './money-precision';
import {
	parseToolCatalogPricing,
	toolCatalogPricingForStorage,
	type ToolCatalogPricingFields,
	parseToolMoneyField,
	type ToolUnitPrices,
} from './tool-pricing';

/** @deprecated 旧全局三键；仅读时兼容，Admin 不再写入 */
export const WEB_SEARCH_PROVIDER_KEY = 'WEB_SEARCH_PROVIDER';
/** @deprecated 旧全局三键；仅读时兼容，Admin 不再写入 */
export const WEB_SEARCH_API_KEY_KEY = 'WEB_SEARCH_API_KEY';
/** @deprecated 旧全局三键；仅读时兼容，Admin 不再写入 */
export const WEB_SEARCH_COST_KEY = 'WEB_SEARCH_COST';

export const WEB_SEARCH_ACTIVE_KEY = 'WEB_SEARCH_ACTIVE';
export const WEB_SEARCH_CATALOG_KEY = 'WEB_SEARCH_CATALOG';

/** 已实现的搜索引擎（Admin 下拉仅允许这些值） */
export const WEB_SEARCH_PROVIDERS = ['bocha', 'tavily', 'cleversee', 'tencent_wsa'] as const;
export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number];

export const DEFAULT_WEB_SEARCH_PROVIDER: WebSearchProvider = 'bocha';
/** 默认单价；数值单位随 Gateway `system_config.BILLING_CURRENCY`（USD/CNY…），非固定美元。 */
export const DEFAULT_WEB_SEARCH_COST = 0.001;

export type WebSearchCatalogEntry = {
	apiKey: string;
	/** @deprecated 兼容别名；等于 charged */
	cost: number;
	metered: number;
	standard: number;
	charged: number;
	pricing?: ToolCatalogPricingFields['pricing'];
};

export type WebSearchCatalog = Partial<Record<WebSearchProvider, WebSearchCatalogEntry>>;

export function isWebSearchProvider(value: string): value is WebSearchProvider {
	return (WEB_SEARCH_PROVIDERS as readonly string[]).includes(value);
}

export function parseWebSearchProviderInput(raw: string | null | undefined): WebSearchProvider | null {
	const v = raw?.trim().toLowerCase() ?? '';
	if (!v) {
		return null;
	}
	return isWebSearchProvider(v) ? v : null;
}

/** @deprecated 旧 COST 键解析；catalog 写入请用 {@link parseWebSearchCatalogInput} */
export function parseWebSearchCostInput(raw: string | null | undefined): number | null {
	return parseToolMoneyField(raw);
}

export function parseWebSearchActiveInput(raw: string | null | undefined): WebSearchProvider | null {
	return parseWebSearchProviderInput(raw);
}

function parseEntry(rec: Record<string, unknown>, strict: boolean): WebSearchCatalogEntry | null {
	if (typeof rec.apiKey !== 'string') {
		return null;
	}
	const prices = parseToolCatalogPricing(rec, DEFAULT_WEB_SEARCH_COST, strict);
	if (!prices) {
		return null;
	}
	return {
		apiKey: rec.apiKey.trim(),
		...prices,
	};
}

/**
 * 解析 catalog JSON。非法 JSON / 非对象 → `null`。
 * 白名单外的 key 丢弃；单项非法 → 整包 `null`（写入校验用）。
 */
export function parseWebSearchCatalogInput(raw: string | null | undefined): WebSearchCatalog | null {
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
	const out: WebSearchCatalog = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const provider = parseWebSearchProviderInput(key);
		if (!provider) {
			return null;
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return null;
		}
		const entry = parseEntry(value as Record<string, unknown>, true);
		if (!entry) {
			return null;
		}
		out[provider] = entry;
	}
	return out;
}

/** 宽松解析：丢弃非法单项与未知 provider（供 resolve / UI seed）。 */
export function parseWebSearchCatalogLenient(raw: string | null | undefined): WebSearchCatalog | null {
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
	const out: WebSearchCatalog = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const provider = parseWebSearchProviderInput(key);
		if (!provider || !value || typeof value !== 'object' || Array.isArray(value)) {
			continue;
		}
		const entry = parseEntry(value as Record<string, unknown>, false);
		if (!entry) {
			continue;
		}
		out[provider] = entry;
	}
	return out;
}

export function serializeWebSearchCatalog(catalog: WebSearchCatalog): string {
	const normalized: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(catalog) as [
		WebSearchProvider,
		WebSearchCatalogEntry | undefined
	][]) {
		if (!entry) continue;
		normalized[key] = {
			apiKey: entry.apiKey,
			...toolCatalogPricingForStorage(entry),
		};
	}
	return JSON.stringify(normalized);
}

export type ResolvedWebSearchConfig = {
	provider: WebSearchProvider;
	apiKey: string | null;
	/**
	 * @deprecated 等于 {@link charged}；保留给旧调用方。
	 */
	cost: number;
	metered: number;
	standard: number;
	charged: number;
	sources: {
		provider: 'system_config' | 'default';
		apiKey: 'system_config' | 'missing';
		cost: 'system_config' | 'default';
		/** 配置来自 catalog 还是旧三键兼容 */
		mode: 'catalog' | 'legacy';
	};
	pricing?: ToolCatalogPricingFields['pricing'];
};

export type ResolveWebSearchConfigResult =
	| { ok: true; config: ResolvedWebSearchConfig }
	| { ok: false; reason: 'invalid_provider'; raw: string }
	| { ok: false; reason: 'invalid_catalog' }
	| { ok: false; reason: 'active_missing_key'; provider: string };

function pricesFromEntry(entry: WebSearchCatalogEntry | undefined): ToolUnitPrices {
	if (!entry) {
		const d = roundGatewayMoney(DEFAULT_WEB_SEARCH_COST);
		return { metered: d, standard: d, charged: d };
	}
	return {
		metered: entry.metered,
		standard: entry.standard,
		charged: entry.charged ?? entry.cost,
	};
}

/**
 * 从 `system_config` 解析 Web Search 配置。
 * 优先 `WEB_SEARCH_CATALOG` + `WEB_SEARCH_ACTIVE`；无 catalog 时回退旧三键（不落库）。
 */
export async function resolveWebSearchConfig(
	repos: GatewayRepositories
): Promise<ResolveWebSearchConfigResult> {
	const [catalogRaw, activeRaw, legacyProviderRaw, legacyApiKeyRaw, legacyCostRaw] = await Promise.all([
		repos.systemConfig.getConfig(WEB_SEARCH_CATALOG_KEY),
		repos.systemConfig.getConfig(WEB_SEARCH_ACTIVE_KEY),
		repos.systemConfig.getConfig(WEB_SEARCH_PROVIDER_KEY),
		repos.systemConfig.getConfig(WEB_SEARCH_API_KEY_KEY),
		repos.systemConfig.getConfig(WEB_SEARCH_COST_KEY),
	]);

	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;
	if (catalogPresent) {
		const catalog = parseWebSearchCatalogLenient(catalogRaw);
		if (catalog == null) {
			return { ok: false, reason: 'invalid_catalog' };
		}

		const activeTrimmed = activeRaw?.trim() ?? '';
		let provider: WebSearchProvider;
		let providerSource: ResolvedWebSearchConfig['sources']['provider'];
		if (activeTrimmed) {
			const parsed = parseWebSearchActiveInput(activeTrimmed);
			if (!parsed) {
				return { ok: false, reason: 'invalid_provider', raw: activeTrimmed };
			}
			provider = parsed;
			providerSource = 'system_config';
		} else {
			provider = DEFAULT_WEB_SEARCH_PROVIDER;
			providerSource = 'default';
		}

		const entry = catalog[provider];
		const apiKey = entry?.apiKey?.trim() || '';
		if (!apiKey) {
			return { ok: false, reason: 'active_missing_key', provider };
		}

		const prices = pricesFromEntry(entry);
		const fromConfig = entry != null;
		return {
			ok: true,
			config: {
				provider,
				apiKey,
				cost: prices.charged,
				...prices,
				...(entry?.pricing ? { pricing: entry.pricing } : {}),
				sources: {
					provider: providerSource,
					apiKey: 'system_config',
					cost: fromConfig ? 'system_config' : 'default',
					mode: 'catalog',
				},
			},
		};
	}

	// 旧三键兼容（不落库）
	const providerTrimmed = legacyProviderRaw?.trim() ?? '';
	if (providerTrimmed) {
		const parsed = parseWebSearchProviderInput(providerTrimmed);
		if (!parsed) {
			return { ok: false, reason: 'invalid_provider', raw: providerTrimmed };
		}
		return { ok: true, config: buildLegacyResolved(parsed, 'system_config', legacyApiKeyRaw, legacyCostRaw) };
	}

	return {
		ok: true,
		config: buildLegacyResolved(DEFAULT_WEB_SEARCH_PROVIDER, 'default', legacyApiKeyRaw, legacyCostRaw),
	};
}

function buildLegacyResolved(
	provider: WebSearchProvider,
	providerSource: ResolvedWebSearchConfig['sources']['provider'],
	apiKeyRaw: string | null,
	costRaw: string | null
): ResolvedWebSearchConfig {
	const configKey = apiKeyRaw?.trim() || '';
	const parsedCost = parseWebSearchCostInput(costRaw);
	const unit = parsedCost ?? DEFAULT_WEB_SEARCH_COST;

	return {
		provider,
		apiKey: configKey || null,
		cost: unit,
		metered: unit,
		standard: unit,
		charged: unit,
		sources: {
			provider: providerSource,
			apiKey: configKey ? 'system_config' : 'missing',
			cost: parsedCost != null ? 'system_config' : 'default',
			mode: 'legacy',
		},
	};
}
