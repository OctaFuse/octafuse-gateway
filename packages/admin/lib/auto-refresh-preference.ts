export type AutoRefreshIntervalMs = 'off' | 60_000 | 300_000 | 600_000;

export const AUTO_REFRESH_INTERVAL_OPTIONS: readonly AutoRefreshIntervalMs[] = ['off', 60_000, 300_000, 600_000];

export function parseAutoRefreshInterval(raw: string | null): AutoRefreshIntervalMs {
	if (raw === '60000' || raw === '60_000') return 60_000;
	if (raw === '300000' || raw === '300_000') return 300_000;
	if (raw === '600000' || raw === '600_000') return 600_000;
	return 'off';
}

/** No stored choice means no periodic requests. Only an explicit selection enables them. */
export function createAutoRefreshPreference(storageKey: string, event: string) {
	return {
		read: (): AutoRefreshIntervalMs => {
			if (typeof window === 'undefined') return 'off';
			try { return parseAutoRefreshInterval(window.localStorage.getItem(storageKey)); }
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
