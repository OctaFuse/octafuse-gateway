/**
 * 用户路由：`GET /v1/tools/pricing` — 只读工具定价（不含 provider 密钥与 Active 引擎名）。
 * 返回三账本单价；`cost` 为 charged 兼容别名。
 */
import {
	BILLING_CURRENCY_KEY,
	DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS,
	DEFAULT_AI_DETECTION_COST,
	DEFAULT_WEB_DEEP_SEARCH_COST,
	DEFAULT_WEB_FETCH_COST,
	DEFAULT_WEB_SEARCH_COST,
	normalizeBillingCurrencyCode,
	resolveAiDetectionConfig,
	resolveWebDeepSearchConfig,
	resolveWebFetchConfig,
	resolveWebSearchConfig,
	roundGatewayMoney,
} from '@octafuse/core';
import { Hono } from 'hono';
import type { Env } from '../../../app';
import { requireApiKey } from '../../../middleware/auth';

type ToolsEnv = Env & { Variables: { apiKey: import('../../../middleware/auth').ApiKeyContext } };

export const toolsPricingRoutes = new Hono<ToolsEnv>();

toolsPricingRoutes.use('*', requireApiKey);

type ToolPricingRow =
	| { id: string; unit: 'request'; cost: number; metered: number; standard: number; charged: number }
	| {
			id: string;
			unit: 'chars';
			unit_chars: number;
			cost: number;
			metered: number;
			standard: number;
			charged: number;
	  };

function tripleOrDefault(config: {
	metered: number;
	standard: number;
	charged: number;
} | null, defaultCost: number) {
	if (!config) {
		const d = roundGatewayMoney(defaultCost);
		return { metered: d, standard: d, charged: d, cost: d };
	}
	return {
		metered: config.metered,
		standard: config.standard,
		charged: config.charged,
		cost: config.charged,
	};
}

toolsPricingRoutes.get('/', async (c) => {
	const repos = c.get('repositories');

	const [billingRaw, webSearch, webFetch, webDeepSearch, aiDetection] = await Promise.all([
		repos.systemConfig.getConfig(BILLING_CURRENCY_KEY),
		resolveWebSearchConfig(repos),
		resolveWebFetchConfig(repos),
		resolveWebDeepSearchConfig(repos),
		resolveAiDetectionConfig(repos),
	]);

	const searchPrices = tripleOrDefault(webSearch.ok ? webSearch.config : null, DEFAULT_WEB_SEARCH_COST);
	const fetchPrices = tripleOrDefault(webFetch.ok ? webFetch.config : null, DEFAULT_WEB_FETCH_COST);
	const deepPrices = tripleOrDefault(webDeepSearch.ok ? webDeepSearch.config : null, DEFAULT_WEB_DEEP_SEARCH_COST);
	const detectPrices = tripleOrDefault(aiDetection.ok ? aiDetection.config : null, DEFAULT_AI_DETECTION_COST);

	const tools: ToolPricingRow[] = [
		{
			id: 'web-search',
			unit: 'request',
			...searchPrices,
		},
		{
			id: 'web-fetch',
			unit: 'request',
			...fetchPrices,
		},
		{
			id: 'web-deep-search',
			unit: 'request',
			...deepPrices,
		},
		{
			id: 'ai-detection',
			unit: 'chars',
			unit_chars: aiDetection.ok
				? aiDetection.config.billingUnitChars
				: DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS,
			...detectPrices,
		},
	];

	const mcpPrices = await repos.mcpServers.listEnabledToolPrices().catch((error: unknown) => {
		console.warn('[Gateway Tools] MCP pricing unavailable', error instanceof Error ? error.message : error);
		return [];
	});

	return c.json({
		data: {
			billing_currency: normalizeBillingCurrencyCode(billingRaw),
			tools,
			mcp: mcpPrices.map((row) => ({
				id: `mcp:${row.slug}/${row.upstreamKey}`,
				name: row.exposedName,
				unit: 'request' as const,
				metered: row.metered,
				standard: row.standard,
				charged: row.charged,
				cost: row.charged,
			})),
		},
	});
});
