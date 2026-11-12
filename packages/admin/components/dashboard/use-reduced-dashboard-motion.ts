'use client';

import { useSyncExternalStore } from 'react';
const query = '(prefers-reduced-motion: reduce)';
const subscribe = (onChange: () => void) => {
	const media = window.matchMedia(query);
	media.addEventListener('change', onChange);
	return () => media.removeEventListener('change', onChange);
};
const snapshot = () => window.matchMedia(query).matches;
// Render static content on the server; animation is available after hydration.
export function useReducedDashboardMotion() { return useSyncExternalStore(subscribe, snapshot, () => true); }
