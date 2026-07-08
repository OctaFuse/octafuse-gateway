'use client';

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { ProviderImportCatalogRow } from '../types';

type ProviderImportModalProps = {
	open: boolean;
	catalogRows: ProviderImportCatalogRow[];
	filteredCatalogRows: ProviderImportCatalogRow[];
	catalogSearch: string;
	catalogLoading: boolean;
	catalogError: string;
	selected: Record<string, boolean>;
	selectedCount: number;
	submitting: boolean;
	onClose: () => void;
	onCatalogSearchChange: (value: string) => void;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onTogglePreset: (id: string) => void;
	onImport: () => void;
};

export function ProviderImportModal(props: ProviderImportModalProps) {
	const {
		open,
		catalogRows,
		filteredCatalogRows,
		catalogSearch,
		catalogLoading,
		catalogError,
		selected,
		selectedCount,
		submitting,
		onClose,
		onCatalogSearchChange,
		onSelectAll,
		onClearSelection,
		onTogglePreset,
		onImport,
	} = props;

	const t = useTranslations('providers.import');
	const tCommon = useTranslations('common');

	if (!open) return null;

	const hasSearch = catalogSearch.trim().length > 0;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !submitting) {
					onClose();
				}
			}}
		>
			<div
				className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="provider-import-title"
			>
				<div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
					<div>
						<h2 id="provider-import-title" className="text-xl font-bold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">{t('subtitle')}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={submitting}
						className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
						aria-label={tCommon('close')}
					>
						×
					</button>
				</div>

				<div className="flex shrink-0 flex-col gap-3 border-b bg-gray-50 px-6 py-3">
					<div className="relative min-w-0">
						<MagnifyingGlassIcon
							className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
							aria-hidden
						/>
						<input
							type="search"
							value={catalogSearch}
							onChange={(e) => onCatalogSearchChange(e.target.value)}
							className="w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
							placeholder={t('searchPlaceholder')}
							aria-label={t('searchPlaceholder')}
							autoComplete="off"
						/>
						{hasSearch && (
							<button
								type="button"
								onClick={() => onCatalogSearchChange('')}
								className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
								aria-label={t('clearSearch')}
							>
								<XMarkIcon className="h-4 w-4" aria-hidden />
							</button>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={onSelectAll}
							disabled={catalogLoading || filteredCatalogRows.length === 0}
							className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
						>
							{tCommon('selectAll')}
						</button>
						<button
							type="button"
							onClick={onClearSelection}
							disabled={catalogLoading || catalogRows.length === 0}
							className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
						>
							{t('clear')}
						</button>
						<span className="ml-auto text-sm text-gray-600">
							{tCommon('selected', { count: selectedCount })}
							{hasSearch ? (
								<>
									{' '}
									{t('selectedShowing', {
										filtered: filteredCatalogRows.length,
										total: catalogRows.length,
									})}
								</>
							) : (
								<>
									{' '}
									{t('selectedAvailable', { total: catalogRows.length })}
								</>
							)}
						</span>
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
					{catalogLoading && (
						<div className="py-12 text-center text-gray-600">{t('loadingCatalog')}</div>
					)}
					{!catalogLoading && catalogError && (
						<div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{catalogError}</div>
					)}
					{!catalogLoading && !catalogError && catalogRows.length === 0 && (
						<div className="py-12 text-center text-gray-500">{t('catalogEmpty')}</div>
					)}
					{!catalogLoading && !catalogError && catalogRows.length > 0 && filteredCatalogRows.length === 0 && (
						<div className="py-12 text-center text-gray-500">{t('noMatch')}</div>
					)}
					{!catalogLoading && !catalogError && filteredCatalogRows.length > 0 && (
						<ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
							{filteredCatalogRows.map((row) => {
								const checked = Boolean(selected[row.id]);
								return (
									<li key={row.id}>
										<div
											role="checkbox"
											aria-checked={checked}
											aria-label={t('selectRow', { name: row.name })}
											tabIndex={0}
											onClick={() => onTogglePreset(row.id)}
											onKeyDown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													e.preventDefault();
													onTogglePreset(row.id);
												}
											}}
											className={`flex cursor-pointer flex-wrap items-start gap-3 px-4 py-3 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
												checked ? 'bg-blue-50 hover:bg-blue-50/80' : ''
											}`}
										>
											<input
												type="checkbox"
												checked={checked}
												readOnly
												tabIndex={-1}
												className="pointer-events-none mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600"
												aria-hidden
											/>
											<div className="min-w-0 flex-1 select-none">
												<p className="text-sm font-semibold text-gray-900">{row.name}</p>
												<p className="text-xs text-gray-500">
													{row.vendor_label} · {t('protocols')}: {row.protocols.join(', ') || '—'}
												</p>
												{row.base_url_openai && (
													<p className="mt-1 break-all text-[11px] text-gray-400" title={row.base_url_openai}>
														{t('openaiBase', { url: row.base_url_openai })}
													</p>
												)}
												{row.description && <p className="mt-1 text-xs text-gray-600">{row.description}</p>}
											</div>
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
						onClick={onClose}
						disabled={submitting}
						className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-white disabled:opacity-50"
					>
						{tCommon('cancel')}
					</button>
					<button
						type="button"
						onClick={() => void onImport()}
						disabled={submitting || catalogLoading || selectedCount === 0}
						className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{submitting ? tCommon('importing') : t('importSelected', { count: selectedCount })}
					</button>
				</div>
			</div>
		</div>
	);
}
