'use client';

import { PricingInfoHint } from '@/components/PricingInfoHint';
import { ListBulletIcon, QueueListIcon, RectangleGroupIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
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

const VIEW_SWITCH_GROUP_CLASS = 'inline-flex shrink-0 rounded-lg border border-slate-200 p-0.5';

function viewSwitchButtonClass(active: boolean) {
	return `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-blue-500 ${active ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`;
}

export function RouteWorkspaceHeader(props: Props) {
	const { visibleModelCount, visibleRouteCount, density, onDensityChange, view, onViewChange, stickyRefreshIntervalMs } = props;
	const t = useTranslations('routes.workspace');

	return (
		<div className="md:sticky md:top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:px-6">
			<div className="min-w-0">
				<h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">{t('title')}<PricingInfoHint kind="routeFactors" align="start" /></h2>
				<p className="mt-0.5 text-xs tabular-nums text-slate-500" aria-live="polite">{t('surfaceCounts', {models: visibleModelCount, routes: visibleRouteCount})}</p>
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end sm:gap-3">
				<div className="flex items-center gap-2" role="group" aria-label={t('organizationLabel')}>
					<span className="shrink-0 text-xs text-slate-500">{t('organizationLabel')}</span>
					<div className={VIEW_SWITCH_GROUP_CLASS}>
						<button
							type="button"
							onClick={() => onViewChange('overview')}
							className={viewSwitchButtonClass(view === 'overview')}
							aria-pressed={view === 'overview'}
							title={t('viewOverviewHint')}
						>
							<RectangleGroupIcon className="h-4 w-4 shrink-0" aria-hidden />
							{t('viewOverview')}
						</button>
						<button
							type="button"
							onClick={() => onViewChange('byModel')}
							className={viewSwitchButtonClass(view === 'byModel')}
							aria-pressed={view === 'byModel'}
							title={t('viewByModelHint')}
						>
							<QueueListIcon className="h-4 w-4 shrink-0" aria-hidden />
							{t('viewByModel')}
						</button>
					</div>
				</div>
				<div className="flex items-center gap-2" role="group" aria-label={t('displayLabel')}>
					<span className="shrink-0 text-xs text-slate-500">{t('displayLabel')}</span>
					<div className={VIEW_SWITCH_GROUP_CLASS}>
						{([
							['topology', Squares2X2Icon],
							['list', ListBulletIcon],
						] as const).map(([value, Icon]) => (
							<button
								key={value}
								type="button"
								onClick={() => onDensityChange(value)}
								aria-pressed={density === value}
								title={value === 'list' ? t('densityListHint') : undefined}
								className={viewSwitchButtonClass(density === value)}
							>
								<Icon className="h-4 w-4 shrink-0" aria-hidden />
								{t(value === 'list' ? 'densityList' : 'densityCards')}
							</button>
						))}
					</div>
				</div>
				<StickyRefreshControl intervalMs={stickyRefreshIntervalMs} />
			</div>
		</div>
	);
}
