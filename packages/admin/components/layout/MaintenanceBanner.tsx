'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

/** 维护页保存后派发，横幅据此立即刷新而不等轮询。 */
export const MAINTENANCE_CHANGED_EVENT = 'octafuse:maintenance-changed';
const POLL_MS = 60_000;

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
		const refresh = async () => {
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
			}
		};
		void refresh();
		const timer = window.setInterval(() => void refresh(), POLL_MS);
		window.addEventListener(MAINTENANCE_CHANGED_EVENT, refresh);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
			window.removeEventListener(MAINTENANCE_CHANGED_EVENT, refresh);
		};
	}, []);

	// 维护页本身已有完整状态卡，不重复提示。
	if (!active || pathname.startsWith('/gateway/maintenance')) return null;

	return (
		<div
			role="status"
			className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-red-600 px-4 py-2 text-sm text-white"
		>
			<ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
			<span className="min-w-0 flex-1">{t('text')}</span>
			<Link href="/gateway/maintenance" className="shrink-0 font-semibold underline underline-offset-2 hover:text-red-100">
				{t('manage')}
			</Link>
		</div>
	);
}
