/**
 * Command Code `GET /alpha/billing/credits`。
 * 与 Provider API 同一把 Key。这是 CLI `/usage` 使用的计费查询，不在
 * https://commandcode.ai/docs/provider 的调用端点表里。
 * `credits` 里的 `monthlyCredits`、`purchasedCredits`、`freeCredits` 相加为剩余额度（USD）；
 * 若另有 `remainingCredits`，以它为剩余总额。
 * `windowLimits.fiveHour` / `weekly` 的 `used` / `cap` 是美元，`resetAt` 是毫秒时间戳。
 * 窗口可能在响应根上，也可能在 `credits` 里；按量计费的 Provider 套餐通常没有窗口。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import { ProviderQuotaParseError, type ProviderQuotaAdapter, type ProviderQuotaBalance, type ProviderQuotaWindow } from '../types';

const WINDOW_IDS = [
	{ key: 'fiveHour', id: '5h' },
	{ key: 'weekly', id: 'weekly' },
] as const;

function readCredits(value: unknown): ProviderQuotaBalance | null {
	if (!isJsonRecord(value)) return null;
	const monthly = finiteNumber(value.monthlyCredits);
	const purchased = finiteNumber(value.purchasedCredits);
	const free = finiteNumber(value.freeCredits);
	const remaining = finiteNumber(value.remainingCredits);
	const parts = [monthly, purchased, free].filter((part): part is number => part != null);
	if (remaining == null && parts.length === 0) return null;
	const total = remaining ?? parts.reduce((sum, part) => sum + part, 0);
	return {
		currency: 'USD',
		total,
		...(free == null ? {} : { granted: free }),
		...(purchased == null ? {} : { paid: purchased }),
	};
}

function resetsAtIso(value: unknown): string | null {
	if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
	const epoch = finiteNumber(value);
	if (epoch == null || epoch <= 0) return null;
	const millis = epoch >= 1e12 ? epoch : epoch * 1000;
	const date = new Date(millis);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readWindow(id: string, value: unknown): ProviderQuotaWindow | null {
	if (!isJsonRecord(value)) return null;
	const used = finiteNumber(value.used);
	const limit = finiteNumber(value.cap);
	if (used == null || limit == null || limit <= 0) return null;
	const usedPercent = Math.min(100, Math.max(0, (used / limit) * 100));
	return {
		id,
		unit: 'currency',
		used,
		limit,
		remaining: Math.max(0, limit - used),
		usedPercent,
		resetsAt: resetsAtIso(value.resetAt),
	};
}

function windowsFrom(value: unknown): ProviderQuotaWindow[] {
	if (Array.isArray(value)) {
		return value.flatMap((item) => {
			if (!isJsonRecord(item) || typeof item.window !== 'string') return [];
			const known = WINDOW_IDS.find((entry) => entry.key === item.window);
			if (!known) return [];
			const window = readWindow(known.id, item);
			return window ? [window] : [];
		});
	}
	if (!isJsonRecord(value)) return [];
	return WINDOW_IDS.flatMap((entry) => {
		const window = readWindow(entry.id, value[entry.key]);
		return window ? [window] : [];
	});
}

export const commandCodeQuotaAdapter: ProviderQuotaAdapter = {
	id: 'commandcode',
	defaultOrigin: 'https://api.commandcode.ai',
	async fetch(ctx) {
		const body = await fetchProviderQuotaJson(ctx, '/alpha/billing/credits');
		if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
		const balance = readCredits(body.credits);
		const windows = windowsFrom(body.windowLimits);
		const nested = isJsonRecord(body.credits) ? windowsFrom(body.credits.windowLimits) : [];
		const seen = new Set(windows.map((window) => window.id));
		for (const window of nested) {
			if (!seen.has(window.id)) windows.push(window);
		}
		if (!balance && windows.length === 0) throw new ProviderQuotaParseError();
		return buildProviderQuotaSnapshot({
			adapter: 'commandcode',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: balance ? [balance] : [],
			windows,
		});
	},
};
