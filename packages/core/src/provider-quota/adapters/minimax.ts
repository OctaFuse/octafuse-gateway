/**
 * MiniMax Token Plan 周期额度。
 * 先请求 `https://www.minimaxi.com/v1/token_plan/remains`，解析失败或 404 时再请求
 * `https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains`。
 * `current_interval_usage_count` / `current_weekly_usage_count` 是剩余次数，不是已用量。
 * 次数为 0 时改用 `*_remaining_percent`（剩余百分比）。
 */
import { fetchProviderQuotaJsonFromUrl, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import {
	ProviderQuotaParseError,
	ProviderQuotaUpstreamError,
	type ProviderQuotaAdapter,
	type ProviderQuotaFetchContext,
	type ProviderQuotaWindow,
} from '../types';

const TOKEN_PLAN_URL = 'https://www.minimaxi.com/v1/token_plan/remains';
const CODING_PLAN_URL = 'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains';

function epochIso(value: unknown): string | null {
	const raw = finiteNumber(value);
	if (raw == null || raw <= 0) return null;
	const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : null;
	if (ms == null) return null;
	const date = new Date(ms);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function countWindow(
	id: string,
	total: number | null,
	remainingCount: number | null,
	remainingPercent: number | null,
	resetsAt: string | null,
): ProviderQuotaWindow | null {
	if (total != null && total > 0 && remainingCount != null) {
		const remaining = Math.min(Math.max(remainingCount, 0), total);
		const used = total - remaining;
		return {
			id,
			unit: 'requests',
			used,
			limit: total,
			remaining,
			usedPercent: (used / total) * 100,
			resetsAt,
		};
	}
	if (remainingPercent == null) return null;
	const remaining = Math.min(Math.max(remainingPercent, 0), 100);
	const used = 100 - remaining;
	return {
		id,
		unit: 'percent',
		used,
		limit: 100,
		remaining,
		usedPercent: used,
		resetsAt,
	};
}

function modelScore(name: string): number {
	const normalized = name.toLowerCase();
	if (normalized === 'general') return 0;
	if (normalized.startsWith('minimax-m') || normalized.startsWith('coding')) return 1;
	return 2;
}

function windowsForModel(entry: Record<string, unknown>): ProviderQuotaWindow[] {
	const intervalRemaining =
		finiteNumber(entry.current_interval_remaining_count) ?? finiteNumber(entry.current_interval_usage_count);
	const weeklyRemaining =
		finiteNumber(entry.current_weekly_remaining_count) ?? finiteNumber(entry.current_weekly_usage_count);
	const fiveHour = countWindow(
		'5h',
		finiteNumber(entry.current_interval_total_count),
		intervalRemaining,
		finiteNumber(entry.current_interval_remaining_percent),
		epochIso(entry.end_time),
	);
	const weekly = countWindow(
		'weekly',
		finiteNumber(entry.current_weekly_total_count),
		weeklyRemaining,
		finiteNumber(entry.current_weekly_remaining_percent),
		epochIso(entry.weekly_end_time),
	);
	return [fiveHour, weekly].filter((window): window is ProviderQuotaWindow => window != null);
}

export function parseMinimaxRemains(body: unknown): ProviderQuotaWindow[] {
	if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
	const base = isJsonRecord(body.base_resp) ? body.base_resp : null;
	if (base && finiteNumber(base.status_code) != null && finiteNumber(base.status_code) !== 0) {
		throw new ProviderQuotaUpstreamError(200, 'Upstream quota request failed (200)');
	}
	const data = isJsonRecord(body.data) ? body.data : body;
	const rows = Array.isArray(data.model_remains) ? data.model_remains : Array.isArray(body.model_remains) ? body.model_remains : null;
	if (!rows) throw new ProviderQuotaParseError();
	const models = rows.filter(isJsonRecord).sort((left, right) => {
		const leftName = typeof left.model_name === 'string' ? left.model_name : '';
		const rightName = typeof right.model_name === 'string' ? right.model_name : '';
		return modelScore(leftName) - modelScore(rightName);
	});
	for (const model of models) {
		const windows = windowsForModel(model);
		if (windows.length > 0) return windows;
	}
	throw new ProviderQuotaParseError();
}

async function fetchRemains(ctx: ProviderQuotaFetchContext): Promise<ProviderQuotaWindow[]> {
	const urls = [TOKEN_PLAN_URL, CODING_PLAN_URL];
	let lastError: unknown;
	for (let index = 0; index < urls.length; index += 1) {
		const url = urls[index];
		if (!url) continue;
		try {
			return parseMinimaxRemains(await fetchProviderQuotaJsonFromUrl(ctx, url));
		} catch (error) {
			lastError = error;
			const canTryNext =
				index < urls.length - 1 &&
				(error instanceof ProviderQuotaParseError ||
					(error instanceof ProviderQuotaUpstreamError && (error.status === 404 || error.status === 200)));
			if (!canTryNext) throw error;
		}
	}
	throw lastError instanceof Error ? lastError : new ProviderQuotaParseError();
}

export const minimaxQuotaAdapter: ProviderQuotaAdapter = {
	id: 'minimax',
	defaultOrigin: 'https://api.minimaxi.com',
	async fetch(ctx) {
		return buildProviderQuotaSnapshot({
			adapter: 'minimax',
			checkedAt: quotaCheckedAt(ctx.now),
			balances: [],
			windows: await fetchRemains(ctx),
		});
	},
};
