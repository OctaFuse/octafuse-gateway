/**
 * New API（QuantumNous/new-api，One API 兼容系）余额查询：
 * - `GET /dashboard/billing/subscription` → `hard_limit_usd` = 剩余 + 已用（总额度）
 * - `GET /dashboard/billing/usage` → `total_usage` = 已用（美分）
 * 两个端点同时挂在 `/v1/dashboard/billing/…`，均用 Bearer API Key 认证。
 * 业务失败返回 HTTP 200 + `{"error": …}`，按上游错误处理。
 * 金额单位跟随站点「额度显示类型」设置，通常为 USD；剩余 = 总额度 − 已用。
 * 源码：https://github.com/QuantumNous/new-api/blob/main/controller/billing.go
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, ProviderQuotaUpstreamError, type ProviderQuotaAdapter } from '../types';

function rejectEmbeddedError(body: unknown): void {
	if (isJsonRecord(body) && isJsonRecord(body.error)) {
		throw new ProviderQuotaUpstreamError(200, 'Upstream quota request failed (200)');
	}
}

export const newApiQuotaAdapter: ProviderQuotaAdapter = {
	id: 'new-api',
	defaultOrigin: 'https://new-api.invalid',
	selfHosted: true,
	async fetch(ctx) {
		const subscription = await fetchProviderQuotaJson(ctx, '/dashboard/billing/subscription');
		rejectEmbeddedError(subscription);
		const hardLimit = isJsonRecord(subscription) ? finiteNumber(subscription.hard_limit_usd) : null;
		if (hardLimit == null) throw new ProviderQuotaParseError();

		const usage = await fetchProviderQuotaJson(ctx, '/dashboard/billing/usage');
		rejectEmbeddedError(usage);
		const totalUsage = isJsonRecord(usage) ? finiteNumber(usage.total_usage) : null;
		if (totalUsage == null) throw new ProviderQuotaParseError();

		const used = totalUsage / 100;
		const remaining = hardLimit - used;
		return buildProviderQuotaSnapshot({
			adapter: 'new-api',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: [{ currency: 'USD', total: remaining }],
			windows: [
				{
					id: 'quota',
					unit: 'currency',
					used,
					limit: hardLimit,
					remaining,
					...(hardLimit > 0 ? { usedPercent: (used / hardLimit) * 100 } : {}),
					resetsAt: null,
				},
			],
		});
	},
};
