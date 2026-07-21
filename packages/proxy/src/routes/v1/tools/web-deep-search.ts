/**
 * 用户路由：`POST /v1/tools/web-deep-search` — 搜+读一体；成功后按固定单价计入 budget_spent。
 */
import { resolveWebDeepSearchConfig } from '@octafuse/core';
import { Hono } from 'hono';
import type { Env } from '../../../app';
import { requireApiKey } from '../../../middleware/auth';
import { canAffordToolCost, chargeToolUsage } from '../../../services/tool-usage-charge';
import {
	clampDeepSearchCount,
	deepSearchByProvider,
	WebDeepSearchProviderError,
} from '../../../services/web-deep-search';

type ToolsEnv = Env & { Variables: { apiKey: import('../../../middleware/auth').ApiKeyContext } };

export const webDeepSearchRoutes = new Hono<ToolsEnv>();

webDeepSearchRoutes.use('*', requireApiKey);

webDeepSearchRoutes.post('/', async (c) => {
	const apiKey = c.get('apiKey');
	const repos = c.get('repositories');
	const resolved = await resolveWebDeepSearchConfig(repos);
	if (!resolved.ok) {
		if (resolved.reason === 'active_missing_key') {
			console.warn('[Gateway Tools] WEB_DEEP_SEARCH_ACTIVE has no API key', resolved.provider);
			return c.json({ error: 'Web deep search is not configured' }, 503);
		}
		if (resolved.reason === 'invalid_catalog') {
			console.warn('[Gateway Tools] invalid WEB_DEEP_SEARCH_CATALOG');
			return c.json({ error: 'Web deep search provider is misconfigured' }, 503);
		}
		console.warn('[Gateway Tools] invalid WEB_DEEP_SEARCH_ACTIVE', resolved.raw);
		return c.json({ error: 'Web deep search provider is misconfigured' }, 503);
	}

	const { provider, apiKey: providerApiKey, cost: toolCost } = resolved.config;
	if (!providerApiKey) {
		return c.json({ error: 'Web deep search is not configured' }, 503);
	}

	if (apiKey.budgetMax != null && apiKey.budgetSpent >= apiKey.budgetMax) {
		return c.json({ error: 'Budget exceeded' }, 403);
	}
	if (!canAffordToolCost(apiKey.budgetMax, apiKey.budgetSpent, toolCost)) {
		return c.json({ error: 'Budget exceeded' }, 403);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}

	const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const query = typeof record.query === 'string' ? record.query.trim() : '';
	if (query.length < 2) {
		return c.json({ error: 'query must be at least 2 characters' }, 400);
	}

	const count = typeof record.count === 'number' ? clampDeepSearchCount(record.count) : undefined;
	const started = Date.now();

	try {
		const results = await deepSearchByProvider(provider, {
			apiKey: providerApiKey,
			query,
			count,
		});

		const latencyMs = Date.now() - started;
		const { chargedCost } = await chargeToolUsage({
			repos,
			apiKeyId: apiKey.keyId,
			userId: apiKey.userId,
			userEmail: apiKey.userEmail,
			toolId: 'tool:web-deep-search',
			chargedCost: toolCost,
			latencyMs,
			requestBody: JSON.stringify({ query, provider, count }),
			responseBody: JSON.stringify({
				result_count: results.length,
				results: results.map((r) => ({
					title: r.title,
					url: r.url,
					snippet: r.snippet?.slice(0, 240),
					content_preview: r.content?.slice(0, 240),
				})),
			}),
			status: 'success',
		});

		return c.json({
			data: {
				results,
				cost: chargedCost,
			},
		});
	} catch (err) {
		const latencyMs = Date.now() - started;
		const message = err instanceof Error ? err.message : String(err);
		console.warn('[Gateway Tools] web-deep-search failed', message);
		try {
			await chargeToolUsage({
				repos,
				apiKeyId: apiKey.keyId,
				userId: apiKey.userId,
				userEmail: apiKey.userEmail,
				toolId: 'tool:web-deep-search',
				chargedCost: 0,
				latencyMs,
				requestBody: JSON.stringify({ query, provider }),
				errorMessage: message,
				status: 'error',
			});
		} catch (logErr) {
			console.warn('[Gateway Tools] failed to log web-deep-search error', logErr);
		}

		if (err instanceof WebDeepSearchProviderError) {
			const status = err.status >= 400 && err.status < 600 ? err.status : 502;
			if (status === 401 || status === 403) {
				return c.json({ error: 'Web deep search provider rejected the request' }, 502);
			}
			return c.json({ error: message }, status === 400 ? 400 : 502);
		}
		return c.json({ error: 'Web deep search failed' }, 502);
	}
});
