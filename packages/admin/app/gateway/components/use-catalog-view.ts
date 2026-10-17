'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { CatalogView } from './catalog-view-toggle';

const CHANGE_EVENT = 'octafuse-admin-catalog-view';
// Keep switching usable even when browser storage is unavailable.
const memory = new Map<string, CatalogView>();

function subscribe(onChange: () => void) {
	window.addEventListener('storage', onChange);
	window.addEventListener(CHANGE_EVENT, onChange);
	return () => {
		window.removeEventListener('storage', onChange);
		window.removeEventListener(CHANGE_EVENT, onChange);
	};
}

function serverSnapshot(): CatalogView {
	return 'list';
}

export function useCatalogView(storageKey: string, storedCardsValue = 'cards') {
	const read = useCallback((): CatalogView => {
		const fallback = memory.get(storageKey);
		if (fallback) return fallback;
		try {
			return window.localStorage.getItem(storageKey) === storedCardsValue ? 'cards' : 'list';
		} catch {
			return memory.get(storageKey) ?? 'list';
		}
	}, [storageKey, storedCardsValue]);
	const view = useSyncExternalStore(subscribe, read, serverSnapshot);
	const setView = useCallback((next: CatalogView) => {
		try {
			window.localStorage.setItem(storageKey, next === 'cards' ? storedCardsValue : 'list');
			memory.delete(storageKey);
		} catch {
			memory.set(storageKey, next);
			// Preference persistence is best-effort in private browsing.
		}
		window.dispatchEvent(new Event(CHANGE_EVENT));
	}, [storageKey, storedCardsValue]);

	return [view, setView] as const;
}
