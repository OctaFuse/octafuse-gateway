'use client';

import { MagnifyingGlassIcon, XMarkIcon, AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';
import type { GatewayProvider } from '@/lib/types';
import { useLocale, useTranslations } from 'next-intl';
import { liveProviderPickerLabel, type ProviderKindFilterOption } from '@/lib/provider-kind';
import type { RouteKindFilter } from '../types';

type Props = {
	searchQuery: string;
	onSearchChange: (query: string) => void;
	filterStatus: string;
	filterKind: RouteKindFilter;
	filterRouteGroup: string;
	filterVendor: string;
	filterProviderId: string;
	filterProviderKind: string;
	providerKindFilterOptions: ProviderKindFilterOption[];
	statusCounts: { all: number; active: number; inactive: number };
	kindCounts: { all: number; llm: number; image: number; audio: number };
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
	onFilterProviderKindChange: (providerKind: string) => void;
	onClearAllFilters: () => void;
};


export function RouteFilterSidebar(props: Props) {
	const t = useTranslations('filter');
	const tw = useTranslations('routes.workspace');
	const tc = useTranslations('common');
	const tk = useTranslations('providers.kind');
	const locale = useLocale();
	const filters = [
		{ key: 'vendor', label: t('vendor'), value: props.filterVendor, onChange: props.onFilterVendorChange,
			options: props.vendorFilterOptions.map(o => ({ value: o.key, label: o.label, count: o.count })) },
		{ key: 'providerType', label: t('providerType'), value: props.filterProviderKind, onChange: props.onFilterProviderKindChange,
			options: props.providerKindFilterOptions.map(o => ({ value: o.key, label: o.label, count: o.count })) },
		{ key: 'provider', label: t('provider'), value: props.filterProviderId, onChange: props.onFilterProviderIdChange,
			options: props.providers.map(p => ({ value: p.id, label: liveProviderPickerLabel(p, locale, tk('custom'), p.id), count: props.providerRouteCounts.get(p.id) ?? 0 })) },
		{ key: 'routeGroup', label: t('routeGroup'), value: props.filterRouteGroup, onChange: props.onFilterRouteGroupChange,
			options: props.routeGroupFilterOptions.map(value => ({ value, label: value, count: props.routeGroupCounts.get(value) ?? 0 })) },
	];
	const segments = [
		{ key: 'status', label: t('status'), value: props.filterStatus, onChange: props.onFilterStatusChange,
			options: [ { value: '', label: t('all'), count: props.statusCounts.all }, { value: 'active', label: tc('active'), count: props.statusCounts.active }, { value: 'inactive', label: tc('inactive'), count: props.statusCounts.inactive } ] },
		{ key: 'kind', label: t('kind'), value: props.filterKind, onChange: (value: string) => props.onFilterKindChange(value as RouteKindFilter),
			options: [ { value: 'all', label: t('all'), count: props.kindCounts.all }, { value: 'llm', label: t('kindLlm'), count: props.kindCounts.llm }, { value: 'image', label: t('kindImage'), count: props.kindCounts.image }, { value: 'audio', label: t('kindAudio'), count: props.kindCounts.audio } ] },
	];
	const active = [
		...filters.filter(f => f.value).map(f => ({ key: f.key, label: `${f.label}: ${f.options.find(o => o.value === f.value)?.label ?? f.value}`, clear: () => f.onChange('') })),
		...segments.filter(f => f.value && f.value !== 'all').map(f => ({ key: f.key, label: `${f.label}: ${f.options.find(o => o.value === f.value)?.label ?? f.value}`, clear: () => f.onChange(f.key === 'kind' ? 'all' : '') })),
		...(props.searchQuery ? [{ key: 'search', label: props.searchQuery, clear: () => props.onSearchChange('') }] : []),
	];
	return (
		<section className="mb-5 rounded-xl border border-slate-200 bg-white" aria-label={t('title')}>
			<div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
				<AdjustmentsHorizontalIcon className="h-4 w-4 text-slate-400" aria-hidden />
				<h2 className="text-sm font-semibold text-slate-800">{t('title')}</h2>
				<div className="relative ml-auto w-full sm:w-80">
					<MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
					<input type="search" value={props.searchQuery} onChange={e => props.onSearchChange(e.target.value)} placeholder={tw('searchPlaceholder')} aria-label={tw('searchPlaceholder')} className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
				</div>
			</div>
			<div className="space-y-3 px-4 py-3">
				<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
					{segments.map(segment => (
						<div key={segment.key} className="flex flex-wrap items-center gap-2" role="group" aria-label={segment.label}>
							<span className="text-xs text-slate-500">{segment.label}</span>
							<div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100/80 p-1">
								{segment.options.map(option => <button key={option.value} type="button" aria-pressed={segment.value === option.value} onClick={() => segment.onChange(option.value)} className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs transition focus-visible:outline-blue-500 ${segment.value === option.value ? 'bg-white font-semibold text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
									{option.label}<span className="text-[10px] tabular-nums opacity-70">{option.count}</span>
								</button>)}
							</div>
						</div>
					))}
				</div>
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					{filters.map(filter => <label key={filter.key} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
						<span className="shrink-0 text-[11px] text-slate-500">{filter.label}</span>
						<select value={filter.value} onChange={e => filter.onChange(e.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-medium text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
							<option value="">{t('all')}</option>
							{filter.value && !filter.options.some(o => o.value === filter.value) ? <option value={filter.value}>{filter.value}</option> : null}
							{filter.options.map(option => <option key={option.value} value={option.value}>{option.label} ({option.count})</option>)}
						</select>
					</label>)}
				</div>
			</div>
			{active.length > 0 ? <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-2">
				{active.map(item => <button key={item.key} type="button" onClick={item.clear} aria-label={tw('removeFilter', {filter: item.label})} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-100 focus-visible:outline-blue-500"><span className="truncate">{item.label}</span><XMarkIcon className="h-3 w-3 shrink-0" aria-hidden /></button>)}
				<button type="button" onClick={props.onClearAllFilters} className="ml-auto text-xs font-medium text-slate-500 hover:text-blue-700">{tc('clearAllFilters')}</button>
			</div> : null}
		</section>
	);
}
