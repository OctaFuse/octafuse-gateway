'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import type { GatewayTimeRangeValue } from '@/lib/analytics-range';
import { readApiJson } from '@/lib/api-json';
import type { GatewayRequestLog } from '@/lib/types';
import { requestLogRefreshPreference } from '@/lib/auto-refresh-preference';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { incomingRequestLogIds, requestLogRefreshQuery, shouldQueueRequestLogs, uniqueRequestLogs } from './request-log-feed';
import { animateRequestLogRows } from './request-log-row-motion';

type Snapshot = { rows: GatewayRequestLog[]; total: number; query: string };
const empty: Snapshot = { rows: [], total: 0, query: '' };

export function useRequestLogFeed({ query, preset, timeZone, ready, paused, errorMessage }: {
	query: string;
	preset: GatewayTimeRangeValue['preset'];
	timeZone: string;
	ready: boolean;
	paused: boolean;
	errorMessage: string;
}) {
	const router = useRouter();
	const [snapshot, setSnapshot] = useState<Snapshot>(empty);
	const [pending, setPending] = useState<Snapshot | null>(null);
	const [announcement, setAnnouncement] = useState<{ count: number; batch: number } | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');
	const tableRef = useRef<HTMLDivElement>(null);
	const currentRef = useRef<Snapshot>(empty);
	const requestRef = useRef(0);
	const abortRef = useRef<AbortController | null>(null);
	const transitionRef = useRef<{ positions: Map<string, number>; incoming: string[] } | null>(null);
	const intervalMs = useSyncExternalStore(requestLogRefreshPreference.subscribe, requestLogRefreshPreference.read, () => 'off' as const);

	const apply = useCallback((next: Snapshot, animate: boolean) => {
		const incoming = animate ? incomingRequestLogIds(currentRef.current.rows, next.rows) : [];
		const positions = new Map<string, number>();
		if (incoming.length) for (const row of tableRef.current?.querySelectorAll<HTMLElement>('[data-request-log-id]') ?? []) {
			positions.set(row.dataset.requestLogId!, row.getBoundingClientRect().top);
		}
		transitionRef.current = incoming.length ? { positions, incoming } : null;
		currentRef.current = next;
		setSnapshot(next);
		setPending(null);
		setAnnouncement(incoming.length ? { count: incoming.length, batch: requestRef.current } : null);
	}, []);

	const load = useCallback(async (source: 'query' | 'manual' | 'automatic'): Promise<boolean> => {
		if (!ready) return false;
		const request = ++requestRef.current;
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		if (source === 'query') { setIsLoading(true); setPending(null); setAnnouncement(null); setError(''); }
		const params = requestLogRefreshQuery(query, preset, timeZone);
		router.replace(`/gateway/request-logs?${params}`, { scroll: false });
		try {
			const response = await fetch(`/api/admin/request-logs?${params}`, { signal: controller.signal, cache: 'no-store' });
			const data = await readApiJson<GatewayRequestLog[]>(response);
			if (controller.signal.aborted || request !== requestRef.current) return false;
			if (!response.ok || !data.success || !Array.isArray(data.data)) throw new Error(data.message || errorMessage);
			const next: Snapshot = { rows: uniqueRequestLogs(data.data), total: data.total ?? 0, query };
			const sameQuery = currentRef.current.query === query;
			const incoming = sameQuery ? incomingRequestLogIds(currentRef.current.rows, next.rows) : [];
			const table = tableRef.current;
			const selection = window.getSelection();
			const reading = Boolean(table && (
				table.getBoundingClientRect().top < 64 || table.matches(':hover') || table.contains(document.activeElement)
				|| (selection && !selection.isCollapsed && table.contains(selection.anchorNode))
			)) || Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
			if (shouldQueueRequestLogs(source, incoming.length, reading)) setPending(next);
			else apply(next, source !== 'query' && sameQuery);
			setError('');
			return true;
		} catch (cause) {
			if (request === requestRef.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : errorMessage);
			return false;
		} finally {
			if (request === requestRef.current) setIsLoading(false);
		}
	}, [query, preset, timeZone, ready, router, errorMessage, apply]);

	useEffect(() => {
		void load('query');
		return () => { abortRef.current?.abort(); };
	}, [load]);

	const refresh = useCallback((source: 'manual' | 'automatic') => load(source), [load]);
	const refreshState = useAutoRefresh({ intervalMs, enabled: ready && !isLoading, paused, refresh });

	useLayoutEffect(() => {
		const transition = transitionRef.current;
		transitionRef.current = null;
		if (tableRef.current && transition) animateRequestLogRows(tableRef.current, transition.positions, transition.incoming);
	}, [snapshot]);

	useEffect(() => {
		if (!announcement) return;
		const timer = window.setTimeout(() => setAnnouncement(null), 5000);
		return () => window.clearTimeout(timer);
	}, [announcement]);

	const applyPending = () => {
		if (!pending || pending.query !== query) return;
		apply(pending, true);
		tableRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
	};
	return { logs: snapshot.rows, total: snapshot.total, isLoading, error, tableRef, intervalMs, refreshState,
		fetchLogs: refreshState.refreshNow, applyPending,
		pendingCount: pending?.query === query ? incomingRequestLogIds(snapshot.rows, pending.rows).length : 0,
		newCount: announcement?.count ?? 0 };
}
