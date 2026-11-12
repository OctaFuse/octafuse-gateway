'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GatewayTimeRangeValue } from '@/lib/analytics-range';
import { readApiJson } from '@/lib/api-json';
import type { DashboardStats } from '@/lib/types';
import { dashboardRefreshPreference } from '@/lib/auto-refresh-preference';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { dashboardRefreshRange, dashboardStatsQuery, shareDashboardRows } from './dashboard-live';

type Snapshot = { data: DashboardStats; range: GatewayTimeRangeValue; scope: string; previous: DashboardStats | null; updatedAt: number };

export function useDashboardSnapshot(range: GatewayTimeRangeValue, timeZone: string, paused: boolean) {
	const { preset, start_date, end_date } = range;
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const currentRef = useRef<Snapshot | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const intervalMs = useSyncExternalStore(dashboardRefreshPreference.subscribe, dashboardRefreshPreference.read, () => 'off' as const);
	const load = useCallback(async (source: 'query' | 'manual' | 'automatic'): Promise<boolean> => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		if (source === 'query') { setLoading(true); setLoadError(false); }
		const selected = { preset, start_date, end_date };
		const scope = JSON.stringify(selected);
		const requestedRange = dashboardRefreshRange(selected, timeZone);
		try {
			const response = await fetch(`/api/admin/stats?${dashboardStatsQuery(requestedRange)}`, { signal: controller.signal, cache: 'no-store' });
			const result = await readApiJson<DashboardStats>(response);
			if (controller.signal.aborted) return false;
			if (!response.ok || !result.success || !result.data) { setLoadError(true); return false; }
			const previous = currentRef.current?.scope === scope ? currentRef.current.data : null;
			const next = { data: shareDashboardRows(previous, result.data), range: requestedRange, scope, previous, updatedAt: Date.now() };
			currentRef.current = next;
			setSnapshot(next);
			setLoadError(false);
			return true;
		} catch {
			if (!controller.signal.aborted) setLoadError(true);
			return false;
		} finally { if (!controller.signal.aborted) setLoading(false); }
	}, [preset, start_date, end_date, timeZone]);
	useEffect(() => {
		void load('query');
		return () => abortRef.current?.abort();
	}, [load]);
	const refresh = useCallback((source: 'manual' | 'automatic') => load(source), [load]);
	const controls = useAutoRefresh({ intervalMs, enabled: !loading, paused, refresh });
	return { snapshot, loading, loadError, intervalMs, controls };
}
