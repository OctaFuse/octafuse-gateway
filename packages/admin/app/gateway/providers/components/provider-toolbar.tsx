'use client';

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { FilterRow, FilterSegmented } from '../../components/filter-controls';
import {
	PROVIDER_LIST_FILTERS,
	type ProviderListFilter,
} from '../types';

type ProviderFilterCounts = Record<ProviderListFilter, number>;

type ProviderToolbarProps = {
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
		count: filter === 'all' ? `${filterCounts.all}/${totalCount}` : `${filterCounts[filter]}/${filterCounts.all}`,
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

	return (
		<div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div className="relative min-w-0 flex-1 md:max-w-xl">
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
				<div className="text-sm text-gray-500">
					{tCommon('showing', { filtered: filteredCount, total: totalCount })}
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
			<div className="hidden md:block" role="toolbar" aria-label={t('filters.aria')}>
				<FilterRow>
					<FilterSegmented
						label={t('filters.groupStatus')}
						value={statusFilters.includes(selectedFilter) ? selectedFilter : ''}
						onChange={(value) => onFilterChange(value as ProviderListFilter)}
						options={statusFilters.map(toOption)}
					/>
					<FilterSegmented
						label={t('filters.groupProtocol')}
						value={protocolFilters.includes(selectedFilter) ? selectedFilter : ''}
						onChange={(value) => onFilterChange(value as ProviderListFilter)}
						options={protocolFilters.map(toOption)}
					/>
				</FilterRow>
			</div>
		</div>
	);
}
