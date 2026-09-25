/**
 * OpenRouter `GET /api/v1/key`：Key 消费上限（USD）。
 * 文档：https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
 * `limit` / `limit_remaining` 为 null 表示未设上限。`limit_reset` 是周期名，不是时间戳。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import {
	ProviderQuotaParseError,
	type ProviderQuotaAdapter,
	type ProviderQuotaWindow,
} from '../types';

export const openrouterQuotaAdapter: ProviderQuotaAdapter = {
	id: 'openrouter',
	defaultOrigin: 'https://openrouter.ai',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/api/v1/key');
		if (!isJsonRecord(body) || !isJsonRecord(body.data)) throw new ProviderQuotaParseError();
		const data = body.data;
		const limit = finiteNumber(data.limit);
		const remaining = finiteNumber(data.limit_remaining);
		const usage = finiteNumber(data.usage);
		if (limit == null && remaining == null && usage == null) throw new ProviderQuotaParseError();
		const used =
			limit != null && remaining != null ? limit - remaining : usage == null ? undefined : usage;
		const usedPercent =
			limit != null && limit > 0 && remaining != null ? ((limit - remaining) / limit) * 100 : undefined;
		const window: ProviderQuotaWindow = {
			id: 'key_limit',
			unit: 'currency',
			...(used == null ? {} : { used }),
			...(limit == null ? {} : { limit }),
			...(remaining == null ? {} : { remaining }),
			...(usedPercent == null ? {} : { usedPercent }),
			resetsAt: null,
		};
		return buildProviderQuotaSnapshot({
			adapter: 'openrouter',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: [],
			windows: [window],
		});
	},
};
