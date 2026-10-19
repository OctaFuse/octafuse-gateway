'use client';

import { useSyncExternalStore } from 'react';

export type RoutePathDisplay = 'full' | 'compact';

const STORAGE_KEY = 'octafuse.admin.routes.pathDisplay';
const CHANGE_EVENT = 'octafuse-admin-routes-path-display';
let memoryFallback: RoutePathDisplay | undefined;

function readDisplay(): RoutePathDisplay {
	if (memoryFallback) return memoryFallback;
	if (typeof window === 'undefined') return 'compact';
	try {
		return window.localStorage.getItem(STORAGE_KEY) === 'full' ? 'full' : 'compact';
	} catch {
		return 'compact';
	}
}

function subscribe(onChange: () => void) {
	window.addEventListener('storage', onChange);
	window.addEventListener(CHANGE_EVENT, onChange);
	return () => {
		window.removeEventListener('storage', onChange);
		window.removeEventListener(CHANGE_EVENT, onChange);
	};
}

function serverSnapshot(): RoutePathDisplay {
	return 'compact';
}

function writeDisplay(display: RoutePathDisplay) {
	try {
		window.localStorage.setItem(STORAGE_KEY, display);
		memoryFallback = undefined;
	} catch {
		memoryFallback = display;
		// Keep switching available when preference persistence is blocked.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useRoutePathDisplay() {
	const display = useSyncExternalStore(subscribe, readDisplay, serverSnapshot);
	return [display, writeDisplay] as const;
}
