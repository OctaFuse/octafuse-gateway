'use client';

import { FilterNavButton, FilterNavSection } from '../../components/filter-nav';
import type { GatewayProvider } from '@/lib/types';

type Props = {
	visibleModelCount: number;
	visibleRouteCount: number;
	hasActiveFilters: boolean;
	filterStatus: string;
	filterRouteGroup: string;
	filterVendor: string;
	filterProviderId: string;
	statusCounts: { all: number; active: number; inactive: number };
	routesCount: number;
	routeGroupFilterOptions: string[];
	routeGroupCounts: Map<string, number>;
	vendorFilterOptions: Array<{ key: string; label: string; count: number }>;
	providers: GatewayProvider[];
	providerRouteCounts: Map<string, number>;
	onFilterStatusChange: (status: string) => void;
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
		filterRouteGroup,
		filterVendor,
		filterProviderId,
		statusCounts,
		routesCount,
		routeGroupFilterOptions,
		routeGroupCounts,
		vendorFilterOptions,
		providers,
		providerRouteCounts,
		onFilterStatusChange,
		onFilterRouteGroupChange,
		onFilterVendorChange,
		onFilterProviderIdChange,
		onClearAllFilters,
	} = props;

	return (
		<aside className="w-full shrink-0 border-b border-gray-200/80 bg-slate-50/80 lg:sticky lg:top-0 lg:w-60 lg:self-start lg:border-b-0 lg:border-r">
			<div className="space-y-3 p-4">
				<div>
					<h2 className="text-sm font-semibold text-gray-900">Filters</h2>
					<p className="mt-0.5 text-xs text-gray-500">Narrow models and routes</p>
				</div>

				<div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/60 bg-white/60 px-3 py-2">
					<span className="text-xs text-gray-600">
						<span className="font-semibold tabular-nums text-gray-900">{visibleModelCount}</span> models ·{' '}
						<span className="font-semibold tabular-nums text-gray-900">{visibleRouteCount}</span> routes
					</span>
					{hasActiveFilters ? (
						<button
							type="button"
							onClick={onClearAllFilters}
							className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded"
						>
							Clear
						</button>
					) : null}
				</div>

				<FilterNavSection title="Status" ariaLabel="Status filter">
					<FilterNavButton
						label="All"
						count={statusCounts.all}
						isActive={!filterStatus}
						onClick={() => onFilterStatusChange('')}
					/>
					<FilterNavButton
						label="Active"
						count={statusCounts.active}
						isActive={filterStatus === 'active'}
						onClick={() => onFilterStatusChange('active')}
					/>
					<FilterNavButton
						label="Inactive"
						count={statusCounts.inactive}
						isActive={filterStatus === 'inactive'}
						onClick={() => onFilterStatusChange('inactive')}
					/>
				</FilterNavSection>

				<FilterNavSection title="Route Group" ariaLabel="Route group filter">
					<FilterNavButton
						label="All"
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

				<FilterNavSection title="Vendor" ariaLabel="Vendor filter">
					<FilterNavButton
						label="All"
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

				<FilterNavSection title="Provider" ariaLabel="Provider filter">
					<FilterNavButton
						label="All"
						count={routesCount}
						isActive={!filterProviderId}
						onClick={() => onFilterProviderIdChange('')}
					/>
					{providers.map((p) => {
						const label = p.name ? `${p.name} (${p.id})` : p.id;
						return (
							<FilterNavButton
								key={p.id}
								label={label}
								count={providerRouteCounts.get(p.id) ?? 0}
								isActive={filterProviderId === p.id}
								onClick={() => onFilterProviderIdChange(p.id)}
							/>
						);
					})}
				</FilterNavSection>
			</div>
		</aside>
	);
}
