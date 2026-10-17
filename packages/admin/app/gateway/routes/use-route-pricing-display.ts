'use client';

import { useSyncExternalStore } from 'react';

export type RoutePricingDisplay = 'effective' | 'configured';

const STORAGE_KEY = 'octafuse.admin.routes.pricingDisplay';
const CHANGE_EVENT = 'octafuse-admin-routes-pricing-display';
let memoryFallback: RoutePricingDisplay | undefined;

function readDisplay(): RoutePricingDisplay {
	if (memoryFallback) return memoryFallback;
	if (typeof window === 'undefined') return 'effective';
	try {
		return window.localStorage.getItem(STORAGE_KEY) === 'configured' ? 'configured' : 'effective';
	} catch {
		return 'effective';
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

function serverSnapshot(): RoutePricingDisplay {
	return 'effective';
}

function writeDisplay(display: RoutePricingDisplay) {
	try {
		window.localStorage.setItem(STORAGE_KEY, display);
		memoryFallback = undefined;
	} catch {
		memoryFallback = display;
		// Keep switching available when preference persistence is blocked.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useRoutePricingDisplay() {
	const display = useSyncExternalStore(subscribe, readDisplay, serverSnapshot);
	return [display, writeDisplay] as const;
}
