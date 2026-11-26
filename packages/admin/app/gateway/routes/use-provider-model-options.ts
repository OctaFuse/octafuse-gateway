'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelOption } from '@/lib/provider-model-discovery';

type OptionsState = {
	checkedFor: string | null;
	models: ModelOption[];
	available: boolean;
	credentialReady: boolean;
	reason: string;
	truncated: boolean;
	loading: boolean;
	refreshing: boolean;
	failed: boolean;
	retryUntil: number;
	hasRefreshed: boolean;
	attempted: boolean;
};

const EMPTY: OptionsState = { checkedFor: null, models: [], available: false, credentialReady: false, reason: 'unsupported', truncated: false, loading: false, refreshing: false, failed: false, retryUntil: 0, hasRefreshed: false, attempted: false };

export function useProviderModelOptions(providerId: string) {
	const [state, setState] = useState<OptionsState>(EMPTY);
	const generation = useRef(0);
	const request = useRef<AbortController | null>(null);
	const capabilityBusy = useRef<number | null>(null);
	const refreshBusy = useRef<number | null>(null);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const current = ++generation.current;
		request.current?.abort();
		capabilityBusy.current = null;
		refreshBusy.current = null;
		if (retryTimer.current) clearTimeout(retryTimer.current);
		setState(EMPTY);
		return () => {
			request.current?.abort();
			if (retryTimer.current) clearTimeout(retryTimer.current);
			generation.current = current + 1;
		};
	}, [providerId]);

	const fetchModels = useCallback(async (current: number) => {
		if (!providerId || current !== generation.current || refreshBusy.current !== null) return;
		refreshBusy.current = current;
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setState((old) => ({ ...old, refreshing: true, failed: false, models: [], truncated: false, hasRefreshed: false, attempted: true }));
		try {
			const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/model-options/refresh`, { method: 'POST', signal: controller.signal, cache: 'no-store' });
			if (!response.ok) {
				const seconds = Number(response.headers.get('Retry-After'));
				if (Number.isFinite(seconds) && seconds > 0 && seconds <= 3600 && current === generation.current) {
					const until = Date.now() + seconds * 1000;
					setState((old) => ({ ...old, retryUntil: until }));
					retryTimer.current = setTimeout(() => { if (current === generation.current) setState((old) => ({ ...old, retryUntil: 0 })); }, seconds * 1000);
				}
				throw new Error('refresh_failed');
			}
			const body = await response.json() as { data: { models: ModelOption[]; truncated: boolean } };
			if (current === generation.current) setState((old) => ({ ...old, models: Array.isArray(body.data?.models) ? body.data.models : [], truncated: Boolean(body.data?.truncated), refreshing: false, hasRefreshed: true }));
		} catch {
			if (current === generation.current && !controller.signal.aborted) setState((old) => ({ ...old, models: [], refreshing: false, failed: true }));
		} finally {
			if (refreshBusy.current === current) refreshBusy.current = null;
		}
	}, [providerId]);

	const loadCapability = useCallback(async () => {
		if (!providerId || capabilityBusy.current !== null) return;
		const current = generation.current;
		capabilityBusy.current = current;
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setState({ ...EMPTY, loading: true });
		try {
			const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/model-options`, { signal: controller.signal, cache: 'no-store' });
			if (!response.ok) throw new Error('get_failed');
			const body = await response.json() as { data: { discovery_available: boolean; credential_ready: boolean; discovery_reason: string } };
			if (current !== generation.current) return;
			const data = body.data;
			const available = Boolean(data.discovery_available);
			setState({ ...EMPTY, checkedFor: providerId, available, credentialReady: Boolean(data.credential_ready), reason: data.discovery_reason });
			if (available && data.discovery_reason === 'ready') await fetchModels(current);
		} catch {
			if (current === generation.current && !controller.signal.aborted) setState({ ...EMPTY, failed: true });
		} finally {
			if (capabilityBusy.current === current) capabilityBusy.current = null;
		}
	}, [providerId, fetchModels]);

	const refresh = useCallback(async () => {
		if (!providerId || state.checkedFor !== providerId || !state.available || state.reason !== 'ready' || state.retryUntil > Date.now()) return;
		await fetchModels(generation.current);
	}, [providerId, state.checkedFor, state.available, state.reason, state.retryUntil, fetchModels]);

	const open = useCallback(() => {
		if (!providerId) return;
		if (state.checkedFor !== providerId) { void loadCapability(); return; }
		if (state.available && state.reason === 'ready' && !state.attempted && !state.refreshing) void fetchModels(generation.current);
	}, [providerId, state.checkedFor, state.available, state.reason, state.attempted, state.refreshing, loadCapability, fetchModels]);

	return { ...state, refresh, open };
}
