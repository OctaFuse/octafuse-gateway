'use client';

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import {
	CatalogViewToggle,
	type CatalogView,
} from '../../components/catalog-view-toggle';
import { getModelVendorLabel } from '@/lib/model-vendor';
import {
	ALL_VENDORS_KEY,
	type ModelLifecycleFilter,
	type ModelListKindFilter,
} from '../types';

type Props = {
	view: CatalogView;
	onViewChange: (view: CatalogView) => void;
	search: string;
	onSearchChange: (value: string) => void;
	filteredCount: number;
	modelCount: number;
	hasActiveFilter: boolean;
	isAllVendors: boolean;
	selectedVendor: string;
	modelsByVendor: [string, unknown[]][];
	selectedKind: ModelListKindFilter;
	kindCounts: {
		llm: number;
		image: number;
		asr: number;
		tts: number;
		embedding: number;
	};
	kindAllCount: number;
	selectedLifecycle: ModelLifecycleFilter;
	lifecycleCounts: { active: number; retired: number };
	onSelectLifecycle: (lifecycle: ModelLifecycleFilter) => void;
	onSelectVendor: (vendor: string) => void;
	onSelectKind: (kind: ModelListKindFilter) => void;
	onClearFilter: () => void;
};

export function ModelFilterSidebar({
	view,
	onViewChange,
	search,
	onSearchChange,
	filteredCount,
	modelCount,
	hasActiveFilter,
	selectedVendor,
	modelsByVendor,
	selectedKind,
	kindCounts,
	kindAllCount,
	selectedLifecycle,
	onSelectLifecycle,
	onSelectVendor,
	onSelectKind,
	onClearFilter,
}: Props) {
	const t = useTranslations('models.filter');
	const f = useTranslations('filter');
	const c = useTranslations('common');
	const kinds = [
		{ key: 'all', label: f('all'), count: kindAllCount },
		...(['llm', 'image', 'asr', 'tts', 'embedding'] as const).map((key) => ({
			key,
			label: t(
				{
					llm: 'kindLlm',
					image: 'kindImage',
					asr: 'kindAsr',
					tts: 'kindTts',
					embedding: 'kindEmbedding',
				}[key]
			),
			count: kindCounts[key],
		})),
	];
	const selectClass =
		'h-10 min-w-0 max-w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100';
	return (
		<section aria-label={t('title')} className="mb-5 space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
						aria-hidden
					/>
					<input
						type="search"
						value={search}
						onChange={(event) => onSearchChange(event.target.value)}
						aria-label={t('searchPlaceholder')}
						placeholder={t('searchPlaceholder')}
						className={`${selectClass} w-full pl-9 pr-9`}
						autoComplete="off"
					/>
					{search && (
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
					aria-label={f('vendor')}
					value={selectedVendor}
					onChange={(event) => onSelectVendor(event.target.value)}
					className={`${selectClass} w-40 sm:w-44`}
				>
					<option value={ALL_VENDORS_KEY}>{t('allVendors')}</option>
					{modelsByVendor.map(([key, items]) => (
						<option key={key} value={key}>
							{getModelVendorLabel(key)} ({items.length})
						</option>
					))}
				</select>
				<select
					aria-label={t('lifecycle')}
					value={selectedLifecycle}
					onChange={(event) =>
						onSelectLifecycle(event.target.value as ModelLifecycleFilter)
					}
					className={selectClass}
				>
					<option value="all">{t('allLifecycles')}</option>
					<option value="active">{t('lifecycleActive')}</option>
					<option value="retired">{t('lifecycleRetired')}</option>
				</select>
				<span className="text-xs tabular-nums text-gray-500" aria-live="polite">
					{c('showing', { filtered: filteredCount, total: modelCount })}
				</span>
				<div className="ml-auto [&>div>span]:sr-only">
					<CatalogViewToggle value={view} onChange={onViewChange} />
				</div>
			</div>
			<div
				className="flex flex-wrap items-center gap-1 border-b border-gray-200 pb-3"
				role="group"
				aria-label={t('kind')}
			>
				{kinds.map((kind) => (
					<button
						type="button"
						key={kind.key}
						aria-pressed={selectedKind === kind.key}
						onClick={() => onSelectKind(kind.key as ModelListKindFilter)}
						className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
							selectedKind === kind.key
								? 'bg-gray-950 font-medium text-white'
								: 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
						}`}
					>
						{kind.label}
						<span
							className={`font-mono tabular-nums ${
								selectedKind === kind.key ? 'text-white/70' : 'text-gray-400'
							}`}
						>
							{kind.count}
						</span>
					</button>
				))}
				{hasActiveFilter && (
					<button
						type="button"
						onClick={onClearFilter}
						className="ml-auto rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-950"
					>
						{f('clear')}
					</button>
				)}
			</div>
		</section>
	);
}
