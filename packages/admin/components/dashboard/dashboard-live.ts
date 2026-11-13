import { createRangeValue, isRollingPreset, type GatewayTimeRangeValue } from '@/lib/analytics-range';
import type { DashboardStats } from '@/lib/types';

export function dashboardRefreshRange(selected: GatewayTimeRangeValue, timeZone: string): GatewayTimeRangeValue {
	return selected.preset === 'custom' ? selected : createRangeValue(selected.preset, timeZone);
}

export function dashboardStatsQuery(range: GatewayTimeRangeValue) {
	const query = new URLSearchParams({ start_date: range.start_date, end_date: range.end_date, preset: range.preset });
	if (isRollingPreset(range.preset)) query.set('range', range.preset);
	return query;
}

/** Keep unchanged chart/list references so an idle poll does not replay animations. */
function shareRows<T extends object>(before: T[] | undefined, after: T[] | undefined): T[] | undefined {
	if (!before || !after || before.length !== after.length) return after;
	return before.every((row, index) => {
		const next = after[index];
		const keys = Object.keys(row) as (keyof T)[];
		return keys.length === Object.keys(next).length && keys.every(key => Object.is(row[key], next[key]));
	}) ? before : after;
}
export function shareDashboardRows(before: DashboardStats | null, after: DashboardStats): DashboardStats {
	if (!before) return after;
	return { ...after,
		timeseries: shareRows(before.timeseries, after.timeseries),
		modelDistribution: shareRows(before.modelDistribution, after.modelDistribution),
		topUsers: shareRows(before.topUsers, after.topUsers),
		recentLogs: shareRows(before.recentLogs, after.recentLogs)!,
		recentErrors: shareRows(before.recentErrors, after.recentErrors)!,
	};
}

/** Suppress changes below the precision displayed by the metric. */
export function dashboardDelta(value: number | null | undefined, previous: number | null | undefined, step = 1): number | null {
	if (value == null || previous == null || !Number.isFinite(value) || !Number.isFinite(previous)) return null;
	const delta = value - previous;
	return Math.abs(delta) + Number.EPSILON >= step ? delta : null;
}
export function interpolateDashboardValue(from: number, to: number, progress: number) {
	const t = Math.max(0, Math.min(1, progress));
	if (t === 0) return from;
	if (t === 1) return to;
	return from + (to - from) * (1 - Math.pow(1 - t, 3));
}
