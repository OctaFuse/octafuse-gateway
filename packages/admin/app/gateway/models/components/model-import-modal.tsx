'use client';

import { AdminContentMark } from '@/components/admin-content-mark';

import { useAdminDialog } from '@/components/use-admin-dialog';
import {
	ArrowPathIcon,
	MagnifyingGlassIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatPerMillionTokenUnit } from '@/lib/format-gateway-currency';
import {
	getModelVendorLabel,
	normalizeModelVendorInput,
} from '@/lib/model-vendor';
import { pickProviderCatalogText } from '@/lib/provider-kind';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sortImportCatalogRows } from '../model-utils';
import {
	isModelRetiringSoon,
	resolveModelLifecycle,
} from '@/lib/model-lifecycle';
import {
	type ModelKindFilter,
	type ModelLifecycleFilter,
	type PresetCatalogRow,
} from '../types';

type Props = {
	open: boolean;
	catalogRows: PresetCatalogRow[];
	filteredCatalogRows: PresetCatalogRow[];
	catalogSearch: string;
	catalogKind: ModelKindFilter;
	kindCounts: {
		llm: number;
		image: number;
		asr: number;
		tts: number;
		embedding: number;
	};
	catalogLifecycle: ModelLifecycleFilter;
	lifecycleCounts: { all: number; active: number; retired: number };
	catalogLoading: boolean;
	catalogError: string;
	selected: Record<string, boolean>;
	selectedCount: number;
	importableCount: number;
	submitting: boolean;
	billingCurrency: string;
	existingModelIds: Set<string>;
	onClose: () => void;
	onCatalogSearchChange: (value: string) => void;
	onCatalogKindChange: (kind: ModelKindFilter) => void;
	onCatalogLifecycleChange: (lifecycle: ModelLifecycleFilter) => void;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onReload: () => void;
	onTogglePreset: (id: string) => void;
	onImport: () => void;
};

function KindFilterChip(props: {
	label: string;
	count: number;
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	const { label, count, active, disabled, onClick } = props;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-pressed={active}
			className={
				active
					? 'rounded-md border border-gray-600 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-900 disabled:opacity-50'
					: 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50'
			}
		>
			{label}
			<span
				className={active ? 'ml-1.5 text-gray-800' : 'ml-1.5 text-gray-400'}
			>
				{count}
			</span>
		</button>
	);
}

function ToolbarTextAction(props: {
	label: string;
	disabled?: boolean;
	onClick: () => void;
}) {
	const { label, disabled, onClick } = props;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="font-medium text-gray-800 hover:text-gray-900 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
		>
			{label}
		</button>
	);
}

/**
 * 表格内 absolute 气泡会被 overflow 裁切；用 fixed + portal 挂到 body。
 */
