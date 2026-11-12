'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AutoRefreshState } from '@/components/AutoRefreshControl';
import type { AutoRefreshIntervalMs } from './auto-refresh-preference';
import { createAutoRefreshScheduler } from './auto-refresh-scheduler';

/** The displayed deadline and the network request always use the same scheduler. */
export function useAutoRefresh({ intervalMs, enabled, refresh }: {
	intervalMs: AutoRefreshIntervalMs;
	enabled: boolean;
	refresh: () => Promise<boolean>;
}) {
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
	const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
	const [lastRefreshResult, setLastRefreshResult] = useState<AutoRefreshState['lastRefreshResult']>(null);
	const schedulerRef = useRef<ReturnType<typeof createAutoRefreshScheduler> | null>(null);
	const pendingRef = useRef<{ scope: number; promise: Promise<void> } | null>(null);
	const scopeRef = useRef(0);

	// Interval changes keep in-flight feedback; leaving the panel or saving invalidates it.
	useEffect(() => {
		const scope = ++scopeRef.current;
		return () => { scopeRef.current = scope + 1; };
	}, [enabled, refresh]);

	const refreshData = useCallback((): Promise<void> => {
		if (!enabled) return Promise.resolve();
		const scope = scopeRef.current;
		if (pendingRef.current?.scope === scope) return pendingRef.current.promise;
		setIsRefreshing(true);
		const promise = Promise.resolve().then(refresh).catch(() => false).then(success => {
			if (scope !== scopeRef.current) return;
			const finishedAt = Date.now();
			if (success) setLastUpdatedAt(finishedAt);
			setLastRefreshResult({ finishedAt, status: success ? 'success' : 'error' });
			setIsRefreshing(false);
		}).finally(() => {
			if (pendingRef.current?.scope === scope) {
				pendingRef.current = null;
				setIsRefreshing(false);
			}
		});
		pendingRef.current = { scope, promise };
		return promise;
	}, [enabled, refresh]);

	useEffect(() => {
		if (!enabled) return;
		const scheduler = createAutoRefreshScheduler({
			intervalMs,
			active: () => document.visibilityState === 'visible',
			onDeadline: setNextRefreshAt,
			refresh: refreshData,
		});
		schedulerRef.current = scheduler;
		scheduler.start();
		const onVisibility = () => {
			if (document.visibilityState !== 'visible') scheduler.pause();
			else if (intervalMs !== 'off') void scheduler.refreshNow();
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			scheduler.dispose();
			if (schedulerRef.current === scheduler) schedulerRef.current = null;
		};
	}, [enabled, intervalMs, refreshData]);

	const refreshNow = useCallback(async () => { await schedulerRef.current?.refreshNow(); }, []);
	return { isRefreshing: enabled && isRefreshing, lastUpdatedAt, nextRefreshAt: enabled ? nextRefreshAt : null, lastRefreshResult, refreshNow };
}
