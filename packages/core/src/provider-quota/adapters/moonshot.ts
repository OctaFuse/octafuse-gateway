/**
 * Moonshot `GET /v1/users/me/balance`。
 * 文档：https://platform.kimi.ai/docs/api/balance
 * 响应不含币种：`api.moonshot.cn` 为 CNY，`api.moonshot.ai` 为 USD。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, ProviderQuotaUpstreamError, type ProviderQuotaAdapter } from '../types';

function currencyForOrigin(origin: string): string {
	const hostname = new URL(origin).hostname.toLowerCase();
	return hostname === 'api.moonshot.ai' || hostname.endsWith('.moonshot.ai') ? 'USD' : 'CNY';
}

export const moonshotQuotaAdapter: ProviderQuotaAdapter = {
	id: 'moonshot',
	defaultOrigin: 'https://api.moonshot.cn',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/v1/users/me/balance');
		if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
		if (body.code != null && body.code !== 0) {
			throw new ProviderQuotaUpstreamError(200, 'Upstream quota request failed (200)');
		}
		if (body.status === false) {
			throw new ProviderQuotaUpstreamError(200, 'Upstream quota request failed (200)');
		}
		const data = isJsonRecord(body.data) ? body.data : body;
		const total = finiteNumber(data.available_balance);
		const granted = finiteNumber(data.voucher_balance);
		const paid = finiteNumber(data.cash_balance);
		if (total == null) throw new ProviderQuotaParseError();
		return buildProviderQuotaSnapshot({
			adapter: 'moonshot',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: [
				{
					currency: currencyForOrigin(ctx.origin),
					total,
					...(granted == null ? {} : { granted }),
					...(paid == null ? {} : { paid }),
				},
			],
			windows: [],
		});
	},
};
