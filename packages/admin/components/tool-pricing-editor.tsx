'use client';
import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { resolveToolFactorPrices } from '@octafuse/core/lib/tool-pricing';
import { formatGatewayMoneyCompact, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import form from './settings-form.module.css';
import { toolPricingFromDraft, type ToolPricingDraft } from '@/lib/tool-pricing-draft';

/** One editor for service defaults and whole-rule tool overrides. */
export function ToolPricingEditor({
	value,
	currency,
	unitLabel = 'request',
	compact = false,
	layout = 'columns',
	onChange,
}: {
	value: ToolPricingDraft;
	currency: string;
	unitLabel?: string;
	compact?: boolean;
	layout?: 'columns' | 'rows';
	onChange: (value: ToolPricingDraft) => void;
}) {
	const t = useTranslations('toolPricing');
	const inputId = useId();
	const rows = layout === 'rows';
	const displayUnit = compact && unitLabel === 'request' ? t('requestUnit') : unitLabel;
	const [paidSelected, setPaidSelected] = useState(() => value.chargedFactor !== '0');
	const lastFactor = useRef(Number(value.chargedFactor) > 0 ? value.chargedFactor : '1');
	const free = !paidSelected && Number(value.chargedFactor) === 0;
	const parsed = toolPricingFromDraft(value);
	const prices = parsed.ok ? resolveToolFactorPrices(parsed.pricing) : null;
	function choose(paid: boolean) {
		if (Number(value.chargedFactor) > 0) lastFactor.current = value.chargedFactor;
		setPaidSelected(paid);
		onChange({ ...value, chargedFactor: paid ? lastFactor.current : '0' });
	}
	return (
		<div className={`${rows ? form.form : ''} ${rows ? 'space-y-4' : compact ? 'space-y-3' : 'space-y-4'}`}>
			<div className={rows ? form.field : compact ? 'flex flex-wrap items-center gap-x-3 gap-y-2' : undefined}>
				{rows ? <span className={form.label}>{t('simpleTitle')}</span> : null}
				<div className={rows ? `${form.control} flex flex-wrap items-center gap-x-3 gap-y-2` : 'contents'}>
					<div
						className={compact ? 'inline-flex gap-1 rounded-lg bg-gray-100 p-1' : 'grid gap-3 sm:grid-cols-2'}
						role="group"
						aria-label={t('simpleTitle')}
					>
						{(['free', 'perCall'] as const).map((option) => (
							<button
								key={option}
								type="button"
								aria-pressed={free === (option === 'free')}
								onClick={() => choose(option === 'perCall')}
								className={`${
									compact ? 'rounded-md px-4 py-1.5' : 'rounded-xl border p-4 text-left'
								} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${
									free === (option === 'free')
										? compact
											? 'bg-white shadow-sm'
											: 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
										: compact
										? 'text-gray-500 hover:bg-gray-200'
										: 'border-gray-200 bg-white hover:border-gray-400'
								}`}
							>
								<span className="block text-sm font-medium text-gray-900">
									{t(option === 'free' ? 'freeMode' : unitLabel === 'request' ? 'perCallMode' : 'perUnitMode')}
								</span>
								{!compact ? (
									<span className="mt-1 block text-xs leading-5 text-gray-500">
										{t(option === 'free' ? 'freeHint' : 'perCallHint')}
									</span>
								) : null}
							</button>
						))}
					</div>
					{compact && free ? <p className="text-xs leading-5 text-gray-500">{t('freeHint')}</p> : null}
				</div>
			</div>
			{value.legacyNeedsReview ? (
				<p role="status" className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
					{t('legacyNeedsReview')}
				</p>
			) : null}
			<div className={rows ? 'space-y-4' : 'grid gap-4 sm:grid-cols-3'}>
				{(['standard', 'chargedFactor', 'meteredFactor'] as const).map((key) => {
					const resultKind = key === 'chargedFactor' ? 'charged' : key === 'meteredFactor' ? 'metered' : null;
					return (
						<div key={key} className={rows ? form.field : undefined}>
							<label
								htmlFor={`${inputId}-${key}`}
								className={rows ? form.label : 'block text-sm font-medium text-gray-700'}
							>
								<span className="inline-flex items-center gap-1">
									{rows && key === 'standard'
										? t('standardLabel')
										: t(key, { currency: getGatewayCurrencySymbol(currency), unit: displayUnit })}
									{compact ? (
										<span tabIndex={0} title={t(`${key}Hint`)} role="img" aria-label={t(`${key}Hint`)}>
											<InformationCircleIcon className="h-3.5 w-3.5 text-gray-400" />
										</span>
									) : null}
								</span>
							</label>
							<div className={rows ? `${form.control} grid grid-cols-2 items-center gap-4` : undefined}>
								<div className={rows ? 'relative min-w-0' : 'contents'}>
									{rows ? (
										<span
											aria-hidden="true"
											className={`pointer-events-none absolute left-1 top-1 flex h-8 w-8 items-center justify-center rounded-md font-mono font-medium ${
												key === 'standard' || (free && key === 'chargedFactor')
													? 'bg-gray-100 text-gray-600'
													: 'bg-blue-50 text-blue-700'
											} ${key === 'standard' ? 'text-sm' : 'text-lg'}`}
										>
											{key === 'standard' ? getGatewayCurrencySymbol(currency) : '×'}
										</span>
									) : null}
									<input
										id={`${inputId}-${key}`}
										type="number"
										min={0}
										step="any"
										required
										data-pricing-field={key}
										aria-describedby={rows && key === 'standard' ? `${inputId}-unit` : undefined}
										readOnly={free && key === 'chargedFactor'}
										value={value[key]}
										onChange={(event) => onChange({ ...value, [key]: event.target.value })}
										aria-invalid={
											!value.legacyNeedsReview &&
											(!value[key].trim() || !Number.isFinite(Number(value[key])) || Number(value[key]) < 0)
										}
										className={`${rows ? 'h-10' : 'mt-2 ' + (compact ? 'py-2' : 'py-2.5')} ${
											rows ? '' : 'shadow-sm'
										} w-full min-w-0 rounded-lg border border-gray-300 bg-white ${
											rows
												? `pl-12 pr-3 text-base font-medium ${key === 'standard' ? 'text-gray-900' : 'text-blue-700'}`
												: 'px-3 text-sm'
										} font-mono tabular-nums focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100 read-only:bg-gray-100 read-only:text-gray-500`}
									/>
								</div>
								{rows && key === 'standard' ? (
									<span
										id={`${inputId}-unit`}
										className="flex min-h-10 min-w-0 items-center border-l border-gray-200 pl-4 text-xs text-gray-500"
									>
										{currency} / {displayUnit}
									</span>
								) : null}
								{rows && resultKind ? (
									<div
										role="status"
										aria-live="polite"
										className="min-w-0 border-l border-gray-200 pl-4"
										title={t(`${resultKind}Formula`)}
									>
										<p className="text-xs text-gray-500">{t(`${resultKind}Result`)}</p>
										<p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-1">
											<span className="break-words font-mono text-base font-medium leading-5 tabular-nums text-gray-900">
												{prices ? formatGatewayMoneyCompact(prices[resultKind], currency) : '—'}
											</span>
											<span className="text-xs text-gray-500">/ {displayUnit}</span>
										</p>
									</div>
								) : null}
							</div>
							{!compact ? (
								<span className="mt-1.5 block text-xs font-normal leading-5 text-gray-500">{t(`${key}Hint`)}</span>
							) : null}
						</div>
					);
				})}
			</div>
			{compact && !parsed.ok && !value.legacyNeedsReview ? (
				<div className={rows ? form.field : undefined}>
					<p role="status" className={`${rows ? form.note : ''} text-xs text-red-600`}>
						{t('invalidNumber')}
					</p>
				</div>
			) : null}
			{!rows ? (
				<div
					className={compact ? 'rounded-lg bg-gray-50 px-3 py-2.5' : 'rounded-xl border border-gray-200 bg-gray-50 p-4'}
					role="status"
					aria-live="polite"
				>
					<dl className="grid gap-4 sm:grid-cols-2">
						{(['charged', 'metered'] as const).map((key) => (
							<div key={key}>
								<dt className="text-xs text-gray-500" title={compact ? t(`${key}Formula`) : undefined}>
									{t(`${key}Result`)}
								</dt>
								<dd className="mt-1 font-mono text-base font-medium text-gray-900">
									{prices ? `${formatGatewayMoneyCompact(prices[key], currency)} / ${displayUnit}` : '—'}
								</dd>
								{!compact ? <p className="mt-1 text-xs text-gray-500">{t(`${key}Formula`)}</p> : null}
							</div>
						))}
					</dl>
				</div>
			) : null}
		</div>
	);
}
