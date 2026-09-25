/**
 * DeepInfra `GET /payment/checklist`。
 * 文档：https://docs.deepinfra.com/api-reference/billing/get-checklist
 * `stripe_balance` 为负表示可消费预付金额（USD），为正表示欠款。
 * `limit` 是消费上限；`recent` 是最近一张账单之后的用量。账号被暂停时视为不可用。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import {
	ProviderQuotaParseError,
	type ProviderQuotaAdapter,
	type ProviderQuotaBalance,
	type ProviderQuotaWindow,
} from '../types';

export const deepinfraQuotaAdapter: ProviderQuotaAdapter = {
	id: 'deepinfra',
	defaultOrigin: 'https://api.deepinfra.com',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/payment/checklist');
		if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
		const stripeBalance = finiteNumber(body.stripe_balance);
		if (stripeBalance == null) throw new ProviderQuotaParseError();
		const available = stripeBalance < 0 ? -stripeBalance : 0;
		const limit = finiteNumber(body.limit);
		const recent = finiteNumber(body.recent);
		const windows: ProviderQuotaWindow[] = [];
		if (limit != null && limit > 0 && recent != null) {
			const remaining = limit - recent;
			windows.push({
				id: 'spend_limit',
				unit: 'currency',
				used: recent,
				limit,
				remaining,
				usedPercent: (recent / limit) * 100,
				resetsAt: null,
			});
		}
		const balances: ProviderQuotaBalance[] =
			available > 0 || windows.length === 0 ? [{ currency: 'USD', total: available }] : [];
		return buildProviderQuotaSnapshot({
			adapter: 'deepinfra',
			checkedAt: quotaCheckedAt(ctx.now),
			balances,
			windows,
			unavailable: body.suspended === true,
		});
	},
};
