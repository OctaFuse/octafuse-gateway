'use client';

import { ArrowDownTrayIcon, ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useProviderDialog } from '../use-provider-dialog';
import { VendorIcon } from '@/components/model-vendor-icon';
import { providerImportCatalogCopy } from '@/lib/provider-import-preset';
import { useLocale, useTranslations } from 'next-intl';
import { protocolSummariesFromEndpoints } from '../provider-utils';
import type { ProviderImportCatalogRow } from '../types';
import { ProviderCatalogOutboundLink } from './provider-catalog-outbound-link';
import { ProviderProtocolBadges } from './provider-protocol-badges';

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
	const locale = useLocale();
	const dialogRef = useProviderDialog(open, submitting, onClose);

	if (!open) return null;

	const hasSearch = catalogSearch.trim().length > 0;

	return (
		<div
			className="providers-design-workspace fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !submitting) {
					onClose();
				}
			}}
		>
			<div
				ref={dialogRef}
        tabIndex={-1}
        className="provider-dialog flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-panel outline-none"
				role="dialog"
				aria-modal="true"
				aria-labelledby="provider-import-title"
			>
				<div className="provider-dialog-heading flex shrink-0 items-center justify-between border-b px-6 py-4">
					<div>
						<h2 id="provider-import-title" className="flex items-center gap-3 text-lg font-medium text-gray-900">
							<span className="provider-dialog-symbol" aria-hidden><ArrowDownTrayIcon className="h-5 w-5" /></span>
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">{t('subtitle')}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={submitting}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
						aria-label={tCommon('close')}
					>
						<XMarkIcon className="h-5 w-5" aria-hidden />
					</button>
				</div>

				<div className="flex shrink-0 flex-col gap-3 border-b border-gray-100 bg-white px-5 py-3 sm:px-6">
					<div className="relative min-w-0">
						<MagnifyingGlassIcon
							className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
							aria-hidden
						/>
						<input
							type="search"
							value={catalogSearch}
							onChange={(e) => onCatalogSearchChange(e.target.value)}
							className="w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500"
							placeholder={t('searchPlaceholder')}
							aria-label={t('searchPlaceholder')}
							autoComplete="off"
						/>
						{hasSearch && (
							<button
								type="button"
								onClick={() => onCatalogSearchChange('')}
								className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
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
							disabled={submitting || catalogLoading || filteredCatalogRows.length === 0}
							className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
						>
							{tCommon('selectAll')}
						</button>
						<button
							type="button"
							onClick={onClearSelection}
							disabled={submitting || catalogLoading || catalogRows.length === 0}
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

				<div className="provider-import-body min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
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
						<ul className="provider-import-list space-y-2">
							{filteredCatalogRows.map((row) => {
								const checked = Boolean(selected[row.id]);
								const copy = providerImportCatalogCopy(row, locale);
								return (
									<li key={row.id}>
										<div
											role="checkbox"
											aria-checked={checked}
											aria-label={t('selectRow', { name: copy.name })}
											tabIndex={submitting ? -1 : 0}
											onClick={() => { if (!submitting) onTogglePreset(row.id); }}
											onKeyDown={(e) => {
												if (!submitting && (e.key === 'Enter' || e.key === ' ')) {
													e.preventDefault();
													onTogglePreset(row.id);
												}
											}}
											className={`flex cursor-pointer flex-wrap items-start gap-3 px-4 py-3 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-gray-500 ${
												checked ? 'bg-gray-50 hover:bg-gray-50/80' : ''
											}`}
										>
											<input
												type="checkbox"
												checked={checked}
												readOnly
												tabIndex={-1}
												className="pointer-events-none mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-gray-800"
												aria-hidden
											/>
											<VendorIcon
												vendor={row.vendor_key}
												iconKey={row.icon_key}
												size="compact"
												className="mt-0.5"
											/>
											<div className="min-w-0 flex-1 select-none">
												<div className="flex items-start justify-between gap-2">
													<p className="text-sm font-medium text-gray-900">{copy.name}</p>
													<ProviderCatalogOutboundLink
														links={row.links}
														stopPropagation
														className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gray-800 hover:text-gray-900"
													/>
												</div>
												<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
													<span className="text-xs text-gray-500">{row.vendor_label}</span>
													<ProviderProtocolBadges
														summaries={protocolSummariesFromEndpoints(row.endpoints, row.id)}
													/>
												</div>
												{copy.description && <details className="group mt-2 text-xs leading-5 text-gray-500" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                          <summary aria-label={t('templateDetails')} className="flex cursor-pointer list-none items-start gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"><span className="min-w-0 flex-1 line-clamp-2 group-open:hidden">{copy.description}</span><span className="hidden flex-1 group-open:inline">{t('templateDetails')}</span><ChevronDownIcon className="mt-1 h-3 w-3 shrink-0 transition-transform group-open:rotate-180" aria-hidden /></summary>
                          <p className="mt-2">{copy.description}</p>
                        </details>}
											</div>
										</div>
									</li>
								);
							})}
						</ul>
					)}
				</div>

				<div className="provider-dialog-footer flex shrink-0 flex-wrap items-center justify-end gap-3 border-t bg-gray-50 px-6 py-4">
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
						className="rounded-md admin-primary px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
					>
						{submitting ? tCommon('importing') : t('importSelected', { count: selectedCount })}
					</button>
				</div>
			</div>
		</div>
	);
}
