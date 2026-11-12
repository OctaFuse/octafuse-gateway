'use client';

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import { fetchStickyBindingsSummary } from './route-api';
import { createStickyRefreshScheduler } from './sticky-refresh-scheduler';
import type { StickyRefreshIntervalMs } from './sticky-refresh-preference';
import type { StickyBindingsSummary } from './types';

const BATCH_SIZE = 6;

type StickySummaryStoreValue = {
	summaries: Map<string, StickyBindingsSummary>;
	isRefreshing: boolean;
	lastUpdatedAt: number | null;
	registeredCount: number;
	nextRefreshAt: number | null;
	lastRefreshResult: { finishedAt: number; status: 'success' | 'error' } | null;
	register: (poolId: string) => void;
	unregister: (poolId: string) => void;
	refreshAll: () => Promise<void>;
	invalidate: (poolId: string) => Promise<void>;
};

const StickySummaryContext = createContext<StickySummaryStoreValue | null>(null);

async function runInBatches<T>(items: T[], batchSize: number, fn: (item: T) => Promise<void>) {
	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		await Promise.all(batch.map((item) => fn(item)));
	}
}

export function StickySummaryProvider(props: {
	children: ReactNode;
	intervalMs: StickyRefreshIntervalMs;
}) {
	const { children, intervalMs } = props;
	const [summaries, setSummaries] = useState<Map<string, StickyBindingsSummary>>(() => new Map());
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
	const [registeredCount, setRegisteredCount] = useState(0);
	const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
	const [lastRefreshResult, setLastRefreshResult] = useState<StickySummaryStoreValue['lastRefreshResult']>(null);
	const schedulerRef = useRef<ReturnType<typeof createStickyRefreshScheduler> | null>(null);
	const fullRefreshRef = useRef<Promise<void> | null>(null);

	const refCountsRef = useRef(new Map<string, number>());
	const inflightRef = useRef(new Map<string, Promise<boolean>>());

	const fetchOne = useCallback(async (poolId: string) => {
		const existing = inflightRef.current.get(poolId);
		if (existing) return existing;

		const promise = (async () => {
			const result = await fetchStickyBindingsSummary(poolId);
			if (!result.success) return false;
			if (!refCountsRef.current.has(poolId)) return false;
			setSummaries((prev) => {
				const next = new Map(prev);
				next.set(poolId, result.data);
				return next;
			});
			return true;
		})().catch(() => false).finally(() => {
			inflightRef.current.delete(poolId);
		});

		inflightRef.current.set(poolId, promise);
		return promise;
	}, []);

	const refreshPoolIds = useCallback(
		async (poolIds: string[]) => {
			if (poolIds.length === 0) return;
			setIsRefreshing(true);
			setLastRefreshResult(null);
			try {
				let failed = false;
				await runInBatches(poolIds, BATCH_SIZE, async (id) => {
					const success = await fetchOne(id);
					if (!success && refCountsRef.current.has(id)) failed = true;
				});
				if (!poolIds.some(id => refCountsRef.current.has(id))) return;
				const finishedAt = Date.now();
				setLastRefreshResult({ finishedAt, status: failed ? 'error' : 'success' });
				if (!failed) setLastUpdatedAt(finishedAt);
			} finally {
				setIsRefreshing(false);
			}
		},
		[fetchOne]
	);

	const refreshAllData = useCallback(() => {
		if (fullRefreshRef.current) return fullRefreshRef.current;
		fullRefreshRef.current = refreshPoolIds([...refCountsRef.current.keys()]).finally(() => {
			fullRefreshRef.current = null;
		});
		return fullRefreshRef.current;
	}, [refreshPoolIds]);
	const refreshAll = useCallback(async () => {
		if (schedulerRef.current) await schedulerRef.current.refreshNow();
		else await refreshAllData();
	}, [refreshAllData]);

	const invalidate = useCallback(
		async (poolId: string) => {
			const id = poolId.trim();
			if (!id) return;
			if (refCountsRef.current.has(id)) {
				if (await fetchOne(id)) setLastUpdatedAt(Date.now());
				return;
			}
			// Pool not currently displayed; still probe so a remount can pick up fresh data
			// if registration races with dialog ops.
			const result = await fetchStickyBindingsSummary(id);
			if (!result.success) return;
			if (refCountsRef.current.has(id)) {
				setSummaries((prev) => {
					const next = new Map(prev);
					next.set(id, result.data);
					return next;
				});
				setLastUpdatedAt(Date.now());
			}
		},
		[fetchOne]
	);

	const register = useCallback(
		(poolId: string) => {
			const id = poolId.trim();
			if (!id) return;
			const prev = refCountsRef.current.get(id) ?? 0;
			refCountsRef.current.set(id, prev + 1);
			setRegisteredCount(refCountsRef.current.size);
			if (prev === 0) {
				void fetchOne(id).then((success) => {
					if (success && refCountsRef.current.has(id)) setLastUpdatedAt(Date.now());
				});
			}
		},
		[fetchOne]
	);

	const unregister = useCallback((poolId: string) => {
		const id = poolId.trim();
		if (!id) return;
		const prev = refCountsRef.current.get(id) ?? 0;
		if (prev <= 1) {
			refCountsRef.current.delete(id);
			setSummaries((map) => {
				if (!map.has(id)) return map;
				const next = new Map(map);
				next.delete(id);
				return next;
			});
		} else {
			refCountsRef.current.set(id, prev - 1);
		}
		setRegisteredCount(refCountsRef.current.size);
	}, []);

	const hasPools = registeredCount > 0;
	useEffect(() => {
		const scheduler = createStickyRefreshScheduler({
			intervalMs,
			refresh: refreshAllData,
			active: () => document.visibilityState === 'visible' && refCountsRef.current.size > 0,
			onDeadline: setNextRefreshAt,
		});
		schedulerRef.current = scheduler;
		scheduler.start();
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') scheduler.pause();
			else if (intervalMs !== 'off') void scheduler.refreshNow();
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			scheduler.dispose();
			if (schedulerRef.current === scheduler) schedulerRef.current = null;
		};
	}, [intervalMs, refreshAllData, hasPools]);

	const value = useMemo<StickySummaryStoreValue>(
		() => ({
			summaries,
			isRefreshing,
			lastUpdatedAt,
			registeredCount,
			nextRefreshAt,
			lastRefreshResult,
			register,
			unregister,
			refreshAll,
			invalidate,
		}),
		[
			summaries,
			isRefreshing,
			lastUpdatedAt,
			registeredCount,
			nextRefreshAt,
			lastRefreshResult,
			register,
			unregister,
			refreshAll,
			invalidate,
		]
	);

	return (
		<StickySummaryContext.Provider value={value}>{children}</StickySummaryContext.Provider>
	);
}

function useStickySummaryStore(): StickySummaryStoreValue {
	const ctx = useContext(StickySummaryContext);
	if (!ctx) {
		throw new Error('useStickySummary* hooks require StickySummaryProvider');
	}
	return ctx;
}

/** Register `poolId` while mounted; returns latest summary for that pool (or null). */
export function useStickySummary(poolId: string | null | undefined): StickyBindingsSummary | null {
	const { summaries, register, unregister } = useStickySummaryStore();
	const id = poolId?.trim() || null;

	useEffect(() => {
		if (!id) return;
		register(id);
		return () => unregister(id);
	}, [id, register, unregister]);

	if (!id) return null;
	return summaries.get(id) ?? null;
}

export function useStickyRefreshControls() {
	const { refreshAll, isRefreshing, lastUpdatedAt, registeredCount, nextRefreshAt, lastRefreshResult, invalidate } =
		useStickySummaryStore();
	return { refreshAll, isRefreshing, lastUpdatedAt, registeredCount, nextRefreshAt, lastRefreshResult, invalidate };
}
