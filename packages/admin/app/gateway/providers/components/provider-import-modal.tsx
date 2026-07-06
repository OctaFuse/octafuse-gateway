import type { ProviderImportCatalogRow } from '../types';

type ProviderImportModalProps = {
	open: boolean;
	catalogRows: ProviderImportCatalogRow[];
	catalogLoading: boolean;
	catalogError: string;
	selected: Record<string, boolean>;
	selectedCount: number;
	submitting: boolean;
	onClose: () => void;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onTogglePreset: (id: string) => void;
	onImport: () => void;
};

export function ProviderImportModal(props: ProviderImportModalProps) {
	const {
		open,
		catalogRows,
		catalogLoading,
		catalogError,
		selected,
		selectedCount,
		submitting,
		onClose,
		onSelectAll,
		onClearSelection,
		onTogglePreset,
		onImport,
	} = props;

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div
				className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="provider-import-title"
			>
				<div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
					<div>
						<h2 id="provider-import-title" className="text-xl font-bold text-gray-900">
							Import from templates
						</h2>
						<p className="mt-1 text-xs text-gray-500">
							Prefills OpenAI-compatible base URLs (CN-first catalog). Each import creates a new provider row.
						</p>
					</div>
					<button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
						×
					</button>
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-gray-50 px-6 py-3">
					<button
						type="button"
						onClick={onSelectAll}
						disabled={catalogLoading || catalogRows.length === 0}
						className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
					>
						Select all
					</button>
					<button
						type="button"
						onClick={onClearSelection}
						disabled={catalogLoading || catalogRows.length === 0}
						className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
					>
						Clear
					</button>
					<span className="ml-auto text-sm text-gray-600">
						Selected <span className="font-semibold tabular-nums">{selectedCount}</span> /{' '}
						<span className="tabular-nums">{catalogRows.length}</span> available
					</span>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
					{catalogLoading && <div className="py-12 text-center text-gray-600">Loading catalog…</div>}
					{!catalogLoading && catalogError && (
						<div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{catalogError}</div>
					)}
					{!catalogLoading && !catalogError && catalogRows.length === 0 && (
						<div className="py-12 text-center text-gray-500">Catalog is empty</div>
					)}
					{!catalogLoading && !catalogError && catalogRows.length > 0 && (
						<ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
							{catalogRows.map((row) => {
								const checked = Boolean(selected[row.id]);
								return (
									<li key={row.id} className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-gray-50">
										<input
											type="checkbox"
											className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
											checked={checked}
											onChange={() => onTogglePreset(row.id)}
											aria-label={`Select ${row.name}`}
										/>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-semibold text-gray-900">{row.name}</p>
											<p className="text-xs text-gray-500">
												{row.vendor_label} · protocols: {row.protocols.join(', ') || '—'}
											</p>
											{row.base_url_openai && (
												<p className="mt-1 break-all text-[11px] text-gray-400" title={row.base_url_openai}>
													OpenAI base: {row.base_url_openai}
												</p>
											)}
											{row.description && <p className="mt-1 text-xs text-gray-600">{row.description}</p>}
										</div>
									</li>
								);
							})}
						</ul>
					)}
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t bg-gray-50 px-6 py-4">
					<button
						type="button"
						onClick={() => void onImport()}
						disabled={submitting || catalogLoading || selectedCount === 0}
						className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{submitting ? 'Importing…' : `Import selected (${selectedCount})`}
					</button>
				</div>
			</div>
		</div>
	);
}
