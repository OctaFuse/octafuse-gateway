'use client';

import { ArrowDownTrayIcon, PlusIcon } from '@heroicons/react/24/outline';

type Props = {
	activeVendorTitle: string;
	selectedCount: number;
	hasModels: boolean;
	importSubmitting: boolean;
	onImport: () => void;
	onCreate: () => void;
	createTitle: string;
};

export function ModelCatalogToolbar(props: Props) {
	const {
		activeVendorTitle,
		selectedCount,
		hasModels,
		importSubmitting,
		onImport,
		onCreate,
		createTitle,
	} = props;

	return (
		<div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/80 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6">
			<div className="min-w-0">
				<h2 className="text-base font-semibold text-gray-900">Model Catalog</h2>
				{hasModels ? (
					<p className="mt-0.5 truncate text-xs text-gray-500" title={activeVendorTitle}>
						{activeVendorTitle} · {selectedCount} model
						{selectedCount !== 1 ? 's' : ''}
					</p>
				) : (
					<p className="mt-0.5 text-xs text-gray-500">No models yet</p>
				)}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={onImport}
					disabled={importSubmitting}
					className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
				>
					<ArrowDownTrayIcon className="h-5 w-5" />
					Import
				</button>
				<button
					type="button"
					onClick={onCreate}
					className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
					title={createTitle}
				>
					<PlusIcon className="h-5 w-5" />
					New
				</button>
			</div>
		</div>
	);
}
