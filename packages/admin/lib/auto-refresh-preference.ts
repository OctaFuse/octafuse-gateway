export type AutoRefreshIntervalMs = 'off' | 10_000 | 30_000 | 60_000 | 300_000 | 600_000;

export const AUTO_REFRESH_INTERVAL_OPTIONS: readonly AutoRefreshIntervalMs[] = ['off', 60_000, 300_000, 600_000];

export const REQUEST_LOG_REFRESH_INTERVAL_OPTIONS: readonly AutoRefreshIntervalMs[] = ['off', 10_000, 30_000, 60_000, 300_000];

export function parseAutoRefreshInterval(raw: string | null, options = AUTO_REFRESH_INTERVAL_OPTIONS): AutoRefreshIntervalMs {
	return options.find(value => String(value) === raw?.replace(/_/g, '')) ?? 'off';
}

/** No stored choice means no periodic requests. Only an explicit selection enables them. */
export function createAutoRefreshPreference(storageKey: string, event: string, options = AUTO_REFRESH_INTERVAL_OPTIONS) {
	return {
		read: (): AutoRefreshIntervalMs => {
			if (typeof window === 'undefined') return 'off';
			try { return parseAutoRefreshInterval(window.localStorage.getItem(storageKey), options); }
			catch { return 'off'; }
		},
		write: (value: AutoRefreshIntervalMs) => {
			try { window.localStorage.setItem(storageKey, String(value)); }
			catch { /* Best effort in private mode. */ }
			window.dispatchEvent(new Event(event));
		},
		subscribe: (onChange: () => void) => {
			const onStorage = (e: StorageEvent) => { if (e.key === storageKey || e.key === null) onChange(); };
			window.addEventListener('storage', onStorage);
			window.addEventListener(event, onChange);
			return () => {
				window.removeEventListener('storage', onStorage);
				window.removeEventListener(event, onChange);
			};
		},
	};
}

export const maintenanceRefreshPreference = createAutoRefreshPreference(
	'octafuse.admin.maintenance.refreshIntervalMs', 'octafuse-admin-maintenance-refresh-interval'
);

export const requestLogRefreshPreference = createAutoRefreshPreference(
	'octafuse.admin.requestLogs.refreshIntervalMs', 'octafuse-admin-request-logs-refresh-interval', REQUEST_LOG_REFRESH_INTERVAL_OPTIONS
);
