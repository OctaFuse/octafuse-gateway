/**
 * 用户路由：`POST /v1/tools/web-search` — 联网搜索工具；成功后按固定单价计入 budget_spent。
 * 引擎/密钥/单价读自 `system_config`（见 `resolveWebSearchConfig`）。
 */
import { resolveWebSearchConfig } from '@octafuse/core';
import { Hono } from 'hono';
import type { Env } from '../../../app';
import { requireApiKey } from '../../../middleware/auth';
import { BochaWebSearchError, searchBochaWeb } from '../../../services/bocha-web-search';
import { canAffordToolCost, chargeToolUsage } from '../../../services/tool-usage-charge';

type ToolsEnv = Env & { Variables: { apiKey: import('../../../middleware/auth').ApiKeyContext } };

export const webSearchRoutes = new Hono<ToolsEnv>();

webSearchRoutes.use('*', requireApiKey);

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
	return out.length > 0 ? out : undefined;
}

webSearchRoutes.post('/', async (c) => {
	const apiKey = c.get('apiKey');
	const repos = c.get('repositories');
	const resolved = await resolveWebSearchConfig(repos);
	if (!resolved.ok) {
		console.warn('[Gateway Tools] invalid WEB_SEARCH_PROVIDER', resolved.raw);
		return c.json({ error: 'Web search provider is misconfigured' }, 503);
	}

	const { provider, apiKey: providerApiKey, costUsd: toolCost } = resolved.config;
	if (!providerApiKey) {
		return c.json({ error: 'Web search is not configured' }, 503);
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

	const allowedDomains = asStringArray(record.allowed_domains);
	const blockedDomains = asStringArray(record.blocked_domains);
	if (allowedDomains?.length && blockedDomains?.length) {
		return c.json({ error: 'Cannot specify both allowed_domains and blocked_domains' }, 400);
	}

	const count = typeof record.count === 'number' ? record.count : undefined;
	const started = Date.now();

	try {
		let results: Awaited<ReturnType<typeof searchBochaWeb>>;
		if (provider === 'bocha') {
			results = await searchBochaWeb({
				apiKey: providerApiKey,
				query,
				count,
				allowedDomains,
				blockedDomains,
			});
		} else {
			// 类型上不应到达；白名单扩展时在此分支新引擎
			return c.json({ error: 'Web search provider is not implemented' }, 503);
		}

		const latencyMs = Date.now() - started;
		const { chargedCost } = await chargeToolUsage({
			repos,
			apiKeyId: apiKey.keyId,
			userId: apiKey.userId,
			userEmail: apiKey.userEmail,
			toolId: 'tool:web-search',
			chargedCost: toolCost,
			latencyMs,
			requestBody: JSON.stringify({
				query,
				provider,
				allowed_domains: allowedDomains,
				blocked_domains: blockedDomains,
				count,
			}),
			responseBody: JSON.stringify({
				result_count: results.length,
				results: results.map((r) => ({
					title: r.title,
					url: r.url,
					snippet: r.snippet?.slice(0, 240) || r.summary?.slice(0, 240) || undefined,
					siteName: r.siteName,
				})),
			}),
			status: 'success',
		});

		return c.json({
			data: {
				results,
				cost_usd: chargedCost,
			},
		});
	} catch (err) {
		const latencyMs = Date.now() - started;
		const message = err instanceof Error ? err.message : String(err);
		console.warn('[Gateway Tools] web-search failed', message);
		// 上游失败不扣费；可选写 error 日志（charged=0）
		try {
			await chargeToolUsage({
				repos,
				apiKeyId: apiKey.keyId,
				userId: apiKey.userId,
				userEmail: apiKey.userEmail,
				toolId: 'tool:web-search',
				chargedCost: 0,
				latencyMs,
				requestBody: JSON.stringify({ query, provider }),
				errorMessage: message,
				status: 'error',
			});
		} catch (logErr) {
			console.warn('[Gateway Tools] failed to log web-search error', logErr);
		}

		if (err instanceof BochaWebSearchError) {
			const status = err.status >= 400 && err.status < 600 ? err.status : 502;
			// 勿把博查 401 原样透出为「用户 Key 无效」
			if (status === 401 || status === 403) {
				return c.json({ error: 'Web search provider rejected the request' }, 502);
			}
			return c.json({ error: message }, status === 400 ? 400 : 502);
		}
		return c.json({ error: 'Web search failed' }, 502);
	}
});
