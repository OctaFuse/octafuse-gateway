'use client';

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { CatalogViewToggle, type CatalogView } from '../../components/catalog-view-toggle';
import {
	PROVIDER_LIST_FILTERS,
	type ProviderListFilter,
} from '../types';

type ProviderFilterCounts = Record<ProviderListFilter, number>;

type ProviderToolbarProps = {
	view: CatalogView;
	onViewChange: (view: CatalogView) => void;
	providerSearch: string;
	selectedFilter: ProviderListFilter;
	filterCounts: ProviderFilterCounts;
	filteredCount: number;
	totalCount: number;
	onSearchChange: (value: string) => void;
	onFilterChange: (filter: ProviderListFilter) => void;
};

const CHIP_DOT: Partial<Record<ProviderListFilter, string>> = {
	all: 'bg-slate-400',
	active: 'bg-emerald-500',
	disabled: 'bg-slate-400',
	pending: 'bg-amber-500',
	no_key: 'bg-red-500',
	outdated: 'bg-orange-500',
	openai: 'bg-sky-500',
	anthropic: 'bg-orange-500',
	gemini: 'bg-blue-500',
	dashscope: 'bg-violet-500',
	minimax: 'bg-rose-500',
	volcengine: 'bg-cyan-600',
	elevenlabs: 'bg-neutral-800',
};

const PROTOCOL_FILTERS: readonly ProviderListFilter[] = ['openai', 'anthropic', 'gemini', 'dashscope', 'minimax', 'volcengine', 'elevenlabs'];

export function ProviderToolbar(props: ProviderToolbarProps) {
	const {
		view,
		onViewChange,
		providerSearch,
		selectedFilter,
		filterCounts,
		filteredCount,
		totalCount,
		onSearchChange,
		onFilterChange,
	} = props;

	const t = useTranslations('providers');
	const tCommon = useTranslations('common');
	const tUpstream = useTranslations('upstream');

	// 「有更新」没有可处理项时不占位，避免常驻一个 0。
	const visibleFilters = PROVIDER_LIST_FILTERS.filter(
		(filter) => filter !== 'outdated' || filterCounts.outdated > 0 || selectedFilter === 'outdated'
	);

	const protocolFilters = visibleFilters.filter((filter) => PROTOCOL_FILTERS.includes(filter));
	const statusFilters = visibleFilters.filter((filter) => !PROTOCOL_FILTERS.includes(filter));

	const toOption = (filter: ProviderListFilter) => ({
		value: filter,
		label: filterLabel(filter),
		dotClass: CHIP_DOT[filter] ?? 'bg-slate-400',
		count: filterCounts[filter],
	});

	const filterLabel = (filter: ProviderListFilter): string => {
		if (
			filter === 'openai' ||
			filter === 'anthropic' ||
			filter === 'gemini' ||
			filter === 'dashscope' ||
			filter === 'minimax' ||
			filter === 'volcengine' ||
			filter === 'elevenlabs'
		) {
			return tUpstream(filter);
		}
		return t(`filters.${filter}`);
	};

	const renderFilters = (label: string, filters: ProviderListFilter[]) => (
		<div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3" role="group" aria-label={label}>
			<span className="py-2 text-xs leading-4 text-slate-500">{label}</span>
			<div className="flex min-w-0 flex-wrap gap-1.5">
				{filters.map(toOption).map((option) => (
					<button
						key={option.value}
						type="button"
						aria-pressed={selectedFilter === option.value}
						onClick={() => onFilterChange(option.value)}
						className={`inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-xs leading-4 ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selectedFilter === option.value ? 'bg-blue-50 font-medium text-blue-700 ring-blue-200' : 'text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900'}`}
					>
						<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${option.dotClass}`} aria-hidden />
						{option.label}
						<span className={`rounded px-1.5 text-[10px] tabular-nums ${selectedFilter === option.value ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{option.count}</span>
					</button>
				))}
			</div>
		</div>
	);

	return (
		<div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
			<div className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-3">
				<div className="relative w-full min-w-0 sm:w-80 xl:w-96">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
						aria-hidden
					/>
					<input
						type="search"
						value={providerSearch}
						onChange={(e) => onSearchChange(e.target.value)}
						className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-9 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
						placeholder={t('searchPlaceholder')}
						aria-label={t('searchPlaceholder')}
						autoComplete="off"
					/>
					{providerSearch.trim() && (
						<button
							type="button"
							onClick={() => onSearchChange('')}
							className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
							aria-label={t('clearSearch')}
						>
							<XMarkIcon className="h-4 w-4" aria-hidden />
						</button>
					)}
				</div>
				<span className="whitespace-nowrap text-xs tabular-nums text-slate-500">
					{tCommon('showing', { filtered: filteredCount, total: totalCount })}
				</span>
				<div className="ml-auto">
					<CatalogViewToggle value={view} onChange={onViewChange} />
				</div>
			</div>

			<select
				aria-label={t('filters.aria')}
				value={selectedFilter}
				onChange={(event) => onFilterChange(event.target.value as ProviderListFilter)}
				className="min-h-11 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm md:hidden"
			>
				{visibleFilters.map((filter) => (
					<option key={filter} value={filter}>{filterLabel(filter)} ({filterCounts[filter]})</option>
				))}
			</select>
			<div className="hidden space-y-2.5 md:block" role="toolbar" aria-label={t('filters.aria')}>
				{renderFilters(t('filters.groupStatus'), statusFilters)}
				{renderFilters(t('filters.groupProtocol'), protocolFilters)}
			</div>
		</div>
	);
}
