'use client';

import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';
import { FilterNavButton, FilterNavSection } from '../../components/filter-nav';
import { getModelVendorLabel } from '@/lib/model-vendor';
import { ALL_VENDORS_KEY, type ModelListKindFilter } from '../types';

type Props = {
	modelCount: number;
	hasActiveFilter: boolean;
	isAllVendors: boolean;
	selectedVendor: string;
	modelsByVendor: [string, unknown[]][];
	selectedKind: ModelListKindFilter;
	kindCounts: { llm: number; image: number; audio: number };
	onSelectVendor: (vendor: string) => void;
	onSelectKind: (kind: ModelListKindFilter) => void;
	onClearFilter: () => void;
};

function HorizontalSection(props: Omit<ComponentProps<typeof FilterNavSection>, 'orientation'>) {
	return <FilterNavSection orientation="horizontal" {...props} />;
}

function HorizontalButton(props: Omit<ComponentProps<typeof FilterNavButton>, 'orientation'>) {
	return <FilterNavButton orientation="horizontal" {...props} />;
}

export function ModelFilterSidebar(props: Props) {
	const {
		modelCount,
		hasActiveFilter,
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

	const vendorTotal = modelsByVendor.reduce((n, [, items]) => n + items.length, 0);

	return (
		<section className="mb-5 sm:mb-6" aria-label={t('title')}>
			<div className="flex flex-col items-stretch gap-y-2">
				<div className="flex min-w-0 items-center justify-between gap-3">
					<HorizontalSection title={t('kind')} ariaLabel={t('kindAria')}>
						<HorizontalButton
							label={tFilter('all')}
							count={modelCount}
							isActive={selectedKind === 'all'}
							onClick={() => onSelectKind('all')}
						/>
						<HorizontalButton
							label={t('kindLlm')}
							count={kindCounts.llm}
							isActive={selectedKind === 'llm'}
							onClick={() => onSelectKind('llm')}
						/>
						<HorizontalButton
							label={t('kindImage')}
							count={kindCounts.image}
							isActive={selectedKind === 'image'}
							onClick={() => onSelectKind('image')}
						/>
						<HorizontalButton
							label={t('kindAudio')}
							count={kindCounts.audio}
							isActive={selectedKind === 'audio'}
							onClick={() => onSelectKind('audio')}
						/>
					</HorizontalSection>
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

				<HorizontalSection title={tFilter('vendor')} ariaLabel={t('vendorAria')}>
					<HorizontalButton
						label={tFilter('all')}
						count={vendorTotal}
						isActive={isAllVendors}
						onClick={() => onSelectVendor(ALL_VENDORS_KEY)}
					/>
					{modelsByVendor.map(([vendorKey, items]) => (
						<HorizontalButton
							key={vendorKey}
							label={getModelVendorLabel(vendorKey)}
							count={items.length}
							isActive={selectedVendor === vendorKey}
							onClick={() => onSelectVendor(vendorKey)}
						/>
					))}
				</HorizontalSection>
			</div>
		</section>
	);
}
