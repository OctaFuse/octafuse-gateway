'use client';

import { PricingInfoHint } from '@/components/PricingInfoHint';
import {
	ListBulletIcon,
	QueueListIcon,
	RectangleGroupIcon,
	Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { StickyRefreshIntervalMs } from '../sticky-refresh-preference';
import type { RouteFlowDensity, RouteWorkspaceView } from '../types';
import { RouteOptionsDialog } from './route-options-dialog';
import { StickyRefreshControl } from './sticky-refresh-control';
import { useRoutePricingDisplay } from '../use-route-pricing-display';
import { useRoutePathDisplay } from '../use-route-path-display';

type Props = {
	visibleModelCount: number;
	visibleRouteCount: number;
	density: RouteFlowDensity;
	onDensityChange: (density: RouteFlowDensity) => void;
	view: RouteWorkspaceView;
	onViewChange: (view: RouteWorkspaceView) => void;
	stickyRefreshIntervalMs: StickyRefreshIntervalMs;
};

const VIEW_SWITCH_GROUP_CLASS = 'inline-flex shrink-0 rounded-lg bg-gray-100 p-1';

function viewSwitchButtonClass(active: boolean) {
	return `inline-flex items-center gap-1 rounded-md px-2 py-1.5 sm:gap-1.5 sm:px-2.5 text-xs font-medium transition-colors focus-visible:outline-gray-500 ${
		active ? 'bg-white text-gray-950 shadow-sm' : 'text-slate-500 hover:bg-slate-50'
	}`;
}

export function RouteWorkspaceHeader(props: Props) {
	const {
		visibleModelCount,
		visibleRouteCount,
		density,
		onDensityChange,
		view,
		onViewChange,
		stickyRefreshIntervalMs,
	} = props;
	const t = useTranslations('routes.workspace');
	const [pricingDisplay, setPricingDisplay] = useRoutePricingDisplay();
	const [pathDisplay, setPathDisplay] = useRoutePathDisplay();

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-white px-4 py-3 sm:px-5">
			<div className="min-w-0">
				<h2 className="flex items-center gap-2 text-base font-medium text-gray-900">
					{t('title')}
					<PricingInfoHint kind="routeFactors" align="start" />
				</h2>
				<p className="mt-0.5 text-xs tabular-nums text-slate-500" aria-live="polite">
					{t('surfaceCounts', { models: visibleModelCount, routes: visibleRouteCount })}
				</p>
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-1 sm:justify-end sm:gap-3">
				<div className="flex items-center gap-2" role="group" aria-label={t('organizationLabel')}>
					<div className={VIEW_SWITCH_GROUP_CLASS}>
						<button
							type="button"
							onClick={() => onViewChange('overview')}
							className={viewSwitchButtonClass(view === 'overview')}
							aria-pressed={view === 'overview'}
							title={t('viewOverviewHint')}
						>
							<RectangleGroupIcon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden />
							{t('viewOverview')}
						</button>
						<button
							type="button"
							onClick={() => onViewChange('byModel')}
							className={viewSwitchButtonClass(view === 'byModel')}
							aria-pressed={view === 'byModel'}
							title={t('viewByModelHint')}
						>
							<QueueListIcon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden />
							{t('viewByModel')}
						</button>
					</div>
				</div>
				<div className="flex items-center gap-2" role="group" aria-label={t('displayLabel')}>
					<div className={VIEW_SWITCH_GROUP_CLASS}>
						{(
							[
								['topology', Squares2X2Icon],
								['list', ListBulletIcon],
							] as const
						).map(([value, Icon]) => (
							<button
								key={value}
								type="button"
								onClick={() => onDensityChange(value)}
								aria-pressed={density === value}
								title={t(value === 'list' ? 'densityListHint' : 'densityCards')}
								aria-label={t(value === 'list' ? 'densityList' : 'densityCards')}
								className={viewSwitchButtonClass(density === value)}
							>
								<Icon className="h-4 w-4 shrink-0" aria-hidden />
								<span className="sr-only">{t(value === 'list' ? 'densityList' : 'densityCards')}</span>
							</button>
						))}
					</div>
				</div>
				<RouteOptionsDialog label={t('displaySettings')} compact>
					<div
						className="flex flex-wrap items-center justify-between gap-3"
						role="group"
						aria-label={t('pricingDisplayLabel')}
					>
						<span className="shrink-0 text-xs text-slate-500">{t('pricingDisplayLabel')}</span>
						<div className={VIEW_SWITCH_GROUP_CLASS}>
							{(['effective', 'configured'] as const).map((value) => (
								<button
									key={value}
									type="button"
									onClick={() => setPricingDisplay(value)}
									aria-pressed={pricingDisplay === value}
									title={t(
										value === 'effective' ? 'pricingDisplayEffectiveHint' : 'pricingDisplayConfiguredHint'
									)}
									className={viewSwitchButtonClass(pricingDisplay === value)}
								>
									{t(value === 'effective' ? 'pricingDisplayEffective' : 'pricingDisplayConfigured')}
								</button>
							))}
						</div>
					</div>
					<div
						className="flex flex-wrap items-center justify-between gap-3"
						role="group"
						aria-label={t('pathDisplayLabel')}
					>
						<span className="shrink-0 text-xs text-slate-500">{t('pathDisplayLabel')}</span>
						<div className={VIEW_SWITCH_GROUP_CLASS}>
							{(['full', 'compact'] as const).map((value) => (
								<button
									key={value}
									type="button"
									onClick={() => setPathDisplay(value)}
									aria-pressed={pathDisplay === value}
									title={t(value === 'full' ? 'pathDisplayFullHint' : 'pathDisplayCompactHint')}
									className={viewSwitchButtonClass(pathDisplay === value)}
								>
									{t(value === 'full' ? 'pathDisplayFull' : 'pathDisplayCompact')}
								</button>
							))}
						</div>
					</div>
					<StickyRefreshControl intervalMs={stickyRefreshIntervalMs} />
				</RouteOptionsDialog>
				<StickyRefreshControl intervalMs={stickyRefreshIntervalMs} compact />
			</div>
		</div>
	);
}
