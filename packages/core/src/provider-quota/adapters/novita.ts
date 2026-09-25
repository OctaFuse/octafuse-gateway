/**
 * Novita `GET /openapi/v1/billing/balance/detail`。
 * 文档：https://novita.ai/docs/api-reference/basic-get-user-balance
 * 金额是 1/10000 USD 的整数字符串（`10000` = $1）。`availableBalance` 是可用余额，
 * `cashBalance` 是充值剩余。`creditLimit` 是可欠款上限，不是已用额度。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, type ProviderQuotaAdapter } from '../types';

function usdFromTenThousandths(value: unknown): number | null {
	const raw = finiteNumber(value);
	if (raw == null) return null;
	return raw / 10_000;
}

export const novitaQuotaAdapter: ProviderQuotaAdapter = {
	id: 'novita',
	defaultOrigin: 'https://api.novita.ai',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/openapi/v1/billing/balance/detail');
		if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
		const total = usdFromTenThousandths(body.availableBalance);
		if (total == null) throw new ProviderQuotaParseError();
		const paid = usdFromTenThousandths(body.cashBalance);
		return buildProviderQuotaSnapshot({
			adapter: 'novita',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: [
				{
					currency: 'USD',
					total,
					...(paid == null ? {} : { paid }),
				},
			],
			windows: [],
		});
	},
};
