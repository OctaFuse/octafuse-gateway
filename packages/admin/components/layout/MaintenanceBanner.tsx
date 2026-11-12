'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

/** 维护页保存后派发，横幅据此立即刷新。 */
export const MAINTENANCE_CHANGED_EVENT = 'octafuse:maintenance-changed';
const MAINTENANCE_CHANGE_STORAGE_KEY = 'octafuse.admin.maintenance.changed';

export function announceMaintenanceChange() {
	window.dispatchEvent(new Event(MAINTENANCE_CHANGED_EVENT));
	try { window.localStorage.setItem(MAINTENANCE_CHANGE_STORAGE_KEY, String(Date.now())); }
	catch { /* Cross-tab notification is best effort. */ }
}

/**
 * 维护模式开启时在所有后台页面顶部常驻提示，避免运营忘记关闭。
 * 没有 `maintenance.read` 权限或请求失败时静默隐藏，不影响其它页面。
 */
export default function MaintenanceBanner() {
	const t = useTranslations('maintenance.banner');
	const pathname = usePathname();
	const [active, setActive] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let pending = false;
		let queued = false;
		const refresh = async () => {
			if (cancelled || document.visibilityState !== 'visible') return;
			if (pending) { queued = true; return; }
			pending = true;
			try {
				const response = await fetch('/api/admin/maintenance', { cache: 'no-store' });
				if (!response.ok) {
					if (!cancelled) setActive(false);
					return;
				}
				const data = (await response.json()) as { success?: boolean; data?: { config?: { enabled?: boolean } } };
				if (!cancelled) setActive(data.success === true && data.data?.config?.enabled === true);
			} catch {
				if (!cancelled) setActive(false);
			} finally {
				pending = false;
				if (queued) { queued = false; void refresh(); }
			}
		};
		void refresh();
		const onStorage = (event: StorageEvent) => {
			if (event.key === MAINTENANCE_CHANGE_STORAGE_KEY) void refresh();
		};
		window.addEventListener('storage', onStorage);
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refresh);
		window.addEventListener(MAINTENANCE_CHANGED_EVENT, refresh);
		return () => {
			cancelled = true;
			window.removeEventListener('storage', onStorage);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
			window.removeEventListener(MAINTENANCE_CHANGED_EVENT, refresh);
		};
	}, [pathname]);

	// 维护页本身已有完整状态卡，不重复提示。
	if (!active || pathname.startsWith('/gateway/maintenance')) return null;

	return (
		<div
			role="status"
			className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-red-600 px-4 py-2 text-sm text-white"
		>
			<ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
			<span className="min-w-0 flex-1">{t('text')}</span>
			<Link href="/gateway/config#config-panel-maintenance" className="shrink-0 font-medium underline underline-offset-2 hover:text-red-100">
				{t('manage')}
			</Link>
		</div>
	);
}
