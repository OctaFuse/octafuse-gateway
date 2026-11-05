/**
 * Command Code `GET /alpha/billing/credits`。
 * 与 Provider API 同一把 Key。这是 CLI `/usage` 使用的计费查询，不在
 * https://commandcode.ai/docs/provider 的调用端点表里。
 * `credits` 里的 `monthlyCredits`、`purchasedCredits`、`freeCredits` 相加为剩余额度（USD）；
 * 若另有 `remainingCredits`，以它为剩余总额。`monthlyCredits` 本身是套餐月度池的剩余，不是上限。
 * 每月窗口优先用 `credits.monthlyCreditsGranted`。没有该字段、且已经有滚动窗口时，
 * 再用 `GET /alpha/usage/summary` 的本账期 `totalMonthlyCredits` 加上剩余月度额度推算上限。
 * 重置时间来自 `GET /alpha/billing/subscriptions` 的 `currentPeriodEnd`。
 * 后两个请求失败或过久没有返回时，余额和 `fiveHour` / `weekly` 照常返回。
 * `windowLimits.fiveHour` / `weekly` 的 `used` / `cap` 是美元，`resetAt` 是毫秒时间戳。
 * 窗口可能在响应根上，也可能在 `credits` 里。没有滚动窗口的按量余额不编造每月窗口。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import {
	ProviderQuotaParseError,
	type ProviderQuotaAdapter,
	type ProviderQuotaBalance,
	type ProviderQuotaFetchContext,
	type ProviderQuotaWindow,
} from '../types';

const WINDOW_IDS = [
	{ key: 'fiveHour', id: '5h' },
	{ key: 'weekly', id: 'weekly' },
] as const;

/** 用量和订阅接口可能很慢。额度查询不能一直等它们。 */
const ENRICHMENT_GRACE_MS = 4_000;
const RESET_GRACE_MS = 1_500;

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

function monthlyRemainingOf(credits: unknown): number | null {
	if (!isJsonRecord(credits)) return null;
	const remaining = finiteNumber(credits.monthlyCredits);
	if (remaining == null || remaining < 0) return null;
	return remaining;
}

/** 响应里的月度授予额。剩余额超过授予额时，这个字段不可当作上限。 */
function limitFromGrant(credits: unknown, remaining: number): number | null {
	if (!isJsonRecord(credits)) return null;
	const granted = finiteNumber(credits.monthlyCreditsGranted);
	if (granted == null || granted <= 0) return null;
	if (remaining > granted && remaining - granted > 1e-6) return null;
	return granted;
}

function isBillingPeriod(value: unknown): boolean {
	if (value == null || value === '') return true;
	if (typeof value !== 'string') return false;
	const normalized = value.trim().toLowerCase().replace(/[\s_]/g, '-');
	return normalized === 'billing-period' || normalized === 'billingperiod' || normalized === 'subscription-period';
}

/** `totalMonthlyCredits` 是本账期已消耗的月度额度，不是上限。零值无法区分「还没花」和「字段无效」。 */
function readMonthlySpend(body: unknown): number | null {
	if (!isJsonRecord(body) || body.success === false) return null;
	const data = isJsonRecord(body.data) ? body.data : body;
	if (!isBillingPeriod(data.periodBasis)) return null;
	const spent = finiteNumber(data.totalMonthlyCredits);
	if (spent == null || spent <= 0) return null;
	return spent;
}

function readPeriodEnd(body: unknown): string | null {
	if (!isJsonRecord(body) || body.success === false || body.data === null) return null;
	const data = isJsonRecord(body.data) ? body.data : body;
	return resetsAtIso(data.currentPeriodEnd);
}

function monthlyWindow(remaining: number, limit: number, resetsAt: string | null): ProviderQuotaWindow | null {
	if (!(limit > 0)) return null;
	const cappedRemaining = Math.min(Math.max(remaining, 0), limit);
	const used = limit - cappedRemaining;
	return {
		id: 'monthly',
		unit: 'currency',
		used,
		limit,
		remaining: cappedRemaining,
		usedPercent: (used / limit) * 100,
		resetsAt,
	};
}

async function readOptional(ctx: ProviderQuotaFetchContext, path: string): Promise<unknown | null> {
	try {
		return await fetchProviderQuotaJson(ctx, path);
	} catch {
		return null;
	}
}

function waitAtMost<T>(promise: Promise<T>, ms: number): Promise<T | null> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(null);
			},
		);
	});
}

export const commandCodeQuotaAdapter: ProviderQuotaAdapter = {
	id: 'commandcode',
	defaultOrigin: 'https://api.commandcode.ai',
	async fetch(ctx) {
		const creditsPromise = fetchProviderQuotaJson(ctx, '/alpha/billing/credits');
		const subscriptionPromise = readOptional(ctx, '/alpha/billing/subscriptions');
		const summaryPromise = readOptional(ctx, '/alpha/usage/summary');
		const body = await creditsPromise;
		if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
		const balance = readCredits(body.credits);
		const windows = windowsFrom(body.windowLimits);
		const nested = isJsonRecord(body.credits) ? windowsFrom(body.credits.windowLimits) : [];
		const seen = new Set(windows.map((window) => window.id));
		for (const window of nested) {
			if (!seen.has(window.id)) windows.push(window);
		}

		const monthlyRemaining = monthlyRemainingOf(body.credits);
		let monthlyLimit = monthlyRemaining == null ? null : limitFromGrant(body.credits, monthlyRemaining);
		let resetsAt: string | null = null;
		if (monthlyRemaining != null && monthlyLimit == null && windows.length > 0) {
			const [subscription, summary] = await Promise.all([
				waitAtMost(subscriptionPromise, ENRICHMENT_GRACE_MS),
				waitAtMost(summaryPromise, ENRICHMENT_GRACE_MS),
			]);
			resetsAt = readPeriodEnd(subscription);
			const spent = readMonthlySpend(summary);
			if (spent != null) monthlyLimit = spent + monthlyRemaining;
		} else if (monthlyRemaining != null && monthlyLimit != null) {
			resetsAt = readPeriodEnd(await waitAtMost(subscriptionPromise, RESET_GRACE_MS));
			void summaryPromise;
		} else {
			void subscriptionPromise;
			void summaryPromise;
		}
		if (monthlyRemaining != null && monthlyLimit != null && !seen.has('monthly')) {
			const monthly = monthlyWindow(monthlyRemaining, monthlyLimit, resetsAt);
			if (monthly) windows.push(monthly);
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
