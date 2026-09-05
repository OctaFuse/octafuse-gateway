/**
 * 用户路由：`POST /v1/tools/ai-detection` — AI 率检测；按计费单元数 × 单价计入 budget_spent。
 * 引擎/凭证/单价读自 `system_config`（见 `resolveAiDetectionConfig`）。
 */
import { resolveAiDetectionConfig, roundGatewayMoney, scaleToolUnitPrices } from '@octafuse/core';
import { Hono } from 'hono';
import type { Env } from '../../../app';
import { requireApiKey } from '../../../middleware/auth';
import {
	AiDetectionProviderError,
	detectAiRate,
	getAiDetectionDriver,
} from '@octafuse/tool-engines/ai-detection';
import { apiKeyHasBalance, canAffordToolCost, chargeToolUsage } from '../../../services/tool-usage-charge';

type ToolsEnv = Env & { Variables: { apiKey: import('../../../middleware/auth').ApiKeyContext } };

export const aiDetectionRoutes = new Hono<ToolsEnv>();

aiDetectionRoutes.use('*', requireApiKey);

aiDetectionRoutes.post('/', async (c) => {
	const apiKey = c.get('apiKey');
	const repos = c.get('repositories');
	const resolved = await resolveAiDetectionConfig(repos);
	if (!resolved.ok) {
		if (resolved.reason === 'active_missing_key') {
			console.warn('[Gateway Tools] AI_DETECTION_ACTIVE has no credentials', resolved.provider);
			return c.json({ error: 'AI detection is not configured' }, 503);
		}
		if (resolved.reason === 'provider_not_implemented') {
			console.warn('[Gateway Tools] AI_DETECTION_ACTIVE not implemented', resolved.provider);
			return c.json({ error: 'AI detection provider is misconfigured' }, 503);
		}
		if (resolved.reason === 'invalid_catalog') {
			console.warn('[Gateway Tools] invalid AI_DETECTION_CATALOG');
			return c.json({ error: 'AI detection provider is misconfigured' }, 503);
		}
		console.warn('[Gateway Tools] invalid AI_DETECTION_ACTIVE', resolved.raw);
		return c.json({ error: 'AI detection provider is misconfigured' }, 503);
	}

	const {
		provider,
		metered: unitMetered,
		standard: unitStandard,
		charged: unitCharged,
		billingUnitChars,
	} = resolved.config;
	const driver = getAiDetectionDriver(provider);
	if (!driver) {
		console.warn('[Gateway Tools] AI detection driver missing', provider);
		return c.json({ error: 'AI detection provider is misconfigured' }, 503);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}

	const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const text = typeof record.text === 'string' ? record.text : '';
	const trimmed = text.trim();
	if (!trimmed) {
		return c.json({ error: 'text is required' }, 400);
	}

	const totalChars = [...trimmed].length;
	const billingUnits = Math.max(1, Math.ceil(totalChars / billingUnitChars));
	const unitPrices = { metered: unitMetered, standard: unitStandard, charged: unitCharged };
	const totals = scaleToolUnitPrices(unitPrices, billingUnits);
	const totalCharged = roundGatewayMoney(totals.charged);

	if (!apiKeyHasBalance(apiKey)) {
		return c.json({ error: 'Budget exceeded' }, 403);
	}
	if (!canAffordToolCost(apiKey.budgetMax, apiKey.budgetSpent, totalCharged, apiKey.walletGranted, apiKey.walletSpent)) {
		return c.json({ error: 'Budget exceeded' }, 403);
	}

	const started = Date.now();
	const logRequestBody = JSON.stringify({ total_chars: totalChars, billing_units: billingUnits, provider });

	try {
		const result = await detectAiRate(trimmed, driver, resolved.config);
		const latencyMs = Date.now() - started;

		const { chargedCost } = await chargeToolUsage({
			repos,
			apiKeyId: apiKey.keyId,
			userId: apiKey.userId,
			userEmail: apiKey.userEmail,
			ingressHost: apiKey.ingressHost,
			toolId: 'tool:ai-detection',
			toolProvider: provider,
			meteredCost: totals.metered,
			standardCost: totals.standard,
			chargedCost: totals.charged,
			pricingUnit: 'chars',
			billingUnits,
			unitPrices,
			latencyMs,
			requestBody: logRequestBody,
			// 仅分数汇总，不含 excerpt / 原文
			responseBody: JSON.stringify({
				overall_score: result.overallScore,
				total_chars: result.totalChars,
				billing_units: billingUnits,
				segment_count: result.segments.length,
				segments: result.segments.map((s) => ({
					index: s.index,
					chars: s.chars,
					score: s.score,
				})),
			}),
			status: 'success',
		});

		return c.json({
			data: {
				overall_score: result.overallScore,
				total_chars: result.totalChars,
				segments: result.segments.map((s) => ({
					index: s.index,
					chars: s.chars,
					score: s.score,
					excerpt: s.excerpt,
				})),
				billing_units: billingUnits,
				// 单位随 Gateway `BILLING_CURRENCY`
				cost: chargedCost,
			},
		});
	} catch (err) {
		const latencyMs = Date.now() - started;
		const message = err instanceof Error ? err.message : String(err);
		console.warn('[Gateway Tools] ai-detection failed', message);

		try {
			await chargeToolUsage({
				repos,
				apiKeyId: apiKey.keyId,
				userId: apiKey.userId,
				userEmail: apiKey.userEmail,
			ingressHost: apiKey.ingressHost,
				toolId: 'tool:ai-detection',
				toolProvider: provider,
				meteredCost: 0,
				standardCost: 0,
				chargedCost: 0,
				pricingUnit: 'chars',
				billingUnits,
				unitPrices,
				latencyMs,
				requestBody: logRequestBody,
				errorMessage: message,
				status: 'error',
			});
		} catch (logErr) {
			console.warn('[Gateway Tools] failed to log ai-detection error', logErr);
		}

		if (message === 'EMPTY_CONTENT') {
			return c.json({ error: 'text is required' }, 400);
		}
		if (err instanceof AiDetectionProviderError) {
			const status = err.status >= 400 && err.status < 600 ? err.status : 502;
			if (status === 401 || status === 403) {
				return c.json({ error: 'AI detection provider rejected the request' }, 502);
			}
			return c.json({ error: message }, status === 400 ? 400 : 502);
		}
		return c.json({ error: 'AI detection failed' }, 502);
	}
});
