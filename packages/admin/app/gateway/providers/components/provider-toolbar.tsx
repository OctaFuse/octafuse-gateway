'use client';

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
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
	openai: 'bg-sky-500',
	anthropic: 'bg-orange-500',
	gemini: 'bg-blue-500',
	dashscope: 'bg-violet-500',
};

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

	const filterLabel = (filter: ProviderListFilter): string => {
		if (filter === 'openai' || filter === 'anthropic' || filter === 'gemini' || filter === 'dashscope') {
			return tUpstream(filter);
		}
		return t(`filters.${filter}`);
	};

	return (
		<div className="mb-5 space-y-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div className="relative min-w-0 flex-1">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
						aria-hidden
					/>
					<input
						type="search"
						value={providerSearch}
						onChange={(e) => onSearchChange(e.target.value)}
						className="w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

			<div
				className="flex flex-wrap gap-1.5"
				role="toolbar"
				aria-label={t('filters.aria')}
			>
				{PROVIDER_LIST_FILTERS.map((filter) => {
					const count = filterCounts[filter];
					const selected = selectedFilter === filter;
					const searchMatched = filterCounts.all;
					return (
						<button
							key={filter}
							type="button"
							onClick={() => onFilterChange(filter)}
							aria-pressed={selected}
							className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
								selected
									? 'bg-blue-50 text-blue-800 ring-blue-200'
									: 'bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100'
							}`}
						>
							<span
								className={`h-1.5 w-1.5 rounded-full ${CHIP_DOT[filter] ?? 'bg-slate-400'}`}
								aria-hidden
							/>
							<span>{filterLabel(filter)}</span>
							<span className="tabular-nums text-[10px] opacity-70">
								{filter === 'all'
									? `${searchMatched}/${totalCount}`
									: `${count}/${searchMatched}`}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
