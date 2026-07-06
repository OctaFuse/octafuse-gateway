'use client';

import { FilterNavButton, FilterNavSection } from '../../components/filter-nav';
import { getModelVendorLabel } from '@/lib/model-vendor';
import { ALL_VENDORS_KEY } from '../types';

type Props = {
	modelCount: number;
	hasVendorFilter: boolean;
	selectedVendorItemsCount: number;
	isAllVendors: boolean;
	selectedVendor: string;
	modelsByVendor: [string, unknown[]][];
	onSelectVendor: (vendor: string) => void;
	onClearFilter: () => void;
};

export function ModelFilterSidebar(props: Props) {
	const {
		modelCount,
		hasVendorFilter,
		selectedVendorItemsCount,
		isAllVendors,
		selectedVendor,
		modelsByVendor,
		onSelectVendor,
		onClearFilter,
	} = props;

	if (modelCount === 0) return null;

	return (
		<aside className="w-full shrink-0 border-b border-gray-200/80 bg-slate-50/80 lg:sticky lg:top-0 lg:w-60 lg:self-start lg:border-b-0 lg:border-r">
			<div className="space-y-3 p-4">
				<div>
					<h2 className="text-sm font-semibold text-gray-900">Filters</h2>
					<p className="mt-0.5 text-xs text-gray-500">Browse by vendor</p>
				</div>

				<div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/60 bg-white/60 px-3 py-2">
					<span className="text-xs text-gray-600">
						<span className="font-semibold tabular-nums text-gray-900">{modelCount}</span> models
						{hasVendorFilter ? (
							<>
								{' '}
								· showing{' '}
								<span className="font-semibold tabular-nums text-gray-900">
									{selectedVendorItemsCount}
								</span>
							</>
						) : null}
					</span>
					{hasVendorFilter ? (
						<button
							type="button"
							onClick={onClearFilter}
							className="shrink-0 rounded text-xs font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
						>
							Clear
						</button>
					) : null}
				</div>

				<FilterNavSection title="Vendor" ariaLabel="Vendor filter">
					<FilterNavButton
						label="All"
						count={modelCount}
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
