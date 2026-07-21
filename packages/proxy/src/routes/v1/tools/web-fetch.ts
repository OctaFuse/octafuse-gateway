/**
 * 用户路由：`POST /v1/tools/web-fetch` — 网页抓取工具；成功后按固定单价计入 budget_spent。
 * 引擎/密钥/单价读自 `system_config`（见 `resolveWebFetchConfig`）。
 */
import { resolveWebFetchConfig } from '@octafuse/core';
import { Hono } from 'hono';
import type { Env } from '../../../app';
import { requireApiKey } from '../../../middleware/auth';
import { canAffordToolCost, chargeToolUsage } from '../../../services/tool-usage-charge';
import {
	assertFetchUrlSafe,
	fetchUrlByProvider,
	WebFetchProviderError,
} from '../../../services/web-fetch';

type ToolsEnv = Env & { Variables: { apiKey: import('../../../middleware/auth').ApiKeyContext } };

export const webFetchRoutes = new Hono<ToolsEnv>();

webFetchRoutes.use('*', requireApiKey);

webFetchRoutes.post('/', async (c) => {
	const apiKey = c.get('apiKey');
	const repos = c.get('repositories');
	const resolved = await resolveWebFetchConfig(repos);
	if (!resolved.ok) {
		if (resolved.reason === 'active_missing_key') {
			console.warn('[Gateway Tools] WEB_FETCH_ACTIVE has no API key', resolved.provider);
			return c.json({ error: 'Web fetch is not configured' }, 503);
		}
		if (resolved.reason === 'invalid_catalog') {
			console.warn('[Gateway Tools] invalid WEB_FETCH_CATALOG');
			return c.json({ error: 'Web fetch provider is misconfigured' }, 503);
		}
		console.warn('[Gateway Tools] invalid WEB_FETCH_ACTIVE', resolved.raw);
		return c.json({ error: 'Web fetch provider is misconfigured' }, 503);
	}

	const { provider, apiKey: providerApiKey, cost: toolCost } = resolved.config;
	if (!providerApiKey) {
		return c.json({ error: 'Web fetch is not configured' }, 503);
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
	const urlRaw = typeof record.url === 'string' ? record.url : '';
	const guarded = assertFetchUrlSafe(urlRaw);
	if (!guarded.ok) {
		return c.json({ error: guarded.error }, 400);
	}

	const started = Date.now();

	try {
		const result = await fetchUrlByProvider(provider, {
			apiKey: providerApiKey,
			url: guarded.url,
		});

		const latencyMs = Date.now() - started;
		const { chargedCost } = await chargeToolUsage({
			repos,
			apiKeyId: apiKey.keyId,
			userId: apiKey.userId,
			userEmail: apiKey.userEmail,
			toolId: 'tool:web-fetch',
			chargedCost: toolCost,
			latencyMs,
			requestBody: JSON.stringify({
				url: guarded.url,
				provider,
			}),
			responseBody: JSON.stringify({
				url: result.url,
				title: result.title,
				content_preview: result.content.slice(0, 240),
				content_length: result.content.length,
			}),
			status: 'success',
		});

		return c.json({
			data: {
				url: result.url,
				title: result.title,
				content: result.content,
				// 单位随 Gateway `BILLING_CURRENCY`（USD/CNY…），非固定美元
				cost: chargedCost,
			},
		});
	} catch (err) {
		const latencyMs = Date.now() - started;
		const message = err instanceof Error ? err.message : String(err);
		console.warn('[Gateway Tools] web-fetch failed', message);
		try {
			await chargeToolUsage({
				repos,
				apiKeyId: apiKey.keyId,
				userId: apiKey.userId,
				userEmail: apiKey.userEmail,
				toolId: 'tool:web-fetch',
				chargedCost: 0,
				latencyMs,
				requestBody: JSON.stringify({ url: guarded.url, provider }),
				errorMessage: message,
				status: 'error',
			});
		} catch (logErr) {
			console.warn('[Gateway Tools] failed to log web-fetch error', logErr);
		}

		if (err instanceof WebFetchProviderError) {
			const status = err.status >= 400 && err.status < 600 ? err.status : 502;
			// 勿把引擎 401 原样透出为「用户 Key 无效」
			if (status === 401 || status === 403) {
				return c.json({ error: 'Web fetch provider rejected the request' }, 502);
			}
			return c.json({ error: message }, status === 400 ? 400 : 502);
		}
		return c.json({ error: 'Web fetch failed' }, 502);
	}
});
