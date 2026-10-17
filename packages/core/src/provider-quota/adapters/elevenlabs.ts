/**
 * ElevenLabs `GET /v1/user/subscription`。
 * 文档：https://elevenlabs.io/docs/api-reference/user/subscription/get
 * 鉴权是 `xi-api-key`，不是 Bearer。
 * 响应字段仍叫 `character_count` / `character_limit`，产品侧已改称 credits，数值不变。
 * `next_character_count_reset_unix` 是下次重置的 Unix 秒。
 * `status: free_disabled` 表示订阅已停用。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, type ProviderQuotaAdapter, type ProviderQuotaWindow } from '../types';

function resetsAtIso(value: unknown): string | null {
	const epoch = finiteNumber(value);
	if (epoch == null || epoch <= 0) return null;
	const millis = epoch >= 1e12 ? epoch : epoch * 1000;
	const date = new Date(millis);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function characterWindow(used: number, limit: number, resetsAt: string | null): ProviderQuotaWindow {
	const remaining = Math.max(0, limit - used);
	const usedPercent = limit > 0 ? Math.min(100, (Math.max(0, used) / limit) * 100) : 100;
	return {
		id: 'credits',
		unit: 'credits',
		used,
		limit,
		remaining,
		usedPercent,
		resetsAt,
	};
}

export const elevenLabsQuotaAdapter: ProviderQuotaAdapter = {
	id: 'elevenlabs',
	defaultOrigin: 'https://api.elevenlabs.io',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/v1/user/subscription', {
			authorization: 'none',
			headers: { 'xi-api-key': ctx.apiKey },
		});
		if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
		const used = finiteNumber(body.character_count);
		const limit = finiteNumber(body.character_limit);
		if (used == null || limit == null || limit < 0) throw new ProviderQuotaParseError();
		return buildProviderQuotaSnapshot({
			adapter: 'elevenlabs',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: [],
			windows: [characterWindow(used, limit, resetsAtIso(body.next_character_count_reset_unix))],
			unavailable: body.status === 'free_disabled',
		});
	},
};
