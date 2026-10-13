/**
 * Agent Web Fetch（`POST /v1/tools/web-fetch`）的 `system_config` 键与解析。
 * 权威配置：`WEB_FETCH_ACTIVE` + `WEB_FETCH_CATALOG`（JSON）；旧三键仅读时兼容。
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
	/** @deprecated 兼容别名；等于 charged */
	cost: number;
	metered: number;
	standard: number;
	charged: number;
	pricing?: ToolCatalogPricingFields['pricing'];
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
	return parseToolMoneyField(raw);
}

export function parseWebFetchActiveInput(raw: string | null | undefined): WebFetchProvider | null {
	return parseWebFetchProviderInput(raw);
}

function parseEntry(rec: Record<string, unknown>, strict: boolean): WebFetchCatalogEntry | null {
	if (typeof rec.apiKey !== 'string') {
		return null;
	}
	const prices = parseToolCatalogPricing(rec, DEFAULT_WEB_FETCH_COST, strict);
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
		const entry = parseEntry(value as Record<string, unknown>, true);
		if (!entry) {
			return null;
		}
		out[provider] = entry;
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
		const entry = parseEntry(value as Record<string, unknown>, false);
		if (!entry) {
			continue;
		}
		out[provider] = entry;
	}
	return out;
}

export function serializeWebFetchCatalog(catalog: WebFetchCatalog): string {
	const normalized: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(catalog) as [
		WebFetchProvider,
		WebFetchCatalogEntry | undefined
	][]) {
		if (!entry) continue;
		normalized[key] = {
			apiKey: entry.apiKey,
			...toolCatalogPricingForStorage(entry),
		};
	}
	return JSON.stringify(normalized);
}

export type ResolvedWebFetchConfig = {
	provider: WebFetchProvider;
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
		mode: 'catalog' | 'legacy';
	};
	pricing?: ToolCatalogPricingFields['pricing'];
};

export type ResolveWebFetchConfigResult =
	| { ok: true; config: ResolvedWebFetchConfig }
	| { ok: false; reason: 'invalid_provider'; raw: string }
	| { ok: false; reason: 'invalid_catalog' }
	| { ok: false; reason: 'active_missing_key'; provider: string };

function pricesFromEntry(entry: WebFetchCatalogEntry | undefined): ToolUnitPrices {
	if (!entry) {
		const d = roundGatewayMoney(DEFAULT_WEB_FETCH_COST);
		return { metered: d, standard: d, charged: d };
	}
	return {
		metered: entry.metered,
		standard: entry.standard,
		charged: entry.charged ?? entry.cost,
	};
}

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
	const unit = parsedCost ?? DEFAULT_WEB_FETCH_COST;

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
