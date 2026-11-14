'use client';

import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
	LEGACY_PROXY_URL_STORAGE,
	PROXY_BASE_URL_CHANGED,
	PROXY_BASE_URL_STORAGE,
	normalizeProxyBaseUrl,
	readProxyUrlOverride,
	resolveProxyBaseUrl,
} from '@/lib/proxy-base-url';

const DeploymentProxyUrl = createContext('');
export function ProxyConnectionProvider({ defaultUrl, children }: { defaultUrl: string; children?: ReactNode }) {
	return <DeploymentProxyUrl.Provider value={defaultUrl}>{children}</DeploymentProxyUrl.Provider>;
}
function subscribe(onChange: () => void) {
	window.addEventListener('storage', onChange);
	window.addEventListener(PROXY_BASE_URL_CHANGED, onChange);
	return () => {
		window.removeEventListener('storage', onChange);
		window.removeEventListener(PROXY_BASE_URL_CHANGED, onChange);
	};
}
function readOverride() {
	try {
		return readProxyUrlOverride(window.localStorage);
	} catch {
		return '';
	}
}
function saveOverride(value: string): boolean {
	try {
		if (value) localStorage.setItem(PROXY_BASE_URL_STORAGE, value);
		else localStorage.removeItem(PROXY_BASE_URL_STORAGE);
		for (const key of LEGACY_PROXY_URL_STORAGE) localStorage.removeItem(key);
		window.dispatchEvent(new Event(PROXY_BASE_URL_CHANGED));
		return true;
	} catch {
		return false;
	}
}
export function useProxyBaseUrl() {
	const deployment = useContext(DeploymentProxyUrl);
	const snapshot = useSyncExternalStore(
		subscribe,
		() => JSON.stringify(resolveProxyBaseUrl({ override: readOverride(), deployment, origin: window.location.origin })),
		() => JSON.stringify(resolveProxyBaseUrl({ deployment }))
	);
	return useMemo(() => JSON.parse(snapshot) as ReturnType<typeof resolveProxyBaseUrl>, [snapshot]);
}
/** Keep incomplete edits local; commit valid overrides only on blur or an explicit action. */
export function useProxyBaseUrlInput() {
	const connection = useProxyBaseUrl();
	const [draft, setDraft] = useState<string | null>(null);
	function reset() {
		saveOverride('');
		setDraft(null);
	}
	function commit() {
		if (draft == null) return;
		if (!draft.trim()) {
			reset();
			return;
		}
		const normalized = normalizeProxyBaseUrl(draft);
		if (!normalized) return;
		if ((normalized === connection.url && connection.source !== 'browser') || saveOverride(normalized)) setDraft(null);
	}
	return {
		...connection,
		value: draft ?? connection.url,
		setValue: setDraft,
		commit,
		reset,
		canReset: connection.source === 'browser' || draft != null,
	};
}