function CatalogPricingPreview(props: { label: string; detail: string }) {
	const { label, detail } = props;
	const tooltipId = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const tipRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [coords, setCoords] = useState<{
		top: number;
		left: number;
		maxHeight: number;
	} | null>(null);

	const updatePosition = useCallback(() => {
		const el = triggerRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const margin = 8;
		const maxW = Math.min(28 * 16, window.innerWidth - 32);
		const spaceBelow = window.innerHeight - rect.bottom - margin;
		const spaceAbove = rect.top - margin;
		const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
		const maxHeight = Math.max(
			96,
			Math.min(360, placeAbove ? spaceAbove : spaceBelow)
		);
		const measured = tipRef.current?.offsetHeight;
		const tipH = measured && measured > 0 ? measured : Math.min(maxHeight, 220);
		const top = placeAbove
			? Math.max(margin, rect.top - tipH - margin)
			: Math.min(rect.bottom + margin, window.innerHeight - margin - 24);
		const left = Math.min(
			Math.max(margin, rect.right - maxW),
			window.innerWidth - maxW - margin
		);
		setCoords({ top, left, maxHeight });
	}, []);

	const show = useCallback(() => {
		setOpen(true);
		// 先估坐标让 portal 挂载，下一帧再用真实高度校正
		updatePosition();
	}, [updatePosition]);

	const hide = useCallback(() => {
		setOpen(false);
		setCoords(null);
	}, []);

	useLayoutEffect(() => {
		if (!open) return;
		updatePosition();
		const onScrollOrResize = () => updatePosition();
		window.addEventListener('scroll', onScrollOrResize, true);
		window.addEventListener('resize', onScrollOrResize);
		return () => {
			window.removeEventListener('scroll', onScrollOrResize, true);
			window.removeEventListener('resize', onScrollOrResize);
		};
	}, [open, detail, updatePosition]);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				className="inline-flex cursor-help items-center justify-end text-xs font-medium text-gray-800 underline decoration-dotted decoration-gray-400 underline-offset-2"
				aria-label={detail}
				aria-expanded={open}
				aria-describedby={open ? tooltipId : undefined}
				onClick={(event) => {
					event.stopPropagation();
					show();
				}}
				onKeyDownCapture={(event) => {
					if (['Enter', ' ', 'Escape'].includes(event.key))
						event.stopPropagation();
					if (event.key === 'Escape') {
						event.preventDefault();
						hide();
					}
				}}
				onMouseEnter={show}
				onMouseLeave={hide}
				onFocus={show}
				onBlur={hide}
			>
				{label}
			</button>
			{open && coords
				? createPortal(
						<div
							ref={tipRef}
							role="tooltip"
							id={tooltipId}
							className="pointer-events-none fixed z-[200] w-max max-w-[28rem] overflow-y-auto whitespace-pre-line rounded-md bg-gray-900 px-2.5 py-2 text-left text-xs leading-snug text-white shadow-lg"
							style={{
								top: coords.top,
								left: coords.left,
								maxHeight: coords.maxHeight,
							}}
						>
							{detail}
						</div>,
						document.body
				  )
				: null}
		</>
	);
}

