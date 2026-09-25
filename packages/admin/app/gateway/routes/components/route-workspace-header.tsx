'use client';

import { QueueListIcon, RectangleGroupIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { StickyRefreshIntervalMs } from '../sticky-refresh-preference';
import type { RouteFlowDensity, RouteWorkspaceView } from '../types';
import { StickyRefreshControl } from './sticky-refresh-control';

type Props = {
	visibleModelCount: number;
	visibleRouteCount: number;
	density: RouteFlowDensity;
	onDensityChange: (density: RouteFlowDensity) => void;
	view: RouteWorkspaceView;
	onViewChange: (view: RouteWorkspaceView) => void;
	stickyRefreshIntervalMs: StickyRefreshIntervalMs;
};

export function RouteWorkspaceHeader(props: Props) {
	const { visibleModelCount, visibleRouteCount, density, onDensityChange, view, onViewChange, stickyRefreshIntervalMs } = props;
	const t = useTranslations('routes.workspace');

	return (
		<div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:px-6">
			<div className="min-w-0">
				<h2 className="text-base font-semibold text-gray-900">{t('title')}</h2>
				<p className="mt-0.5 text-xs tabular-nums text-slate-500" aria-live="polite">{t('surfaceCounts', {models: visibleModelCount, routes: visibleRouteCount})}</p>
			</div>
			<div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
				<div
					className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-slate-200"
					role="group"
					aria-label={t('viewGroupAria')}
				>
					<button
						type="button"
						onClick={() => onViewChange('overview')}
						className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
							view === 'overview'
								? 'bg-white text-slate-900 shadow-sm'
								: 'text-slate-600 hover:text-slate-900'
						}`}
						aria-pressed={view === 'overview'}
						title={t('viewOverviewHint')}
					>
						<RectangleGroupIcon className="h-4 w-4" />
						{t('viewOverview')}
					</button>
					<button
						type="button"
						onClick={() => onViewChange('byModel')}
						className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
							view === 'byModel'
								? 'bg-white text-slate-900 shadow-sm'
								: 'text-slate-600 hover:text-slate-900'
						}`}
						aria-pressed={view === 'byModel'}
						title={t('viewByModelHint')}
					>
						<QueueListIcon className="h-4 w-4" />
						{t('viewByModel')}
					</button>
				</div>
				<div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label={t('densityLabel')}>
					{(['summary', 'topology'] as const).map(value => <button key={value} type="button" onClick={() => onDensityChange(value)} aria-pressed={density === value} className={`rounded-md px-2.5 py-1.5 text-xs font-medium focus-visible:outline-blue-500 ${density === value ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}>{t(value === 'summary' ? 'densityCompact' : 'densityDetailed')}</button>)}
				</div>
				<StickyRefreshControl intervalMs={stickyRefreshIntervalMs} />
			</div>
		</div>
	);
}
