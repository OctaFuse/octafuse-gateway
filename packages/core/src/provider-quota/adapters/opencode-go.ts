/**
 * OpenCode Go `GET /zen/go/v1/usage`。
 * `usage.rolling` / `weekly` / `monthly` 的 `percent` 是已用百分比，`resetsAt` 是重置时间。
 * `status: "rate-limited"` 表示该窗口已打满。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, type ProviderQuotaAdapter, type ProviderQuotaWindow } from '../types';

const WINDOWS = [
	{ key: 'rolling', id: '5h' },
	{ key: 'weekly', id: 'weekly' },
	{ key: 'monthly', id: 'monthly' },
] as const;

function readWindow(id: string, value: unknown): ProviderQuotaWindow | null {
	if (!isJsonRecord(value)) return null;
	const percent = finiteNumber(value.percent);
	if (percent == null || percent < 0 || percent > 100) return null;
	const rateLimited = value.status === 'rate-limited';
	if (value.status != null && value.status !== 'ok' && !rateLimited) return null;
	const resetsAt = typeof value.resetsAt === 'string' && !Number.isNaN(Date.parse(value.resetsAt)) ? value.resetsAt : null;
	const usedPercent = rateLimited ? 100 : percent;
	return {
		id,
		unit: 'percent',
		used: usedPercent,
		limit: 100,
		remaining: Math.max(0, 100 - usedPercent),
		usedPercent,
		resetsAt,
	};
}

export const opencodeGoQuotaAdapter: ProviderQuotaAdapter = {
	id: 'opencode-go',
	defaultOrigin: 'https://opencode.ai',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/zen/go/v1/usage');
		if (!isJsonRecord(body) || !isJsonRecord(body.usage)) throw new ProviderQuotaParseError();
		const usage = body.usage;
		const windows = WINDOWS.flatMap((item) => {
			const window = readWindow(item.id, usage[item.key]);
			return window ? [window] : [];
		});
		if (windows.length === 0) throw new ProviderQuotaParseError();
		return buildProviderQuotaSnapshot({
			adapter: 'opencode-go',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: [],
			windows,
		});
	},
};
