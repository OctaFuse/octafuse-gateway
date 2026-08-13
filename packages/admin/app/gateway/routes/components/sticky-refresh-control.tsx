'use client';

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
	STICKY_REFRESH_INTERVAL_OPTIONS,
	type StickyRefreshIntervalMs,
	writeStickyRefreshInterval,
} from '../sticky-refresh-preference';
import { useStickyRefreshControls } from '../sticky-summary-store';

type Props = {
	intervalMs: StickyRefreshIntervalMs;
};

function formatAgo(elapsedMs: number): string {
	const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m`;
}

export function StickyRefreshControl(props: Props) {
	const { intervalMs } = props;
	const t = useTranslations('routes.workspace');
	const { refreshAll, isRefreshing, lastUpdatedAt, registeredCount } = useStickyRefreshControls();
	const disabled = registeredCount === 0;
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (lastUpdatedAt == null) return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [lastUpdatedAt]);

	const agoLabel =
		lastUpdatedAt != null
			? t('stickyRefreshUpdatedAgo', { ago: formatAgo(now - lastUpdatedAt) })
			: null;

	return (
		<div
			className="flex items-center gap-1.5"
			title={disabled ? t('stickyRefreshEmptyHint') : t('stickyRefreshLabel')}
		>
			<label className="sr-only" htmlFor="routes-sticky-refresh-interval">
				{t('stickyRefreshLabel')}
			</label>
			<select
				id="routes-sticky-refresh-interval"
				value={intervalMs === 'off' ? 'off' : String(intervalMs)}
				disabled={disabled}
				onChange={(e) => {
					const raw = e.target.value;
					const next: StickyRefreshIntervalMs =
						raw === '60000'
							? 60_000
							: raw === '300000'
								? 300_000
								: raw === '600000'
									? 600_000
									: 'off';
					if (!STICKY_REFRESH_INTERVAL_OPTIONS.includes(next)) return;
					writeStickyRefreshInterval(next);
				}}
				className="max-w-[9.5rem] rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-600 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<option value="off">{t('stickyRefreshOff')}</option>
				<option value="60000">{t('stickyRefresh1m')}</option>
				<option value="300000">{t('stickyRefresh5m')}</option>
				<option value="600000">{t('stickyRefresh10m')}</option>
			</select>
			<button
				type="button"
				onClick={() => void refreshAll()}
				disabled={disabled || isRefreshing}
				title={agoLabel ? `${t('stickyRefreshNow')} · ${agoLabel}` : t('stickyRefreshNow')}
				aria-label={t('stickyRefreshNow')}
				className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<ArrowPathIcon className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
			</button>
		</div>
	);
}
