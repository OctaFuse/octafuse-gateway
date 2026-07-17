'use client';

import { useTranslations } from 'next-intl';
import { FilterNavButton, FilterNavSection } from '../../components/filter-nav';
import { getModelVendorLabel } from '@/lib/model-vendor';
import { ALL_KINDS_KEY, ALL_VENDORS_KEY, type ModelKindFilter } from '../types';

type Props = {
	modelCount: number;
	hasActiveFilter: boolean;
	selectedVendorItemsCount: number;
	isAllVendors: boolean;
	selectedVendor: string;
	modelsByVendor: [string, unknown[]][];
	selectedKind: ModelKindFilter;
	kindCounts: { all: number; llm: number; image: number };
	onSelectVendor: (vendor: string) => void;
	onSelectKind: (kind: ModelKindFilter) => void;
	onClearFilter: () => void;
};

export function ModelFilterSidebar(props: Props) {
	const {
		modelCount,
		hasActiveFilter,
		selectedVendorItemsCount,
		isAllVendors,
		selectedVendor,
		modelsByVendor,
		selectedKind,
		kindCounts,
		onSelectVendor,
		onSelectKind,
		onClearFilter,
	} = props;

	const t = useTranslations('models.filter');
	const tFilter = useTranslations('filter');

	if (modelCount === 0) return null;

	return (
		<aside className="w-full shrink-0 border-b border-gray-200/80 bg-slate-50/80 lg:sticky lg:top-0 lg:w-60 lg:self-start lg:border-b-0 lg:border-r">
			<div className="space-y-3 p-4">
				<div>
					<h2 className="text-sm font-semibold text-gray-900">{t('title')}</h2>
					<p className="mt-0.5 text-xs text-gray-500">{t('browseHint')}</p>
				</div>

				<div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/60 bg-white/60 px-3 py-2">
					<span className="text-xs text-gray-600">
						{t('modelsCount', { count: modelCount })}
						{hasActiveFilter ? (
							<>
								{' '}
								{t('showing', { count: selectedVendorItemsCount })}
							</>
						) : null}
					</span>
					{hasActiveFilter ? (
						<button
							type="button"
							onClick={onClearFilter}
							className="shrink-0 rounded text-xs font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
						>
							{tFilter('clear')}
						</button>
					) : null}
				</div>

				<FilterNavSection title={t('kind')} ariaLabel={t('kindAria')}>
					<FilterNavButton
						label={tFilter('all')}
						count={kindCounts.all}
						isActive={selectedKind === ALL_KINDS_KEY}
						onClick={() => onSelectKind(ALL_KINDS_KEY)}
					/>
					<FilterNavButton
						label={t('kindLlm')}
						count={kindCounts.llm}
						isActive={selectedKind === 'llm'}
						onClick={() => onSelectKind('llm')}
					/>
					<FilterNavButton
						label={t('kindImage')}
						count={kindCounts.image}
						isActive={selectedKind === 'image'}
						onClick={() => onSelectKind('image')}
					/>
				</FilterNavSection>

				<FilterNavSection title={tFilter('vendor')} ariaLabel={t('vendorAria')}>
					<FilterNavButton
						label={tFilter('all')}
						count={modelsByVendor.reduce((n, [, items]) => n + items.length, 0)}
						isActive={isAllVendors}
						onClick={() => onSelectVendor(ALL_VENDORS_KEY)}
					/>
					{modelsByVendor.map(([vendorKey, items]) => (
						<FilterNavButton
							key={vendorKey}
							label={getModelVendorLabel(vendorKey)}
							count={items.length}
							isActive={selectedVendor === vendorKey}
							onClick={() => onSelectVendor(vendorKey)}
						/>
					))}
				</FilterNavSection>
			</div>
		</aside>
	);
}
