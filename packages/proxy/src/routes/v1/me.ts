/**
 * 用户路由：`GET /v1/me` — 返回当前用户预算周期、已用额度与 metadata（优先 `users.metadata`，回退 key metadata）。
 */
import { Hono } from 'hono';
import {
	BILLING_CURRENCY_KEY,
	getSystemConfigValue,
	normalizeApiTimeFields,
	normalizeBillingCurrencyCode,
} from '@octafuse/core';
import type { Env } from '../../app';
import { requireApiKey } from '../../middleware/auth';

type MeEnv = Env & { Variables: { apiKey: import('../../middleware/auth').ApiKeyContext } };

export const meRoutes = new Hono<MeEnv>();

meRoutes.use('*', requireApiKey);

/** 无查询参数；响应字段来自鉴权后的 `apiKey` 上下文与 `system_config`。 */
meRoutes.get('/', async (c) => {
  const apiKey = c.get('apiKey');
  const repos = c.get('repositories');
  const rawCurrency = await getSystemConfigValue(repos, BILLING_CURRENCY_KEY);
  const billing_currency = normalizeBillingCurrencyCode(rawCurrency);
  return c.json(
    normalizeApiTimeFields({
      budget_max: apiKey.budgetMax,
      budget_spent: apiKey.budgetSpent,
      budget_period: apiKey.budgetPeriod,
      budget_reset_at: apiKey.budgetResetAt,
      billing_currency,
      metadata: apiKey.metadata,
    })
  );
});
