'use client';

import { useState, type ReactNode } from 'react';
import { CalendarDaysIcon, ChevronDownIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useNow, useTranslations } from 'next-intl';
import {
	ISO_WEEKDAYS,
	isEveryIsoWeekday,
	type ProviderFactorValidity,
} from '@octafuse/core/db/pricing-schedule';
import {
	instantToZonedDatetimeLocalInput,
	zonedDatetimeLocalInputToInstant,
} from '@/lib/business-timezone-client';
import { independentProviderWindows, previewRouteBillingFactors } from '../route-utils';
import type { RouteFormData, RouteScheduleFormWindow } from '../types';
import {
	editorInputClass,
	editorLabelClass,
	RouteEditorSection,
	RouteMultiplierInput,
} from './route-editor-ui';

const columns =
	'grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-[minmax(110px,1.05fr)_repeat(3,minmax(0,1fr))]';

export function RouteBillingFactors({
	formData,
	windows,
	locked,
	timezone,
	onChange,
	renderPrices,
}: {
	formData: RouteFormData;
	windows: RouteScheduleFormWindow[];
	locked: boolean;
	timezone: string;
	onChange: (form: RouteFormData) => void;
	renderPrices?: (index: number) => ReactNode;
}) {
	const t = useTranslations('routes.modal');
	const common = useTranslations('common');
	const now = useNow({ updateInterval: 1000 });
	const [openValidity, setOpenValidity] = useState<number | null>(null);
	const [openPeriod, setOpenPeriod] = useState<number | null>(null);
	const rows = independentProviderWindows(formData, windows);
	const weekdays = [
		t('weekdayMon'),
		t('weekdayTue'),
		t('weekdayWed'),
		t('weekdayThu'),
		t('weekdayFri'),
		t('weekdaySat'),
		t('weekdaySun'),
	];
	const labels = [t('providerFactor'), t('chargedCost'), t('meteredCost')];
	const update = (patch: Partial<RouteFormData>) =>
		onChange({ ...formData, schedule_windows: rows, ...patch });
	const updateRow = (index: number, patch: Partial<RouteScheduleFormWindow>) =>
		update({
			schedule_windows: rows.map((w, i) => (i === index ? { ...w, ...patch } : w)),
		});
	const daySummary = (days: number[]) =>
		isEveryIsoWeekday(days)
			? t('scheduleEveryday')
			: days.join(',') === '1,2,3,4,5'
			? t('scheduleWeekdays')
			: days.join(',') === '6,7'
			? t('scheduleWeekend')
			: days.map((d) => weekdays[d - 1]).join(' ');
	const baseValidity: ProviderFactorValidity = {
		starts_at: formData.provider_factor_starts_at || undefined,
		expires_at: formData.provider_factor_expires_at || undefined,
	};
	const entries = [null, ...rows];

	return (
		<RouteEditorSection
			title={t('editor.billingFactors')}
			description={t('editor.billingFactorsHint')}
			action={
				locked ? undefined : (
					<button
						type="button"
						className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
						onClick={() => {
							update({
								schedule_windows: [
									...rows,
									{
										start: '00:00',
										end: '08:00',
										days: [],
										charged_factor: formData.charged_factor,
										metered_factor: formData.metered_factor,
										provider_factor: formData.provider_factor,
										provider_validity: { ...baseValidity },
									},
								],
							});
							setOpenPeriod(rows.length);
							setOpenValidity(null);
						}}
					>
						<PlusIcon className="h-3.5 w-3.5" aria-hidden />
						{t('addScheduleWindow')}
					</button>
				)
			}
		>
			<div
				className={`${columns} hidden border-b border-slate-200 pb-3 text-xs font-medium text-slate-500 sm:grid`}
				aria-hidden
			>
				<span>{t('editor.period')}</span>
				{labels.map((label) => (
					<span key={label}>{label}</span>
				))}
			</div>
			<div className="divide-y divide-slate-200">
				{entries.map((row, position) => {
					const index = position - 1;
					const title = row
						? `${row.start}–${row.end}`
						: t(windows.length ? 'editor.otherPeriods' : 'editor.allPeriods');
					const validity = row?.provider_validity ?? baseValidity;
					const configured = Boolean(validity.starts_at || validity.expires_at);
					const setValidity = (value: ProviderFactorValidity) =>
						row
							? updateRow(index, { provider_validity: value })
							: update({
									provider_factor_starts_at: value.starts_at ?? '',
									provider_factor_expires_at: value.expires_at ?? '',
							  });
					const factors = row ?? formData;
					const effective = previewRouteBillingFactors(
						{ ...factors, provider_factor: factors.provider_factor ?? formData.provider_factor },
						validity,
						now,
						Boolean(row)
					);
					const validityOpen = openValidity === index;
					return (
						<fieldset key={position} className="min-w-0 py-4 last:pb-1">
							<legend className="sr-only">{title}</legend>
							<div className={columns}>
								<div className="col-span-3 min-w-0 pt-2 sm:col-span-1">
									{row && !locked ? (
										<button
											type="button"
											onClick={() => {
												setOpenPeriod(openPeriod === index ? null : index);
												setOpenValidity(null);
											}}
											aria-expanded={openPeriod === index}
											aria-controls={`route-period-${index}`}
											className="inline-flex items-center gap-1 text-left font-mono text-xs font-medium text-blue-600 hover:text-blue-800"
										>
											{title}
											<ChevronDownIcon className="h-3 w-3 shrink-0" aria-hidden />
										</button>
									) : (
										<div
											className={
												row
													? 'font-mono text-xs font-medium text-slate-800'
													: 'text-sm font-medium text-slate-800'
											}
										>
											{title}
										</div>
									)}
									<p className="mt-1 text-xs leading-5 text-slate-500">
										{row
											? daySummary(row.days)
											: t(windows.length ? 'editor.otherPeriodsHint' : 'editor.allPeriodsHint')}
									</p>
								</div>
								{(['provider_factor', 'charged_factor', 'metered_factor'] as const).map((key, i) => (
									<div key={key} className="min-w-0">
										<label
											className="mb-2 block text-xs text-slate-500 sm:hidden"
											htmlFor={`route-${position}-${key}`}
										>
											{labels[i]}
										</label>
										<RouteMultiplierInput
											id={`route-${position}-${key}`}
											label={`${title} · ${labels[i]}`}
											value={factors[key] ?? formData.provider_factor}
											onChange={(value) =>
												row ? updateRow(index, { [key]: value }) : update({ [key]: value })
											}
										/>
										{key === 'provider_factor' ? (
											<button
												type="button"
												onClick={() => {
													setOpenValidity(validityOpen ? null : index);
													setOpenPeriod(null);
												}}
												aria-expanded={validityOpen}
												aria-controls={`route-validity-${position}`}
												className={`mt-2 inline-flex max-w-full items-center gap-1 text-left text-[11px] leading-4 hover:text-blue-700 ${
													configured || validityOpen ? 'text-blue-600' : 'text-slate-500'
												}`}
											>
												<CalendarDaysIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
												{configured ? t('editor.configuredValidity') : t('editor.unlimited')}
												<ChevronDownIcon
													className={`h-3 w-3 shrink-0 ${validityOpen ? 'rotate-180' : ''}`}
													aria-hidden
												/>
											</button>
										) : (
											<p
												className="mt-2 text-[11px] leading-4 text-slate-500"
												title={t('editor.effectiveFactorHint')}
											>
												{t('editor.effectiveFactor')}{' '}
												<span className="font-mono font-medium tabular-nums text-slate-700">
													{(key === 'charged_factor' ? effective.charged : effective.metered) == null
														? common('noData')
														: `×${key === 'charged_factor' ? effective.charged : effective.metered}`}
												</span>
											</p>
										)}
										{key === 'provider_factor' &&
											effective.providerInactive &&
											effective.provider !== null && (
												<p className="mt-1 text-[11px] leading-4 text-slate-500">
													{t('editor.providerInactive')}
												</p>
											)}
									</div>
								))}
							</div>
							{row && !locked && openPeriod === index ? (
								<div id={`route-period-${index}`} className="mt-3 space-y-3 border-l-2 border-slate-200 pl-3">
									<div className="flex flex-wrap items-center gap-2 text-xs">
										<span className="mr-1 text-slate-500">{t('scheduleDays')}</span>
										{[
											{ label: t('scheduleEveryday'), days: [] },
											{ label: t('scheduleWeekdays'), days: [1, 2, 3, 4, 5] },
											{ label: t('scheduleWeekend'), days: [6, 7] },
										].map((preset) => (
											<button
												key={preset.label}
												type="button"
												onClick={() => updateRow(index, { days: preset.days })}
												className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
											>
												{preset.label}
											</button>
										))}
										{ISO_WEEKDAYS.map((day) => {
											const selected = isEveryIsoWeekday(row.days) || row.days.includes(day);
											return (
												<button
													key={day}
													type="button"
													aria-pressed={selected}
													className={`h-7 min-w-7 rounded px-1 ${
														selected ? 'bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-400'
													}`}
													onClick={() => {
														const days = new Set(isEveryIsoWeekday(row.days) ? ISO_WEEKDAYS : row.days);
														selected ? days.delete(day) : days.add(day);
														if (days.size) updateRow(index, { days: [...days].sort() });
													}}
												>
													{weekdays[day - 1]}
												</button>
											);
										})}
									</div>
									<div className="flex items-end gap-3">
										{(['start', 'end'] as const).map((key) => (
											<label key={key} className="min-w-0 flex-1 text-xs text-slate-500">
												{t(key === 'start' ? 'scheduleStart' : 'scheduleEnd')}
												<input
													type="text"
													inputMode="numeric"
													value={row[key]}
													placeholder={key === 'start' ? '00:00' : '24:00'}
													onChange={(e) => updateRow(index, { [key]: e.target.value })}
													className={`${editorInputClass} mt-2 font-mono`}
												/>
											</label>
										))}
										<button
											type="button"
											aria-label={`${common('delete')} ${title}`}
											title={common('delete')}
											className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50"
											onClick={() => {
												update({ schedule_windows: rows.filter((_, i) => i !== index) });
												setOpenPeriod(null);
												setOpenValidity(null);
											}}
										>
											<TrashIcon className="h-4 w-4" aria-hidden />
										</button>
									</div>
								</div>
							) : null}
							{validityOpen ? (
								<div id={`route-validity-${position}`} className="mt-3 border-l-2 border-blue-200 pl-3">
									<p className="text-xs font-medium text-slate-700">{t('editor.providerValidity')}</p>
									<p className="mt-1 text-xs leading-5 text-slate-500">
										{t('editor.rowValidityHint', { timezone })}
									</p>
									<div className="mt-3 grid gap-3 sm:grid-cols-2">
										{(['starts_at', 'expires_at'] as const).map((key) => (
											<label key={key} className={editorLabelClass}>
												{t(key === 'starts_at' ? 'providerFactorStarts' : 'providerFactorExpires')}
												<input
													type="datetime-local"
													value={zonedIsoInput(validity[key], timezone)}
													className={`${editorInputClass} mt-2 px-2 text-xs`}
													onChange={(e) =>
														setValidity({
															...validity,
															[key]: e.target.value
																? zonedDatetimeLocalInputToInstant(e.target.value, timezone)?.toISOString()
																: undefined,
														})
													}
												/>
											</label>
										))}
									</div>
								</div>
							) : null}
							{row && renderPrices ? <div className="mt-2">{renderPrices(index)}</div> : null}
						</fieldset>
					);
				})}
			</div>
			{locked ? (
				<p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">
					{t('editor.scheduleInherited')}
				</p>
			) : null}
		</RouteEditorSection>
	);
}

function zonedIsoInput(iso: string | undefined, timezone: string): string {
	if (!iso) return '';
	const instant = new Date(iso);
	return Number.isNaN(instant.getTime()) ? '' : instantToZonedDatetimeLocalInput(instant, timezone);
}
