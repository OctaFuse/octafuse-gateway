'use client';

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import {
	CatalogViewToggle,
	type CatalogView,
} from '../../components/catalog-view-toggle';
import {
	PROVIDER_LIST_FILTERS,
	PROVIDER_PROTOCOL_FILTERS,
	type ProviderListFilter,
} from '../types';

type ProviderToolbarProps = {
	view: CatalogView;
	onViewChange: (view: CatalogView) => void;
	providerSearch: string;
	selectedFilter: ProviderListFilter;
	selectedProtocol: ProviderListFilter;
	filterCounts: Record<ProviderListFilter, number>;
	filteredCount: number;
	totalCount: number;
	onSearchChange: (value: string) => void;
	onFilterChange: (filter: ProviderListFilter) => void;
	onProtocolChange: (filter: ProviderListFilter) => void;
};

export function ProviderToolbar({
	view,
	onViewChange,
	providerSearch,
	selectedFilter,
	selectedProtocol,
	filterCounts,
	filteredCount,
	totalCount,
	onSearchChange,
	onFilterChange,
	onProtocolChange,
}: ProviderToolbarProps) {
	const t = useTranslations('providers');
	const c = useTranslations('common');
	const upstream = useTranslations('upstream');
	const statuses = PROVIDER_LIST_FILTERS.filter(
		(filter) =>
			!PROVIDER_PROTOCOL_FILTERS.includes(filter) &&
			(filter !== 'outdated' ||
				filterCounts.outdated > 0 ||
				selectedFilter === 'outdated')
	);
	return (
		<div className="mb-5 space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative min-w-0 flex-1 basis-60 sm:max-w-sm">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
						aria-hidden
					/>
					<input
						type="search"
						value={providerSearch}
						onChange={(event) => onSearchChange(event.target.value)}
						className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
						placeholder={t('searchPlaceholder')}
						aria-label={t('searchPlaceholder')}
						autoComplete="off"
					/>
					{providerSearch.trim() && (
						<button
							type="button"
							onClick={() => onSearchChange('')}
							aria-label={t('clearSearch')}
							className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
						>
							<XMarkIcon className="h-4 w-4" aria-hidden />
						</button>
					)}
				</div>
				<select
					aria-label={t('filters.groupProtocol')}
					value={selectedProtocol}
					onChange={(event) =>
						onProtocolChange(event.target.value as ProviderListFilter)
					}
					className="h-10 min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
				>
					<option value="all">{t('allProtocols')}</option>
					{PROVIDER_PROTOCOL_FILTERS.map((protocol) => (
						<option key={protocol} value={protocol}>
							{upstream(protocol)}
						</option>
					))}
				</select>
				<span className="text-xs tabular-nums text-gray-500" aria-live="polite">
					{c('showing', { filtered: filteredCount, total: totalCount })}
				</span>
				<div className="ml-auto [&>div>span]:sr-only">
					<CatalogViewToggle value={view} onChange={onViewChange} />
				</div>
			</div>
			<div
				className="flex flex-wrap gap-1 border-b border-gray-200 pb-3"
				role="group"
				aria-label={t('filters.groupStatus')}
			>
				{statuses.map((status) => (
					<button
						key={status}
						type="button"
						aria-pressed={selectedFilter === status}
						onClick={() => onFilterChange(status)}
						className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
							selectedFilter === status
								? 'bg-gray-950 font-medium text-white'
								: 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
						}`}
					>
						{status !== 'all' && (
							<span
								aria-hidden
								className={`h-1.5 w-1.5 shrink-0 rounded-full ${
									status === 'active'
										? 'bg-emerald-500'
										: status === 'pending' || status === 'outdated'
										? 'bg-amber-500'
										: status === 'no_key'
										? 'bg-rose-500'
										: 'bg-gray-400'
								}`}
							/>
						)}
						{t(`filters.${status}`)}
						<span
							className={`font-mono tabular-nums ${
								selectedFilter === status ? 'text-white/70' : 'text-gray-400'
							}`}
						>
							{filterCounts[status]}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}