export function ModelImportModal(props: Props) {
	const {
		open,
		catalogRows,
		filteredCatalogRows,
		catalogSearch,
		catalogKind,
		kindCounts,
		catalogLifecycle,
		lifecycleCounts,
		catalogLoading,
		catalogError,
		selected,
		selectedCount,
		submitting,
		billingCurrency,
		existingModelIds,
		onClose,
		onCatalogSearchChange,
		onCatalogKindChange,
		onCatalogLifecycleChange,
		onSelectAll,
		onClearSelection,
		onReload,
		onTogglePreset,
		onImport,
	} = props;

	const t = useTranslations('models.import');
	const tCommon = useTranslations('common');
	const tKind = useTranslations('models.filter');
	const locale = useLocale();
	const dialogRef = useAdminDialog(open, submitting, onClose);

	if (!open) return null;

	const hasSearch = catalogSearch.trim().length > 0;
	const sortedRows = sortImportCatalogRows(filteredCatalogRows);
	const canSelectAllVisible = filteredCatalogRows.some(
		(r) => !existingModelIds.has(r.id)
	);
	const canImport = catalogRows.some(
		(r) => selected[r.id] && !existingModelIds.has(r.id)
	);
	const unit = formatPerMillionTokenUnit(billingCurrency);
	/** 始终单 Kind：不展示 Kind 列；Image / Audio 视图隐藏 Context / Max Tokens。 */
	const showKindColumn = false;
	const showTokenColumns = catalogKind === 'llm';
	const kindScopedTotal = kindCounts[catalogKind];

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/40 p-3 sm:p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !submitting) {
					onClose();
				}
			}}
		>
			<div
				ref={dialogRef}
				tabIndex={-1}
				className="admin-content-dialog flex max-h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-panel outline-none"
				role="dialog"
				aria-modal="true"
				aria-labelledby="import-catalog-title"
			>
				<div className="admin-dialog-header flex shrink-0 items-center justify-between border-b px-6 py-4">
					<div>
						<h2
							id="import-catalog-title"
							className="admin-dialog-title text-lg font-medium text-gray-900"
						><AdminContentMark />
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">
							{t('subtitle', { currency: billingCurrency, unit })}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
						disabled={submitting}
						aria-label={tCommon('close')}
					>
						<XMarkIcon className="h-5 w-5" aria-hidden />
					</button>
				</div>

				<div className="flex shrink-0 flex-col gap-3 border-b border-gray-100 bg-white px-4 py-3 sm:px-6">
					<div className="flex items-center gap-2">
						<div className="relative min-w-0 flex-1">
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
						<button
							type="button"
							onClick={onReload}
							disabled={submitting || catalogLoading}
							className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
							aria-label={t('reloadCatalog')}
							title={t('reloadCatalog')}
						>
							<ArrowPathIcon
								className={`h-5 w-5 ${catalogLoading ? 'animate-spin' : ''}`}
								aria-hidden
							/>
						</button>
					</div>
					<div
						className="flex flex-wrap items-center gap-2"
						role="group"
						aria-label={t('kindFilterAria')}
					>
						<span className="text-xs font-medium normal-case tracking-normal text-gray-500">
							{t('kind')}
						</span>
						<KindFilterChip
							label={tKind('kindLlm')}
							count={kindCounts.llm}
							active={catalogKind === 'llm'}
							disabled={submitting || catalogLoading}
							onClick={() => onCatalogKindChange('llm')}
						/>
						<KindFilterChip
							label={tKind('kindImage')}
							count={kindCounts.image}
							active={catalogKind === 'image'}
							disabled={submitting || catalogLoading}
							onClick={() => onCatalogKindChange('image')}
						/>
						<KindFilterChip
							label={tKind('kindAsr')}
							count={kindCounts.asr}
							active={catalogKind === 'asr'}
							disabled={submitting || catalogLoading}
							onClick={() => onCatalogKindChange('asr')}
						/>
						<KindFilterChip
							label={tKind('kindTts')}
							count={kindCounts.tts}
							active={catalogKind === 'tts'}
							disabled={submitting || catalogLoading}
							onClick={() => onCatalogKindChange('tts')}
						/>
						<KindFilterChip
							label={tKind('kindEmbedding')}
							count={kindCounts.embedding}
							active={catalogKind === 'embedding'}
							disabled={submitting || catalogLoading}
							onClick={() => onCatalogKindChange('embedding')}
						/>
					</div>
					<div
						className="flex flex-wrap items-center gap-2"
						role="group"
						aria-label={t('lifecycleFilterAria')}
					>
						<span className="text-xs font-medium normal-case tracking-normal text-gray-500">
							{t('lifecycle')}
						</span>
						<KindFilterChip
							label={tKind('lifecycleActive')}
							count={lifecycleCounts.active}
							active={catalogLifecycle === 'active'}
							disabled={submitting || catalogLoading}
							onClick={() => onCatalogLifecycleChange('active')}
						/>
						<KindFilterChip
							label={tKind('lifecycleRetired')}
							count={lifecycleCounts.retired}
							active={catalogLifecycle === 'retired'}
							disabled={submitting || catalogLoading}
							onClick={() => onCatalogLifecycleChange('retired')}
						/>
						<KindFilterChip
							label={tCommon('all')}
							count={lifecycleCounts.all}
							active={catalogLifecycle === 'all'}
							disabled={submitting || catalogLoading}
							onClick={() => onCatalogLifecycleChange('all')}
						/>
					</div>
					<div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-gray-600">
						<span>
							{tCommon('selected', { count: selectedCount })}{' '}
							{t('selectedShowing', {
								filtered: filteredCatalogRows.length,
								total: kindScopedTotal,
							})}
						</span>
						{canSelectAllVisible || selectedCount > 0 ? (
							<span className="text-gray-300" aria-hidden>
								·
							</span>
						) : null}
						{canSelectAllVisible ? (
							<ToolbarTextAction
								label={tCommon('selectAll')}
								disabled={submitting || catalogLoading}
								onClick={onSelectAll}
							/>
						) : null}
						{canSelectAllVisible && selectedCount > 0 ? (
							<span className="text-gray-300" aria-hidden>
								·
							</span>
						) : null}
						{selectedCount > 0 ? (
							<ToolbarTextAction
								label={t('clearSelection')}
								disabled={submitting || catalogLoading}
								onClick={onClearSelection}
							/>
						) : null}
					</div>
				</div>

				<div className="admin-dialog-body min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
					{catalogLoading && (
						<div className="py-12 text-center text-gray-600">
							{t('loadingCatalog')}
						</div>
					)}
					{!catalogLoading && catalogError && (
						<div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
							{catalogError}
						</div>
					)}
					{!catalogLoading && !catalogError && catalogRows.length === 0 && (
						<div className="py-12 text-center text-gray-500">
							{t('catalogEmpty')}
						</div>
					)}
					{!catalogLoading &&
						!catalogError &&
						catalogRows.length > 0 &&
						filteredCatalogRows.length === 0 && (
							<div className="py-12 text-center text-gray-500">
								{t('noMatch')}
							</div>
						)}
					{!catalogLoading &&
						!catalogError &&
						filteredCatalogRows.length > 0 && (
							<div className="overflow-x-auto rounded-lg border border-gray-200">
								<table className="min-w-full divide-y divide-gray-200 text-sm">
									<thead className="bg-gray-50">
										<tr>
											<th className="w-10 px-3 py-2 text-left" scope="col">
												<span className="sr-only">{t('selectColumn')}</span>
											</th>
											<th className="px-3 py-2 text-left font-medium text-gray-600">
												{t('modelColumn')}
											</th>
											{showKindColumn ? (
												<th className="px-3 py-2 text-left font-medium text-gray-600">
													{t('kind')}
												</th>
											) : null}
											<th className="hidden px-3 py-2 text-left font-medium text-gray-600 lg:table-cell">
												{t('vendor')}
											</th>
											{showTokenColumns ? (
												<>
													<th className="hidden px-3 py-2 text-right font-medium text-gray-600 md:table-cell">
														{t('context')}
													</th>
													<th className="hidden px-3 py-2 text-right font-medium text-gray-600 md:table-cell">
														{t('maxTokens')}
													</th>
												</>
											) : null}
											<th className="px-3 py-2 text-right font-medium text-gray-600">
												{t('pricing')}
												{catalogKind === 'llm' && (
													<span className="mt-1 block text-xs font-normal text-gray-400">
														{t('priceOrder')}
													</span>
												)}
											</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-100 bg-white">
										{sortedRows.map((row) => {
											const alreadyInGateway = existingModelIds.has(row.id);
											const noPricing = !row.pricing_available;
											const kind = row.kind;
											const pricingLabel =
												row.pricing_label ??
												(kind === 'image'
													? t('pricingPerImageFallback')
													: kind === 'asr'
													? t('pricingPerSecondFallback')
													: t('catalogTiers', { count: row.tier_count }));
											const pricingDetail = row.pricing_preview ?? pricingLabel;
											const selectable =
												!submitting && !alreadyInGateway && !noPricing;
											const checked = selectable && !!selected[row.id];
											const intro = pickProviderCatalogText(
												{
													en: row.i18n?.en ?? row.description,
													zh: row.i18n?.zh,
													ja: row.i18n?.ja,
													ko: row.i18n?.ko,
												},
												locale
											);
											return (
												<tr
													key={row.id}
													role={selectable ? 'checkbox' : undefined}
													aria-checked={selectable ? checked : undefined}
													aria-disabled={selectable ? undefined : true}
													aria-label={
														alreadyInGateway
															? t('alreadyInGatewayRow', { id: row.id })
															: t('importPresetRow', { id: row.id })
													}
													tabIndex={selectable ? 0 : undefined}
													onClick={
														selectable
															? () => onTogglePreset(row.id)
															: undefined
													}
													onKeyDown={
														selectable
															? (event) => {
																	if (
																		event.key === 'Enter' ||
																		event.key === ' '
																	) {
																		event.preventDefault();
																		onTogglePreset(row.id);
																	}
															  }
															: undefined
													}
													className={
														!selectable
															? 'bg-gray-50 text-gray-400'
															: checked
															? 'cursor-pointer bg-gray-50 hover:bg-gray-50/80 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-gray-500'
															: 'cursor-pointer hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-gray-500'
													}
												>
													<td className="px-3 py-2 align-middle">
														<input
															type="checkbox"
															checked={checked}
															readOnly
															tabIndex={-1}
															disabled={!selectable}
															aria-hidden
															className="pointer-events-none h-4 w-4 rounded border-gray-300 text-gray-800 focus:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
														/>
													</td>
													<td
														className="min-w-40 max-w-80 break-words px-3 py-3 text-xs text-gray-900"
														title={intro || undefined}
													>
														<p className="text-sm font-medium">
															{row.display_name || row.id}
														</p>
														{row.display_name &&
															row.display_name !== row.id && (
																<p className="mt-1 break-all font-mono text-xs text-gray-500">
																	{row.id}
																</p>
															)}
														<p className="mt-1 text-xs text-gray-500 lg:hidden">
															{getModelVendorLabel(
																normalizeModelVendorInput(row.vendor)
															)}
														</p>
														{resolveModelLifecycle(row.retired) ===
														'retired' ? (
															<span className="mt-1 inline-flex rounded bg-gray-100 px-1.5 py-0.5 font-sans text-xs font-medium text-gray-600">
																{t('retiredBadge', { date: row.retired ?? '' })}
															</span>
														) : isModelRetiringSoon(row.retired) ? (
															<span className="mt-1 inline-flex rounded bg-amber-50 px-1.5 py-0.5 font-sans text-xs font-medium text-amber-700">
																{t('retiringBadge', {
																	date: row.retired ?? '',
																})}
															</span>
														) : null}
													</td>

													{showKindColumn ? (
														<td className="px-3 py-2">
															<span
																className={
																	kind === 'image'
																		? 'inline-flex rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700'
																		: kind === 'asr' || kind === 'tts'
																		? 'inline-flex rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700'
																		: kind === 'embedding'
																		? 'inline-flex rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700'
																		: 'inline-flex rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700'
																}
															>
																{kind === 'image'
																	? tKind('kindImage')
																	: kind === 'asr'
																	? tKind('kindAsr')
																	: kind === 'tts'
																	? tKind('kindTts')
																	: kind === 'embedding'
																	? tKind('kindEmbedding')
																	: tKind('kindLlm')}
															</span>
														</td>
													) : null}
													<td className="hidden px-3 py-2 text-gray-700 lg:table-cell">
														{getModelVendorLabel(
															normalizeModelVendorInput(row.vendor)
														)}
													</td>
													{showTokenColumns ? (
														<>
															<td className="hidden px-3 py-2 text-right tabular-nums text-gray-700 md:table-cell">
																{row.context_window != null
																	? formatCompactTokens(row.context_window)
																	: '—'}
															</td>
															<td className="hidden px-3 py-2 text-right tabular-nums text-gray-700 md:table-cell">
																{row.max_tokens != null
																	? formatCompactTokens(row.max_tokens)
																	: '—'}
															</td>
														</>
													) : null}
													<td className="px-3 py-2 text-right tabular-nums text-gray-700">
														{noPricing ? (
															<span className="text-xs text-amber-700">
																{t('noCatalogPrice', {
																	currency: billingCurrency,
																})}
															</span>
														) : (
															<CatalogPricingPreview
																label={pricingLabel}
																detail={pricingDetail}
															/>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
				</div>

				<div className="admin-dialog-footer flex shrink-0 flex-wrap items-center justify-end gap-3 border-t bg-gray-50 px-6 py-4">
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
						className="rounded-md admin-primary px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
					>
						{submitting
							? tCommon('importing')
							: t('importSelected', { count: selectedCount })}
					</button>
				</div>
			</div>
		</div>
	);
}
