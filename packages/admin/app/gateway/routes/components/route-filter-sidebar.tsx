'use client';

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { GroupedFilterPicker, groupedFilterCatalog, groupedFilterLabeler, type GroupedFilterGroup } from '@/components/grouped-filter-picker';
import { groupedSelectionNodes, isEmptyGroupedSelection, toggleGroupedGroup, toggleGroupedItem, type GroupedSelection } from '@/lib/grouped-selection';
import type { RouteKindFilter } from '../types';

type Props = {
	searchQuery: string;
	onSearchChange: (query: string) => void;
	filterStatus: string;
	filterKind: RouteKindFilter;
	filterRouteGroup: string;
	filterModels: GroupedSelection;
	filterProviders: GroupedSelection;
	modelGroups: GroupedFilterGroup[];
	providerGroups: GroupedFilterGroup[];
	statusCounts: { all: number; active: number; inactive: number };
	kindCounts: { all: number; llm: number; image: number; asr: number; tts: number; embedding: number };
	routeGroupFilterOptions: string[];
	routeGroupCounts: Map<string, number>;
	onFilterStatusChange: (status: string) => void;
	onFilterKindChange: (kind: RouteKindFilter) => void;
	onFilterRouteGroupChange: (group: string) => void;
	onModelsChange: (selection: GroupedSelection) => void;
	onProvidersChange: (selection: GroupedSelection) => void;
	onClearAllFilters: () => void;
};

export function RouteFilterSidebar(props: Props) {
	const searchId = useId();
	const t = useTranslations('filter');
	const tw = useTranslations('routes.workspace');
	const tc = useTranslations('common');
	const tl = useTranslations('requestLogs');
	const staleLabel = (value: string) => tl('ui.notInCatalog', { value });
	const pickers = [
		{
			key: 'model', label: tc('model'), emptyLabel: tl('ui.allModels'), messages: 'modelFilter',
			groups: props.modelGroups, value: props.filterModels, onChange: props.onModelsChange,
		},
		{
			key: 'provider', label: tc('provider'), emptyLabel: tl('providerFilter.all'), messages: 'providerFilter',
			groups: props.providerGroups, value: props.filterProviders, onChange: props.onProvidersChange,
		},
	];
	const chips = pickers.flatMap(picker => {
		const catalog = groupedFilterCatalog(picker.groups);
		const labelOf = groupedFilterLabeler(picker.groups, staleLabel);
		const nodes = groupedSelectionNodes(picker.value, catalog);
		return (nodes.length > 1 ? nodes : []).map(node => ({
			key: `${picker.key}:${node.type}:${node.id}`,
			label: picker.label,
			display: labelOf(node),
			clear: () => picker.onChange(node.type === 'group'
				? toggleGroupedGroup(picker.value, node.id, false, catalog)
				: toggleGroupedItem(picker.value, node.id, false, catalog)),
		}));
	});
	const kindOptions = [
		{ value: 'all', label: t('all'), count: props.kindCounts.all },
		{ value: 'llm', label: t('kindLlm'), count: props.kindCounts.llm },
		{ value: 'image', label: t('kindImage'), count: props.kindCounts.image },
		{ value: 'asr', label: t('kindAsr'), count: props.kindCounts.asr },
		{ value: 'tts', label: t('kindTts'), count: props.kindCounts.tts },
		{ value: 'embedding', label: t('kindEmbedding'), count: props.kindCounts.embedding },
	];
	const hasActiveFilters = Boolean(props.searchQuery || props.filterStatus || props.filterKind !== 'all' || props.filterRouteGroup || !isEmptyGroupedSelection(props.filterModels) || !isEmptyGroupedSelection(props.filterProviders));
	const selectClass = 'h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100';
	return (
		<section className="route-filters mb-5 space-y-4" aria-label={t('title')}>
			<div className="flex flex-wrap items-end gap-3">
				<div className="min-w-0 flex-1 basis-64 space-y-2 text-xs text-gray-500 sm:max-w-sm">
					<label htmlFor={searchId} className="block">{tw('searchLabel')}</label>
					<div className="relative">
						<MagnifyingGlassIcon
							className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
							aria-hidden
						/>
						<input
							id={searchId}
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
				</div>
				<label className="block shrink-0 space-y-2 text-xs text-gray-500">
					<span className="block">{t('status')}</span>
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
				</label>
				{pickers.map(picker => (
					<GroupedFilterPicker
						key={picker.key}
						className="w-52 max-w-full shrink-0"
						label={picker.label}
						emptyLabel={picker.emptyLabel}
						clearLabel={tl(`${picker.messages}.clear`)}
						hint={tl(`${picker.messages}.hint`)}
						search={{ placeholder: tl(`${picker.messages}.search`), empty: tl(`${picker.messages}.empty`) }}
						groups={picker.groups}
						value={picker.value}
						onChange={picker.onChange}
						staleLabel={staleLabel}
					/>
				))}
				<label className="block w-36 max-w-full space-y-2 text-xs text-gray-500">
					<span className="block">{t('routeGroup')}</span>
					<select aria-label={t('routeGroup')} value={props.filterRouteGroup} onChange={event => props.onFilterRouteGroupChange(event.target.value)} className={selectClass}>
						<option value="">{tw('allRouteGroups')}</option>
						{props.routeGroupFilterOptions.map(value => <option key={value} value={value}>{value} ({props.routeGroupCounts.get(value) ?? 0})</option>)}
					</select>
				</label>
			</div>
			{chips.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{chips.map(chip => (
						<button
							key={chip.key}
							type="button"
							onClick={chip.clear}
							aria-label={tl('ui.removeFilter', { name: `${chip.label}: ${chip.display}` })}
							title={`${chip.label}: ${chip.display}`}
							className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500"
						>
							<span className="max-w-64 truncate">{chip.label}: {chip.display}</span>
							<XMarkIcon className="h-3 w-3 shrink-0" aria-hidden />
						</button>
					))}
				</div>
			)}

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
