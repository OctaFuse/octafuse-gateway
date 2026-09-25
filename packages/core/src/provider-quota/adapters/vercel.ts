/**
 * Vercel AI Gateway `GET /v1/credits`。
 * 文档：https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api
 * `balance` 是剩余额度（USD 字符串）。`total_used` 是累计消耗，没有对应上限，不做成窗口。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, type ProviderQuotaAdapter } from '../types';

export const vercelQuotaAdapter: ProviderQuotaAdapter = {
	id: 'vercel',
	defaultOrigin: 'https://ai-gateway.vercel.sh',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/v1/credits');
		if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
		const total = finiteNumber(body.balance);
		if (total == null) throw new ProviderQuotaParseError();
		return buildProviderQuotaSnapshot({
			adapter: 'vercel',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: [{ currency: 'USD', total }],
			windows: [],
		});
	},
};
