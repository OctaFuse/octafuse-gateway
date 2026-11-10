'use client';

import { RouteOptionsDialog } from './route-options-dialog';

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
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
	kindCounts: { all: number; llm: number; image: number; asr: number; tts: number; embedding: number };
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
		{
			key: 'vendor',
			label: t('vendor'),
			value: props.filterVendor,
			onChange: props.onFilterVendorChange,
			options: props.vendorFilterOptions.map((o) => ({ value: o.key, label: o.label, count: o.count })),
		},
		{
			key: 'providerType',
			label: t('providerType'),
			value: props.filterProviderKind,
			onChange: props.onFilterProviderKindChange,
			options: props.providerKindFilterOptions.map((o) => ({ value: o.key, label: o.label, count: o.count })),
		},
		{
			key: 'provider',
			label: t('provider'),
			value: props.filterProviderId,
			onChange: props.onFilterProviderIdChange,
			options: props.providers.map((p) => ({
				value: p.id,
				label: liveProviderPickerLabel(p, locale, tk('custom'), p.id),
				count: props.providerRouteCounts.get(p.id) ?? 0,
			})),
		},
		{
			key: 'routeGroup',
			label: t('routeGroup'),
			value: props.filterRouteGroup,
			onChange: props.onFilterRouteGroupChange,
			options: props.routeGroupFilterOptions.map((value) => ({
				value,
				label: value,
				count: props.routeGroupCounts.get(value) ?? 0,
			})),
		},
	];
	const kindOptions = [
		{ value: 'all', label: t('all'), count: props.kindCounts.all },
		{ value: 'llm', label: t('kindLlm'), count: props.kindCounts.llm },
		{ value: 'image', label: t('kindImage'), count: props.kindCounts.image },
		{ value: 'asr', label: t('kindAsr'), count: props.kindCounts.asr },
		{ value: 'tts', label: t('kindTts'), count: props.kindCounts.tts },
		{ value: 'embedding', label: t('kindEmbedding'), count: props.kindCounts.embedding },
	];
	const hasActiveFilters = Boolean(props.searchQuery || props.filterStatus || props.filterKind !== 'all' || filters.some(filter => filter.value));
	const selectClass =
		'h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100';
	const renderFilter = (filter: (typeof filters)[number], expanded = false) => (
		<label
			key={filter.key}
			className={
				expanded
					? 'block min-w-0'
					: `min-w-0 ${filter.key === 'provider' ? 'hidden w-48 sm:block' : 'hidden w-36 sm:block'}`
			}
		>
			<span className={expanded ? 'mb-1.5 block text-xs font-medium text-gray-600' : 'sr-only'}>
				{filter.label}
			</span>
			<select
				aria-label={filter.label}
				value={filter.value}
				onChange={(event) => filter.onChange(event.target.value)}
				className={selectClass}
			>
				<option value="">
					{tw(
						(
							{
								vendor: 'allVendors',
								providerType: 'allProviderKinds',
								provider: 'allProviders',
								routeGroup: 'allRouteGroups',
							} as Record<string, string>
						)[filter.key]
					)}
				</option>
				{filter.value && !filter.options.some((option) => option.value === filter.value) && (
					<option value={filter.value}>{filter.value}</option>
				)}
				{filter.options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label} ({option.count})
					</option>
				))}
			</select>
		</label>
	);
	const advancedCount = filters.filter(
		(filter) => filter.value && ['vendor', 'providerType'].includes(filter.key)
	).length;
	const mobileCount = filters.filter((filter) => filter.value).length;
	return (
		<section className="mb-5 space-y-4" aria-label={t('title')}>
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
						aria-hidden
					/>
					<input
						type="search"
						value={props.searchQuery}
						onChange={(event) => props.onSearchChange(event.target.value)}
						placeholder={tw('searchPlaceholder')}
						aria-label={tw('searchPlaceholder')}
						className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-9 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
					/>
					{props.searchQuery && (
						<button
							type="button"
							aria-label={tw('clearSearch')}
							onClick={() => props.onSearchChange('')}
							className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"
						>
							<XMarkIcon className="h-4 w-4" aria-hidden />
						</button>
					)}
				</div>
				<select
					aria-label={t('status')}
					value={props.filterStatus}
					onChange={(event) => props.onFilterStatusChange(event.target.value)}
					className={`${selectClass} !w-auto`}
				>
					<option value="">
						{tw('allStatuses')} ({props.statusCounts.all})
					</option>
					<option value="active">
						{tc('active')} ({props.statusCounts.active})
					</option>
					<option value="inactive">
						{tc('inactive')} ({props.statusCounts.inactive})
					</option>
				</select>
				{filters
					.filter((filter) => ['provider', 'routeGroup'].includes(filter.key))
					.map((filter) => renderFilter(filter))}
				<div className="hidden sm:block">
					<RouteOptionsDialog label={tw('moreFilters')} activeCount={advancedCount}>
						{filters
							.filter((filter) => ['vendor', 'providerType'].includes(filter.key))
							.map((filter) => renderFilter(filter, true))}
					</RouteOptionsDialog>
				</div>
				<div className="sm:hidden">
					<RouteOptionsDialog label={tw('moreFilters')} activeCount={mobileCount}>
						{filters.map((filter) => renderFilter(filter, true))}
					</RouteOptionsDialog>
				</div>
			</div>
			<div
				className="flex flex-wrap items-center gap-1 border-b border-gray-200 pb-3"
				role="group"
				aria-label={t('kind')}
			>
				{kindOptions.map((option) => (
					<button
						key={option.value}
						type="button"
						aria-pressed={props.filterKind === option.value}
						onClick={() => props.onFilterKindChange(option.value as RouteKindFilter)}
						className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
							props.filterKind === option.value
								? 'bg-gray-950 font-medium text-white'
								: 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
						}`}
					>
						{option.label}
						<span
							className={`font-mono tabular-nums ${
								props.filterKind === option.value ? 'text-white/70' : 'text-gray-400'
							}`}
						>
							{option.count}
						</span>
					</button>
				))}
				{hasActiveFilters && (
					<button
						type="button"
						onClick={props.onClearAllFilters}
						className="ml-auto rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-950"
					>
						{tc('clearAllFilters')}
					</button>
				)}
			</div>
		</section>
	);
}
