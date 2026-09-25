/** DeepSeek `GET /user/balance`：https://api-docs.deepseek.com/api/get-user-balance/ */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, type ProviderQuotaAdapter, type ProviderQuotaBalance } from '../types';

export const deepseekQuotaAdapter: ProviderQuotaAdapter = {
	id: 'deepseek',
	defaultOrigin: 'https://api.deepseek.com',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/user/balance');
		if (!isJsonRecord(body) || !Array.isArray(body.balance_infos)) {
			throw new ProviderQuotaParseError();
		}
		const balances: ProviderQuotaBalance[] = [];
		for (const entry of body.balance_infos) {
			if (!isJsonRecord(entry)) throw new ProviderQuotaParseError();
			const currency = typeof entry.currency === 'string' ? entry.currency.trim() : '';
			const total = finiteNumber(entry.total_balance);
			if (!currency || total == null) throw new ProviderQuotaParseError();
			const granted = finiteNumber(entry.granted_balance);
			const paid = finiteNumber(entry.topped_up_balance);
			balances.push({
				currency,
				total,
				...(granted == null ? {} : { granted }),
				...(paid == null ? {} : { paid }),
			});
		}
		if (balances.length === 0) throw new ProviderQuotaParseError();
		return buildProviderQuotaSnapshot({
			adapter: 'deepseek',
			checkedAt: quotaCheckedAt(ctx.now),
			balances,
			windows: [],
			unavailable: body.is_available === false,
		});
	},
};
