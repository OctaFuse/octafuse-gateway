import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';

type ProviderToolbarProps = {
	providerSearch: string;
	filteredCount: number;
	totalCount: number;
	isExpandingProviderKeys: boolean;
	onSearchChange: (value: string) => void;
	onExpandVisibleKeys: () => void;
	onCollapseVisibleKeys: () => void;
};

export function ProviderToolbar(props: ProviderToolbarProps) {
	const {
		providerSearch,
		filteredCount,
		totalCount,
		isExpandingProviderKeys,
		onSearchChange,
		onExpandVisibleKeys,
		onCollapseVisibleKeys,
	} = props;

	return (
		<div className="mb-5 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
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
						placeholder="Search provider name"
						aria-label="Search provider name"
						autoComplete="off"
					/>
					{providerSearch.trim() && (
						<button
							type="button"
							onClick={() => onSearchChange('')}
							className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
							aria-label="Clear provider search"
						>
							<XMarkIcon className="h-4 w-4" aria-hidden />
						</button>
					)}
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={() => void onExpandVisibleKeys()}
						disabled={filteredCount === 0 || isExpandingProviderKeys}
						className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isExpandingProviderKeys ? 'Loading keys…' : 'Expand keys'}
					</button>
					<button
						type="button"
						onClick={onCollapseVisibleKeys}
						disabled={filteredCount === 0 || isExpandingProviderKeys}
						className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Collapse keys
					</button>
					<div className="text-sm text-gray-500">
						Showing <span className="font-semibold tabular-nums text-gray-900">{filteredCount}</span> /{' '}
						<span className="tabular-nums">{totalCount}</span>
					</div>
				</div>
			</div>
		</div>
	);
}
