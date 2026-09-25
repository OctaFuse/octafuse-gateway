/**
 * SiliconFlow `GET /v1/user/info`。
 * 文档：https://docs.siliconflow.com/cn/api-reference/userinfo/get-user-info
 * 成功业务码 `20000`。`balance` + `chargeBalance` = `totalBalance`（赠送 + 充值）。
 * 响应不含币种：`.cn` 为 CNY，`.com` 为 USD。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, ProviderQuotaUpstreamError, type ProviderQuotaAdapter } from '../types';

function currencyForOrigin(origin: string): string {
	const hostname = new URL(origin).hostname.toLowerCase();
	return hostname === 'siliconflow.com' || hostname.endsWith('.siliconflow.com') ? 'USD' : 'CNY';
}

function createSiliconflowQuotaAdapter(defaultOrigin: string): ProviderQuotaAdapter {
	return {
		id: 'siliconflow',
		defaultOrigin,
		async fetch(ctx) {
			const body = await fetchProviderQuotaJson(ctx, '/v1/user/info');
			if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
			if (body.code != null && body.code !== 20000) {
				throw new ProviderQuotaUpstreamError(200, 'Upstream quota request failed (200)');
			}
			if (body.status === false) {
				throw new ProviderQuotaUpstreamError(200, 'Upstream quota request failed (200)');
			}
			const data = isJsonRecord(body.data) ? body.data : null;
			if (!data) throw new ProviderQuotaParseError();
			const total = finiteNumber(data.totalBalance) ?? finiteNumber(data.balance);
			if (total == null) throw new ProviderQuotaParseError();
			const paid = finiteNumber(data.chargeBalance);
			const granted = finiteNumber(data.totalBalance) != null ? finiteNumber(data.balance) : null;
			return buildProviderQuotaSnapshot({
				adapter: 'siliconflow',
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
}

export const siliconflowQuotaAdapter = createSiliconflowQuotaAdapter('https://api.siliconflow.cn');
export const siliconflowInternationalQuotaAdapter = createSiliconflowQuotaAdapter('https://api.siliconflow.com');
