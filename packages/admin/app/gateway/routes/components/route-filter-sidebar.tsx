'use client';

import { FilterNavButton, FilterNavSection } from '../../components/filter-nav';
import type { GatewayProvider } from '@/lib/types';
import { useTranslations } from 'next-intl';
import { type ModelKindFilter } from '../../models/types';

type Props = {
	visibleModelCount: number;
	visibleRouteCount: number;
	hasActiveFilters: boolean;
	filterStatus: string;
	filterKind: ModelKindFilter;
	filterRouteGroup: string;
	filterVendor: string;
	filterProviderId: string;
	statusCounts: { all: number; active: number; inactive: number };
	kindCounts: { llm: number; image: number };
	routesCount: number;
	routeGroupFilterOptions: string[];
	routeGroupCounts: Map<string, number>;
	vendorFilterOptions: Array<{ key: string; label: string; count: number }>;
	providers: GatewayProvider[];
	providerRouteCounts: Map<string, number>;
	onFilterStatusChange: (status: string) => void;
	onFilterKindChange: (kind: ModelKindFilter) => void;
	onFilterRouteGroupChange: (group: string) => void;
	onFilterVendorChange: (vendor: string) => void;
	onFilterProviderIdChange: (providerId: string) => void;
	onClearAllFilters: () => void;
};

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
		<aside className="w-full shrink-0 border-b border-gray-200/80 bg-slate-50/80 lg:sticky lg:top-0 lg:w-60 lg:self-start lg:border-b-0 lg:border-r">
			<div className="space-y-3 p-4">
				<div>
					<h2 className="text-sm font-semibold text-gray-900">{t('title')}</h2>
					<p className="mt-0.5 text-xs text-gray-500">{t('narrowModelsRoutes')}</p>
				</div>

				<div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/60 bg-white/60 px-3 py-2">
					<span className="text-xs text-gray-600">
						{t('modelsAndRoutes', { models: visibleModelCount, routes: visibleRouteCount })}
					</span>
					{hasActiveFilters ? (
						<button
							type="button"
							onClick={onClearAllFilters}
							className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded"
						>
							{t('clear')}
						</button>
					) : null}
				</div>

				<FilterNavSection title={t('status')} ariaLabel={t('statusAria')}>
					<FilterNavButton
						label={t('all')}
						count={statusCounts.all}
						isActive={!filterStatus}
						onClick={() => onFilterStatusChange('')}
					/>
					<FilterNavButton
						label={tCommon('active')}
						count={statusCounts.active}
						isActive={filterStatus === 'active'}
						onClick={() => onFilterStatusChange('active')}
					/>
					<FilterNavButton
						label={tCommon('inactive')}
						count={statusCounts.inactive}
						isActive={filterStatus === 'inactive'}
						onClick={() => onFilterStatusChange('inactive')}
					/>
				</FilterNavSection>

				<FilterNavSection title={t('kind')} ariaLabel={t('kindAria')}>
					<FilterNavButton
						label={t('kindLlm')}
						count={kindCounts.llm}
						isActive={filterKind === 'llm'}
						onClick={() => onFilterKindChange('llm')}
					/>
					<FilterNavButton
						label={t('kindImage')}
						count={kindCounts.image}
						isActive={filterKind === 'image'}
						onClick={() => onFilterKindChange('image')}
					/>
				</FilterNavSection>

				<FilterNavSection title={t('routeGroup')} ariaLabel={t('routeGroupAria')}>
					<FilterNavButton
						label={t('all')}
						count={routesCount}
						isActive={!filterRouteGroup}
						onClick={() => onFilterRouteGroupChange('')}
					/>
					{routeGroupFilterOptions.map((g) => (
						<FilterNavButton
							key={g}
							label={g}
							count={routeGroupCounts.get(g) ?? 0}
							isActive={filterRouteGroup === g}
							onClick={() => onFilterRouteGroupChange(g)}
						/>
					))}
				</FilterNavSection>

				<FilterNavSection title={t('vendor')} ariaLabel={t('vendorAria')}>
					<FilterNavButton
						label={t('all')}
						count={routesCount}
						isActive={!filterVendor}
						onClick={() => onFilterVendorChange('')}
					/>
					{vendorFilterOptions.map(({ key, label, count }) => (
						<FilterNavButton
							key={key}
							label={label}
							count={count}
							isActive={filterVendor === key}
							onClick={() => onFilterVendorChange(key)}
						/>
					))}
				</FilterNavSection>

				<FilterNavSection title={t('provider')} ariaLabel={t('providerAria')}>
					<FilterNavButton
						label={t('all')}
						count={routesCount}
						isActive={!filterProviderId}
						onClick={() => onFilterProviderIdChange('')}
					/>
					{providers.map((p) => (
						<FilterNavButton
							key={p.id}
							label={p.name || p.id}
							count={providerRouteCounts.get(p.id) ?? 0}
							isActive={filterProviderId === p.id}
							onClick={() => onFilterProviderIdChange(p.id)}
						/>
					))}
				</FilterNavSection>
			</div>
		</aside>
	);
}
