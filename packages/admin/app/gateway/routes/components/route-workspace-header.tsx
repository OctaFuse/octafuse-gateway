'use client';

import { useRef } from 'react';
import { useElementWidth } from '@/components/use-element-width';
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
import type { RouteModelLayout } from '../use-route-display-preferences';
import { useRoutePricingDisplay } from '../use-route-display-preferences';
import { useRoutePathDisplay } from '../use-route-path-display';

type Props = {
	modelLayout: RouteModelLayout;
	onModelLayoutChange: (layout: RouteModelLayout) => void;
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
		modelLayout,
		onModelLayoutChange,
		density,
		onDensityChange,
		view,
		onViewChange,
		stickyRefreshIntervalMs,
	} = props;
	const t = useTranslations('routes.workspace');
	const [pricingDisplay, setPricingDisplay] = useRoutePricingDisplay();
	const [pathDisplay, setPathDisplay] = useRoutePathDisplay();

	const toolbarRef = useRef<HTMLDivElement>(null);
	const inlineSettings = useElementWidth(toolbarRef) >= 768;
	const choiceClass = 'flex flex-wrap items-center justify-between gap-2';
	const labelClass = 'text-xs text-slate-500';
	const displaySettings = (
		<>
			<div className={choiceClass} role="group" aria-label={t('displayLabel')}>
				<span className={labelClass}>{t('displayLabel')}</span>
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
							<span>{t(value === 'list' ? 'densityList' : 'densityCards')}</span>
						</button>
					))}
				</div>
			</div>
			{view === 'byModel' && (
				<div className={choiceClass} role="group" aria-label={t('modelLayoutLabel')}>
					<span className={labelClass}>{t('modelLayoutLabel')}</span>
					<div className={VIEW_SWITCH_GROUP_CLASS}>
						{(['compact', 'tiled'] as const).map(layout => (
							<button
								key={layout}
								type="button"
								onClick={() => onModelLayoutChange(layout)}
								aria-pressed={modelLayout === layout}
								className={viewSwitchButtonClass(modelLayout === layout)}
							>
								{t(layout === 'compact' ? 'modelLayoutCompact' : 'modelLayoutTiled')}
							</button>
						))}
					</div>
				</div>
			)}
			<div
				className={choiceClass}
				role="group"
				aria-label={t('pricingDisplayLabel')}
			>
				<span className={labelClass}>{t('pricingDisplayLabel')}</span>
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
				className={choiceClass}
				role="group"
				aria-label={t('pathDisplayLabel')}
			>
				<span className={labelClass}>{t('pathDisplayLabel')}</span>
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
		</>
	);

	return (
		<div ref={toolbarRef} className="route-workspace-toolbar min-w-0 rounded-xl border border-gray-200/80 bg-white">
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
				<h2 className="flex min-w-0 items-center gap-2 text-base font-medium text-gray-900">
					{t('title')}
					<PricingInfoHint kind="routeFactors" align="start" />
				</h2>
				<div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
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
					{!inlineSettings && (
						<RouteOptionsDialog label={t('displaySettings')}>{displaySettings}</RouteOptionsDialog>
					)}
					<StickyRefreshControl intervalMs={stickyRefreshIntervalMs} />
				</div>
			</div>
			{inlineSettings && (
				<div role="group" aria-label={t('displaySettings')}
					className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-100 px-4 py-2 sm:px-5">
					{displaySettings}
				</div>
			)}
		</div>
	);
}
