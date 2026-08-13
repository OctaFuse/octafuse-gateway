'use client';

import { FilterNavButton, FilterNavSection } from '../../components/filter-nav';
import type { GatewayProvider } from '@/lib/types';
import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';
import type { RouteKindFilter } from '../types';

type Props = {
	visibleModelCount: number;
	visibleRouteCount: number;
	hasActiveFilters: boolean;
	filterStatus: string;
	filterKind: RouteKindFilter;
	filterRouteGroup: string;
	filterVendor: string;
	filterProviderId: string;
	statusCounts: { all: number; active: number; inactive: number };
	kindCounts: { all: number; llm: number; image: number; audio: number };
	routesCount: number;
	routeGroupFilterOptions: string[];
	routeGroupCounts: Map<string, number>;
	vendorFilterOptions: Array<{ key: string; label: string; count: number }>;
	providers: GatewayProvider[];
	providerRouteCounts: Map<string, number>;
	onFilterStatusChange: (status: string) => void;
	onFilterKindChange: (kind: RouteKindFilter) => void;
	onFilterRouteGroupChange: (group: string) => void;
	onFilterVendorChange: (vendor: string) => void;
	onFilterProviderIdChange: (providerId: string) => void;
	onClearAllFilters: () => void;
};

function HorizontalSection(props: Omit<ComponentProps<typeof FilterNavSection>, 'orientation'>) {
	return <FilterNavSection orientation="horizontal" {...props} />;
}

function HorizontalButton(props: Omit<ComponentProps<typeof FilterNavButton>, 'orientation'>) {
	return <FilterNavButton orientation="horizontal" {...props} />;
}

export function RouteFilterSidebar(props: Props) {
	const {
		visibleModelCount,
		visibleRouteCount,
		hasActiveFilters,
		filterStatus,
		filterKind,
		filterRouteGroup,
		filterVendor,
		filterProviderId,
		statusCounts,
		kindCounts,
		routesCount,
		routeGroupFilterOptions,
		routeGroupCounts,
		vendorFilterOptions,
		providers,
		providerRouteCounts,
		onFilterStatusChange,
		onFilterKindChange,
		onFilterRouteGroupChange,
		onFilterVendorChange,
		onFilterProviderIdChange,
		onClearAllFilters,
	} = props;

	const t = useTranslations('filter');
	const tCommon = useTranslations('common');

	return (
		<div className="border-b border-gray-200/80 bg-slate-50/90 px-4 py-3 sm:px-6">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<div className="min-w-0">
					<p className="text-xs text-gray-600">
						<span className="font-medium text-gray-800">{t('title')}</span>
						<span className="text-gray-300"> · </span>
						{t('modelsAndRoutes', { models: visibleModelCount, routes: visibleRouteCount })}
					</p>
					<p className="mt-0.5 text-[11px] text-gray-400">{t('narrowModelsRoutes')}</p>
				</div>
				{hasActiveFilters ? (
					<button
						type="button"
						onClick={onClearAllFilters}
						className="shrink-0 rounded text-xs font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
					>
						{t('clear')}
					</button>
				) : null}
			</div>

			<div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
				<HorizontalSection title={t('status')} ariaLabel={t('statusAria')}>
					<HorizontalButton
						label={t('all')}
						count={statusCounts.all}
						isActive={!filterStatus}
						onClick={() => onFilterStatusChange('')}
					/>
					<HorizontalButton
						label={tCommon('active')}
						count={statusCounts.active}
						isActive={filterStatus === 'active'}
						onClick={() => onFilterStatusChange('active')}
					/>
					<HorizontalButton
						label={tCommon('inactive')}
						count={statusCounts.inactive}
						isActive={filterStatus === 'inactive'}
						onClick={() => onFilterStatusChange('inactive')}
					/>
				</HorizontalSection>

				<HorizontalSection title={t('kind')} ariaLabel={t('kindAria')}>
					<HorizontalButton
						label={t('all')}
						count={kindCounts.all}
						isActive={filterKind === 'all'}
						onClick={() => onFilterKindChange('all')}
					/>
					<HorizontalButton
						label={t('kindLlm')}
						count={kindCounts.llm}
						isActive={filterKind === 'llm'}
						onClick={() => onFilterKindChange('llm')}
					/>
					<HorizontalButton
						label={t('kindImage')}
						count={kindCounts.image}
						isActive={filterKind === 'image'}
						onClick={() => onFilterKindChange('image')}
					/>
					<HorizontalButton
						label={t('kindAudio')}
						count={kindCounts.audio}
						isActive={filterKind === 'audio'}
						onClick={() => onFilterKindChange('audio')}
					/>
				</HorizontalSection>

				<HorizontalSection title={t('routeGroup')} ariaLabel={t('routeGroupAria')}>
					<HorizontalButton
						label={t('all')}
						count={routesCount}
						isActive={!filterRouteGroup}
						onClick={() => onFilterRouteGroupChange('')}
					/>
					{routeGroupFilterOptions.map((g) => (
						<HorizontalButton
							key={g}
							label={g}
							count={routeGroupCounts.get(g) ?? 0}
							isActive={filterRouteGroup === g}
							onClick={() => onFilterRouteGroupChange(g)}
						/>
					))}
				</HorizontalSection>

				<HorizontalSection title={t('vendor')} ariaLabel={t('vendorAria')}>
					<HorizontalButton
						label={t('all')}
						count={routesCount}
						isActive={!filterVendor}
						onClick={() => onFilterVendorChange('')}
					/>
					{vendorFilterOptions.map(({ key, label, count }) => (
						<HorizontalButton
							key={key}
							label={label}
							count={count}
							isActive={filterVendor === key}
							onClick={() => onFilterVendorChange(key)}
						/>
					))}
				</HorizontalSection>

				<HorizontalSection title={t('provider')} ariaLabel={t('providerAria')}>
					<HorizontalButton
						label={t('all')}
						count={routesCount}
						isActive={!filterProviderId}
						onClick={() => onFilterProviderIdChange('')}
					/>
					{providers.map((p) => (
						<HorizontalButton
							key={p.id}
							label={p.name || p.id}
							count={providerRouteCounts.get(p.id) ?? 0}
							isActive={filterProviderId === p.id}
							onClick={() => onFilterProviderIdChange(p.id)}
						/>
					))}
				</HorizontalSection>
			</div>
		</div>
	);
}
