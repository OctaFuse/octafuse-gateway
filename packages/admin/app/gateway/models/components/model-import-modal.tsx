'use client';

import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatPerMillionTokenUnit } from '@/lib/format-gateway-currency';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import { useTranslations } from 'next-intl';
import { sortImportCatalogRows } from '../model-utils';
import type { PresetCatalogRow } from '../types';

type Props = {
	open: boolean;
	catalogRows: PresetCatalogRow[];
	catalogLoading: boolean;
	catalogError: string;
	selected: Record<string, boolean>;
	selectedCount: number;
	importableCount: number;
	submitting: boolean;
	billingCurrency: string;
	existingModelIds: Set<string>;
	onClose: () => void;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onReload: () => void;
	onTogglePreset: (id: string) => void;
	onImport: () => void;
};

export function ModelImportModal(props: Props) {
	const {
		open,
		catalogRows,
		catalogLoading,
		catalogError,
		selected,
		selectedCount,
		importableCount,
		submitting,
		billingCurrency,
		existingModelIds,
		onClose,
		onSelectAll,
		onClearSelection,
		onReload,
		onTogglePreset,
		onImport,
	} = props;

	const t = useTranslations('models.import');
	const tCommon = useTranslations('common');

	if (!open) return null;

	const sortedRows = sortImportCatalogRows(catalogRows);
	const canImport = catalogRows.some((r) => selected[r.id] && !existingModelIds.has(r.id));
	const unit = formatPerMillionTokenUnit(billingCurrency);

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !submitting) {
					onClose();
				}
			}}
		>
			<div
				className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="import-catalog-title"
			>
				<div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
					<div>
						<h2 id="import-catalog-title" className="text-xl font-bold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">
							{t('subtitle', { currency: billingCurrency, unit })}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
						disabled={submitting}
						aria-label={tCommon('close')}
					>
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
					<button
						type="button"
						onClick={onReload}
						disabled={catalogLoading}
						className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
					>
						{tCommon('reload')}
					</button>
					<span className="ml-auto text-sm text-gray-600">
						{t('selectedAvailable', { selected: selectedCount, importable: importableCount })}
						{catalogRows.length > importableCount ? (
							<span className="text-gray-400">
								{' '}
								{t('alreadyInGateway', { count: catalogRows.length - importableCount })}
							</span>
						) : null}
					</span>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
					{catalogLoading && <div className="py-12 text-center text-gray-600">{t('loadingCatalog')}</div>}
					{!catalogLoading && catalogError && (
						<div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
							{catalogError}
						</div>
					)}
					{!catalogLoading && !catalogError && catalogRows.length === 0 && (
						<div className="py-12 text-center text-gray-500">{t('catalogEmpty')}</div>
					)}
					{!catalogLoading && !catalogError && catalogRows.length > 0 && (
						<div className="overflow-x-auto rounded-lg border border-gray-200">
							<table className="min-w-full divide-y divide-gray-200 text-sm">
								<thead className="bg-gray-50">
									<tr>
										<th className="w-10 px-3 py-2 text-left" scope="col">
											<span className="sr-only">{t('selectColumn')}</span>
										</th>
										<th className="px-3 py-2 text-left font-medium text-gray-600">{t('modelId')}</th>
										<th className="px-3 py-2 text-left font-medium text-gray-600">{t('displayName')}</th>
										<th className="px-3 py-2 text-left font-medium text-gray-600">{t('vendor')}</th>
										<th className="px-3 py-2 text-right font-medium text-gray-600">{t('context')}</th>
										<th className="px-3 py-2 text-right font-medium text-gray-600">{t('maxTokens')}</th>
										<th className="px-3 py-2 text-right font-medium text-gray-600">{t('pricing')}</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100 bg-white">
									{sortedRows.map((row) => {
										const alreadyInGateway = existingModelIds.has(row.id);
										return (
											<tr
												key={row.id}
												className={
													alreadyInGateway ? 'bg-gray-50 text-gray-400' : 'hover:bg-gray-50'
												}
											>
												<td className="px-3 py-2 align-middle">
													<input
														type="checkbox"
														checked={alreadyInGateway ? false : !!selected[row.id]}
														disabled={alreadyInGateway}
														onChange={() => onTogglePreset(row.id)}
														className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
														aria-label={
															alreadyInGateway
																? t('alreadyInGatewayRow', { id: row.id })
																: t('importPresetRow', { id: row.id })
														}
													/>
												</td>
												<td className="px-3 py-2 font-mono text-xs text-gray-900">{row.id}</td>
												<td className="px-3 py-2 text-gray-900">{row.display_name || '—'}</td>
												<td className="px-3 py-2 text-gray-700">
													{getModelVendorLabel(normalizeModelVendorInput(row.vendor))}
												</td>
												<td className="px-3 py-2 text-right tabular-nums text-gray-700">
													{row.context_window != null
														? formatCompactTokens(row.context_window)
														: '—'}
												</td>
												<td className="px-3 py-2 text-right tabular-nums text-gray-700">
													{row.max_tokens != null ? formatCompactTokens(row.max_tokens) : '—'}
												</td>
												<td className="px-3 py-2 text-right tabular-nums text-gray-700">
													<span className="group relative inline-flex items-center justify-end">
														<span
															className="inline-flex cursor-help items-center justify-end"
															aria-label={
																row.pricing_preview_usd ??
																t('usdTiers', { count: row.tier_count_usd })
															}
														>
															💰
														</span>
														<span className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-max max-w-[32rem] whitespace-pre-line rounded-md bg-gray-900 px-2 py-1 text-left text-xs leading-snug text-white shadow-lg group-hover:block">
															{row.pricing_preview_usd ?? t('usdTiers', { count: row.tier_count_usd })}
														</span>
													</span>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
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
						onClick={onImport}
						disabled={submitting || catalogLoading || !canImport}
						className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{submitting ? tCommon('importing') : t('importSelected', { count: selectedCount })}
					</button>
				</div>
			</div>
		</div>
	);
}
