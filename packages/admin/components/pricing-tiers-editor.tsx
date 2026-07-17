'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import type { PricingTierDraftRow } from '@/lib/pricing-tiers-draft';
import { getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import {
	createEmptyTierRow,
	DRAFT_UPTO_OPEN_SENTINEL,
	ensureLastRowOpenUptoDraft,
	formatPricingProfilePreview,
} from '@/lib/pricing-tiers-draft';

export type PricingTiersEditorProps = {
	rows: PricingTierDraftRow[];
	onChange: (rows: PricingTierDraftRow[]) => void;
	/** 至少保留行数；低于则禁用删除（默认 0，可删光） */
	minRows?: number;
	/** Optional title on the same row as Add / Preview (e.g. Models form). */
	title?: string;
	/** Left side of the Add / Preview row, left-aligned (e.g. billing / provider factor on routes form). */
	toolbarStart?: ReactNode;
	/** ISO 4217，与网关 `BILLING_CURRENCY` 一致 */
	billingCurrencyCode?: string;
	/**
	 * `image`：展示 Image token 单价列（text / cached text / image in / cached image in / image out）。
	 * `llm`（默认）：chat 常用 input/output/cache 列。
	 */
	variant?: 'llm' | 'image';
};

function updateRow(
	rows: PricingTierDraftRow[],
	id: string,
	patch: Partial<Omit<PricingTierDraftRow, 'id'>>
): PricingTierDraftRow[] {
	return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** 原仅末档（开放上界）时拆档，给上一档一个可编辑的默认上界 */
const DEFAULT_PROMOTED_FINITE_UPTO = '1000000';

const linkActionClass =
	'text-sm font-medium text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline bg-transparent p-0 border-0 cursor-pointer';

function PriceCell(props: {
	value: string;
	placeholder: string;
	ariaLabel: string;
	onChange: (value: string) => void;
}) {
	return (
		<td className="px-1 py-1.5">
			<input
				type="text"
				inputMode="decimal"
				value={props.value}
				onChange={(e) => props.onChange(e.target.value)}
				className="w-full min-w-[4rem] rounded border border-gray-200 px-1.5 py-1 font-mono text-[11px] tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
				placeholder={props.placeholder}
				aria-label={props.ariaLabel}
			/>
		</td>
	);
}

export function PricingTiersEditor({
	rows,
	onChange,
	minRows = 0,
	title,
	toolbarStart,
	billingCurrencyCode = 'USD',
	variant = 'llm',
}: PricingTiersEditorProps) {
	const t = useTranslations('pricing.tiersEditor');
	const tImage = useTranslations('pricing.readOnlyImage');
	const tPricing = useTranslations('pricing');
	const tCommon = useTranslations('common');
	const billCode = billingCurrencyCode.trim().toUpperCase();
	const billSym = getGatewayCurrencySymbol(billCode);
	const perMPlaceholder = `${billSym}/M`;
	const unitFooter =
		variant === 'image' ? t('footerImage', { currency: billSym }) : t('footer', { currency: billSym });
	const [jsonPreviewOpen, setJsonPreviewOpen] = useState(false);
	const canRemove = rows.length > minRows;
	const jsonPreview = formatPricingProfilePreview(rows);
	const hasToolbarLeft = Boolean(toolbarStart) || Boolean(title);
	const isImage = variant === 'image';
	const colSpan = isImage ? 7 : 6;
	/** Image 列名与 Route 只读区共用 `pricing.readOnlyImage`，避免两套文案分叉 */
	const imageColHeaders = isImage
		? ([
				tImage('textInput'),
				tImage('cachedText'),
				tImage('imageInput'),
				tImage('cachedImageInput'),
				tImage('imageOutput'),
			] as const)
		: null;

	const addTier = () => {
		const base = rows.length > 0 ? rows[rows.length - 1]! : createEmptyTierRow();
		const promoted =
			rows.length > 0
				? rows.map((r, i) =>
						i === rows.length - 1 && r.upto.trim() === ''
							? { ...r, upto: DEFAULT_PROMOTED_FINITE_UPTO }
							: r
					)
				: [];
		const newLast = {
			...createEmptyTierRow(),
			upto: DRAFT_UPTO_OPEN_SENTINEL,
			input_price: base.input_price,
			output_price: base.output_price,
			cache_read_price: base.cache_read_price,
			cache_write_price: base.cache_write_price,
			image_input_price: base.image_input_price,
			image_input_cache_price: base.image_input_cache_price,
			image_output_price: base.image_output_price,
		};
		onChange(rows.length > 0 ? [...promoted, newLast] : [newLast]);
	};

	const removeTier = (id: string) => {
		if (!canRemove) {
			return;
		}
		const next = rows.filter((r) => r.id !== id);
		onChange(ensureLastRowOpenUptoDraft(next));
	};

	return (
		<div className="space-y-3">
			<div
				className={`mb-1 flex min-h-[1.25rem] flex-wrap items-center gap-x-3 gap-y-2 ${hasToolbarLeft ? 'justify-between' : 'justify-end'}`}
			>
				{hasToolbarLeft ? (
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-left">
						{toolbarStart}
						{title ? <span className="text-sm font-medium text-gray-700">{title}</span> : null}
					</div>
				) : null}
				<div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
					<button type="button" onClick={addTier} className={linkActionClass}>
						{t('add')}
					</button>
					<button
						type="button"
						onClick={() => setJsonPreviewOpen((v) => !v)}
						aria-expanded={jsonPreviewOpen}
						className={linkActionClass}
					>
						{jsonPreviewOpen ? tCommon('hide') : t('preview')}
					</button>
				</div>
			</div>
			{isImage ? (
				<p className="text-[11px] text-gray-500 leading-relaxed">{t('imageHint')}</p>
			) : null}
			<div className="overflow-hidden rounded-md border border-gray-200 bg-white">
				<div className="overflow-x-auto">
					<table className="min-w-full divide-y divide-gray-200 text-left text-xs">
						<thead
							className={
								isImage
									? 'bg-gray-50 text-[11px] font-medium text-gray-500'
									: 'bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-500'
							}
						>
							<tr>
								<th className="whitespace-nowrap px-2 py-2">{t('upto')}</th>
								{imageColHeaders ? (
									imageColHeaders.map((label) => (
										<th key={label} className="whitespace-nowrap px-2 py-2">
											{label}
										</th>
									))
								) : (
									<>
										<th className="whitespace-nowrap px-2 py-2">{t('input')}</th>
										<th className="whitespace-nowrap px-2 py-2">{t('output')}</th>
										<th className="whitespace-nowrap px-2 py-2">{t('cacheRead')}</th>
										<th className="whitespace-nowrap px-2 py-2">{t('cacheWrite')}</th>
									</>
								)}
								<th className="w-10 px-1 py-2 text-center"> </th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100">
							{rows.length === 0 ? (
								<tr>
									<td colSpan={colSpan} className="px-3 py-4 text-center text-gray-500">
										{t('noTiers')}
									</td>
								</tr>
							) : (
								rows.map((r, rowIndex) => {
									const isLast = rowIndex === rows.length - 1;
									return (
										<tr key={r.id} className="align-top">
											<td className="px-1 py-1.5">
												{isLast ? (
													<div
														className="flex min-h-[1.75rem] min-w-[4.5rem] items-center rounded border border-dashed border-gray-200 bg-gray-50 px-1.5 font-mono text-[11px] text-gray-600 tabular-nums"
														title={t('lastTierOpenEnded')}
														aria-label={`upto open bound for tier ${r.id}`}
													>
														{tCommon('infinity')}
													</div>
												) : (
													<input
														type="text"
														inputMode="numeric"
														value={r.upto}
														onChange={(e) =>
															onChange(updateRow(rows, r.id, { upto: e.target.value }))
														}
														className="w-full min-w-[4.5rem] rounded border border-gray-200 px-1.5 py-1 font-mono text-[11px] tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
														placeholder="0"
														aria-label={`upto for tier ${r.id}`}
													/>
												)}
											</td>
											{isImage ? (
												<>
													<PriceCell
														value={r.input_price}
														placeholder={perMPlaceholder}
														ariaLabel={`text input price ${r.id}`}
														onChange={(v) =>
															onChange(updateRow(rows, r.id, { input_price: v }))
														}
													/>
													<PriceCell
														value={r.cache_read_price}
														placeholder={tPricing('emptyCachePlaceholder')}
														ariaLabel={`cached text price ${r.id}`}
														onChange={(v) =>
															onChange(updateRow(rows, r.id, { cache_read_price: v }))
														}
													/>
													<PriceCell
														value={r.image_input_price}
														placeholder={perMPlaceholder}
														ariaLabel={`image input price ${r.id}`}
														onChange={(v) =>
															onChange(updateRow(rows, r.id, { image_input_price: v }))
														}
													/>
													<PriceCell
														value={r.image_input_cache_price}
														placeholder={tPricing('emptyCachePlaceholder')}
														ariaLabel={`cached image input price ${r.id}`}
														onChange={(v) =>
															onChange(
																updateRow(rows, r.id, { image_input_cache_price: v })
															)
														}
													/>
													<PriceCell
														value={r.image_output_price}
														placeholder={perMPlaceholder}
														ariaLabel={`image output price ${r.id}`}
														onChange={(v) =>
															onChange(updateRow(rows, r.id, { image_output_price: v }))
														}
													/>
												</>
											) : (
												<>
													<PriceCell
														value={r.input_price}
														placeholder={perMPlaceholder}
														ariaLabel={`input price ${r.id}`}
														onChange={(v) =>
															onChange(updateRow(rows, r.id, { input_price: v }))
														}
													/>
													<PriceCell
														value={r.output_price}
														placeholder={perMPlaceholder}
														ariaLabel={`output price ${r.id}`}
														onChange={(v) =>
															onChange(updateRow(rows, r.id, { output_price: v }))
														}
													/>
													<PriceCell
														value={r.cache_read_price}
														placeholder={tPricing('emptyCachePlaceholder')}
														ariaLabel={`cache read ${r.id}`}
														onChange={(v) =>
															onChange(updateRow(rows, r.id, { cache_read_price: v }))
														}
													/>
													<PriceCell
														value={r.cache_write_price}
														placeholder={tPricing('emptyCachePlaceholder')}
														ariaLabel={`cache write ${r.id}`}
														onChange={(v) =>
															onChange(updateRow(rows, r.id, { cache_write_price: v }))
														}
													/>
												</>
											)}
											<td className="px-0 py-1.5 text-center">
												<button
													type="button"
													disabled={!canRemove}
													onClick={() => removeTier(r.id)}
													className="rounded px-1 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
													title={t('removeTier')}
												>
													×
												</button>
											</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
				<p className="border-t border-gray-100 bg-gray-50/90 px-2 py-1.5 text-[11px] leading-snug text-gray-500">
					{unitFooter}
				</p>
			</div>
			{jsonPreviewOpen ? (
				<div className="space-y-1.5">
					<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
						<label className="text-xs font-medium text-gray-600">
							<code className="rounded bg-gray-100 px-1">{tPricing('jsonPreviewLabel')}</code>
						</label>
						<button
							type="button"
							onClick={() => {
								if (navigator.clipboard?.writeText) {
									void navigator.clipboard.writeText(jsonPreview).catch(() => {});
								}
							}}
							className={linkActionClass}
						>
							{tCommon('copy')}
						</button>
					</div>
					<textarea
						readOnly
						rows={Math.min(14, 4 + rows.length * 3)}
						value={jsonPreview}
						className="w-full resize-y rounded-md border border-dashed border-gray-300 bg-gray-50/90 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-gray-800"
						spellCheck={false}
						aria-label="pricing_profile JSON preview"
					/>
				</div>
			) : null}
		</div>
	);
}
