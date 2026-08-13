'use client';

import { Squares2X2Icon, QueueListIcon, ViewColumnsIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { StickyRefreshIntervalMs } from '../sticky-refresh-preference';
import type { RouteFlowDensity } from '../types';
import { StickyRefreshControl } from './sticky-refresh-control';

type Props = {
	activeFilterSummary: string[];
	density: RouteFlowDensity;
	onDensityChange: (density: RouteFlowDensity) => void;
	stickyRefreshIntervalMs: StickyRefreshIntervalMs;
};

export function RouteWorkspaceHeader(props: Props) {
	const { activeFilterSummary, density, onDensityChange, stickyRefreshIntervalMs } = props;
	const t = useTranslations('routes.workspace');

	return (
		<div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/80 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6">
			<div className="flex min-w-0 flex-wrap items-center gap-3">
				<div className="min-w-0">
					<h2 className="text-base font-semibold text-gray-900">{t('title')}</h2>
					{activeFilterSummary.length > 0 ? (
						<p
							className="mt-0.5 truncate text-xs text-gray-500"
							title={activeFilterSummary.join(' · ')}
						>
							{t('filteredBy', { summary: activeFilterSummary.join(' · ') })}
						</p>
					) : (
						<p className="mt-0.5 text-xs text-gray-500">{t('allModelsRoutes')}</p>
					)}
				</div>
				<StickyRefreshControl intervalMs={stickyRefreshIntervalMs} />
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-2">
				<div
					className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-slate-200"
					role="group"
					aria-label={t('densityGroupAria')}
				>
					<button
						type="button"
						onClick={() => onDensityChange('summary')}
						className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
							density === 'summary'
								? 'bg-white text-slate-900 shadow-sm'
								: 'text-slate-600 hover:text-slate-900'
						}`}
						aria-pressed={density === 'summary'}
						title={t('densitySummaryHint')}
					>
						<QueueListIcon className="h-4 w-4" />
						{t('densitySummary')}
					</button>
					<button
						type="button"
						onClick={() => onDensityChange('topology')}
						className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
							density === 'topology'
								? 'bg-white text-slate-900 shadow-sm'
								: 'text-slate-600 hover:text-slate-900'
						}`}
						aria-pressed={density === 'topology'}
						title={t('densityTopologyHint')}
					>
						<Squares2X2Icon className="h-4 w-4" />
						{t('densityTopology')}
					</button>
					<button
						type="button"
						onClick={() => onDensityChange('surface')}
						className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
							density === 'surface'
								? 'bg-white text-slate-900 shadow-sm'
								: 'text-slate-600 hover:text-slate-900'
						}`}
						aria-pressed={density === 'surface'}
						title={t('densitySurfaceHint')}
					>
						<ViewColumnsIcon className="h-4 w-4" />
						{t('densitySurface')}
					</button>
				</div>
			</div>
		</div>
	);
}
