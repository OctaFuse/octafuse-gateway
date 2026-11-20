'use client';

import { useSyncExternalStore } from 'react';

export type RoutePricingDisplay = 'effective' | 'configured';

function createDisplayPreference<T extends string>(storageKey: string, defaultValue: T, alternateValue: T) {
	const event = storageKey + '.change';
	let memoryFallback: T | undefined;

	function read(): T {
		if (memoryFallback !== undefined) return memoryFallback;
		try {
			return window.localStorage.getItem(storageKey) === alternateValue ? alternateValue : defaultValue;
		} catch {
			return defaultValue;
		}
	}

	function write(value: T) {
		try {
			window.localStorage.setItem(storageKey, value);
			memoryFallback = undefined;
		} catch {
			memoryFallback = value;
		}
		window.dispatchEvent(new Event(event));
	}

	function subscribe(onChange: () => void) {
		window.addEventListener('storage', onChange);
		window.addEventListener(event, onChange);
		return () => {
			window.removeEventListener('storage', onChange);
			window.removeEventListener(event, onChange);
		};
	}

	const serverSnapshot = () => defaultValue;
	return function usePreference() {
		return [useSyncExternalStore(subscribe, read, serverSnapshot), write] as const;
	};
}

export const useRoutePricingDisplay = createDisplayPreference<RoutePricingDisplay>(
	'octafuse.admin.routes.pricingDisplay', 'effective', 'configured',
);

export const useRouteModelLayout = createDisplayPreference(
	'octafuse.admin.routes.modelLayout', 'compact', 'tiled',
);

export type RouteModelLayout = ReturnType<typeof useRouteModelLayout>[0];
