/**
 * Agent Web Search（`POST /v1/tools/web-search`）的 `system_config` 键与解析。
 * 唯一配置源：Admin `system_config`（无环境变量回退）。
 */

import type { GatewayRepositories } from '../storage/repositories';
import { roundGatewayMoney } from './money-precision';

export const WEB_SEARCH_PROVIDER_KEY = 'WEB_SEARCH_PROVIDER';
export const WEB_SEARCH_API_KEY_KEY = 'WEB_SEARCH_API_KEY';
export const WEB_SEARCH_COST_KEY = 'WEB_SEARCH_COST';

/** 已实现的搜索引擎（Admin 下拉仅允许这些值） */
export const WEB_SEARCH_PROVIDERS = ['bocha', 'tavily', 'cleversee', 'tencent_wsa'] as const;
export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number];

export const DEFAULT_WEB_SEARCH_PROVIDER: WebSearchProvider = 'bocha';
/** 默认单价；数值单位随 Gateway `system_config.BILLING_CURRENCY`（USD/CNY…），非固定美元。 */
export const DEFAULT_WEB_SEARCH_COST = 0.001;

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

export function parseWebSearchCostInput(raw: string | null | undefined): number | null {
	if (raw == null || !String(raw).trim()) {
		return null;
	}
	const n = Number(String(raw).trim());
	if (!Number.isFinite(n) || n < 0) {
		return null;
	}
	return roundGatewayMoney(n);
}

export type ResolvedWebSearchConfig = {
	provider: WebSearchProvider;
	apiKey: string | null;
	/** 单价；单位随 Gateway 计费币种（`BILLING_CURRENCY`）。 */
	cost: number;
	sources: {
		provider: 'system_config' | 'default';
		apiKey: 'system_config' | 'missing';
		cost: 'system_config' | 'default';
	};
};

export type ResolveWebSearchConfigResult =
	| { ok: true; config: ResolvedWebSearchConfig }
	| { ok: false; reason: 'invalid_provider'; raw: string };

/**
 * 从 `system_config` 解析 Web Search 配置。
 * 若 `WEB_SEARCH_PROVIDER` 已写入但非白名单 → `ok: false`（勿静默回退）。
 */
export async function resolveWebSearchConfig(
	repos: GatewayRepositories
): Promise<ResolveWebSearchConfigResult> {
	const [providerRaw, apiKeyRaw, costRaw] = await Promise.all([
		repos.systemConfig.getConfig(WEB_SEARCH_PROVIDER_KEY),
		repos.systemConfig.getConfig(WEB_SEARCH_API_KEY_KEY),
		repos.systemConfig.getConfig(WEB_SEARCH_COST_KEY),
	]);

	const providerTrimmed = providerRaw?.trim() ?? '';
	if (providerTrimmed) {
		const parsed = parseWebSearchProviderInput(providerTrimmed);
		if (!parsed) {
			return { ok: false, reason: 'invalid_provider', raw: providerTrimmed };
		}
		return { ok: true, config: buildResolved(parsed, 'system_config', apiKeyRaw, costRaw) };
	}

	return {
		ok: true,
		config: buildResolved(DEFAULT_WEB_SEARCH_PROVIDER, 'default', apiKeyRaw, costRaw),
	};
}

function buildResolved(
	provider: WebSearchProvider,
	providerSource: ResolvedWebSearchConfig['sources']['provider'],
	apiKeyRaw: string | null,
	costRaw: string | null
): ResolvedWebSearchConfig {
	const configKey = apiKeyRaw?.trim() || '';
	const parsedCost = parseWebSearchCostInput(costRaw);

	return {
		provider,
		apiKey: configKey || null,
		cost: parsedCost ?? DEFAULT_WEB_SEARCH_COST,
		sources: {
			provider: providerSource,
			apiKey: configKey ? 'system_config' : 'missing',
			cost: parsedCost != null ? 'system_config' : 'default',
		},
	};
}
