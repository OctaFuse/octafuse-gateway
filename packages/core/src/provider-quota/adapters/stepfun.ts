/**
 * 阶跃星辰 `GET /v1/accounts`。
 * 文档：https://platform.stepfun.com/docs/zh/api-reference/accounts/get
 * 响应没有币种字段。中国站控制台金额单位是元，这里记为 CNY。
 * `total_cash_balance` / `total_voucher_balance` 是累计充值和累计赠送，不是剩余金额，不写入快照。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, type ProviderQuotaAdapter } from '../types';

export const stepfunQuotaAdapter: ProviderQuotaAdapter = {
	id: 'stepfun',
	defaultOrigin: 'https://api.stepfun.com',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/v1/accounts');
		if (!isJsonRecord(body) || body.object !== 'account') throw new ProviderQuotaParseError();
		const total = finiteNumber(body.balance);
		if (total == null) throw new ProviderQuotaParseError();
		return buildProviderQuotaSnapshot({
			adapter: 'stepfun',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: [{ currency: 'CNY', total }],
			windows: [],
		});
	},
};
