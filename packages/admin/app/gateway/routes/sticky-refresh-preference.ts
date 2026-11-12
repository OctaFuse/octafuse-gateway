import { AUTO_REFRESH_INTERVAL_OPTIONS, createAutoRefreshPreference, type AutoRefreshIntervalMs } from '@/lib/auto-refresh-preference';

export type StickyRefreshIntervalMs = AutoRefreshIntervalMs;
export const STICKY_REFRESH_INTERVAL_OPTIONS = AUTO_REFRESH_INTERVAL_OPTIONS;

const preference = createAutoRefreshPreference(
	'octafuse.admin.routes.stickyRefreshIntervalMs', 'octafuse-admin-routes-sticky-refresh-interval'
);
export const readStickyRefreshInterval = preference.read;
export const writeStickyRefreshInterval = preference.write;
export const subscribeStickyRefreshInterval = preference.subscribe;
