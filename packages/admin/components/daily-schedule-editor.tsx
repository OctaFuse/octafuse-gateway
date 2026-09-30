'use client';

import type { ReactNode } from 'react';
import { TrashIcon } from '@heroicons/react/24/outline';
import {
	ISO_WEEKDAYS,
	ISO_WEEKDAYS_MON_FRI,
	ISO_WEEKDAYS_SAT_SUN,
	isEveryIsoWeekday,
} from '@octafuse/core/db/pricing-schedule';

export type ScheduleDayLabels = {
	days: string;
	everyday: string;
	weekdays: string;
	weekend: string;
	weekdayShort: [string, string, string, string, string, string, string];
};

export type DualScheduleFormWindow = {
	start: string;
	end: string;
	charged_factor: string;
	metered_factor: string;
	provider_factor?: string;
	days: number[];
};

export type SingleScheduleFormWindow = {
	start: string;
	end: string;
	factor: string;
	days: number[];
};

type DualProps = {
	variant?: 'dual';
	windows: DualScheduleFormWindow[];
	onChange: (windows: DualScheduleFormWindow[]) => void;
	chargedFactorLabel: string;
	meteredFactorLabel: string;
	providerFactorLabel: string;
	factorLabel?: never;
};

type SingleProps = {
	variant: 'single';
	windows: SingleScheduleFormWindow[];
	onChange: (windows: SingleScheduleFormWindow[]) => void;
	factorLabel: string;
	chargedFactorLabel?: never;
	meteredFactorLabel?: never;
};

type SharedProps = {
	emptyLabel: string;
	startLabel: string;
	endLabel: string;
	removeLabel: string;
	dayLabels: ScheduleDayLabels;
	/** 锁定时间与星期（仅允许改倍率）；用于 route 继承 model 官方时段。 */
	lockWindows?: boolean;
	/** Show inherited days and times as a summary, keeping only factors editable. */
	compactLockedWindows?: boolean;
	/** `inline`：星期与起止/倍率同一行，适合更宽的弹窗。 */
	layout?: 'stacked' | 'inline';
	/** Roomier, neutral controls for route configuration. */
	comfortable?: boolean;
	/** 每行倍率下方的只读预览（如官方时段锁定时的明细价）。 */
	renderWindowExtra?: (index: number) => ReactNode;
};

type Props = SharedProps & (DualProps | SingleProps);

function sameDays(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	const as = [...a].sort((x, y) => x - y);
	const bs = [...b].sort((x, y) => x - y);
	return as.every((n, i) => n === bs[i]);
}

function toggleDay(days: number[], day: number): number[] {
	const set = new Set(isEveryIsoWeekday(days) ? ISO_WEEKDAYS : days);
	if (set.has(day)) {
		set.delete(day);
	} else {
		set.add(day);
	}
	const next = [...set].sort((a, b) => a - b);
	return next.length === 7 ? [] : next;
}

function factorInputClass(tone: 'blue' | 'emerald' | 'violet' | 'slate', comfortable = false): string {
	if (comfortable)
		return 'h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10';
	if (tone === 'blue') {
		return 'w-full min-w-0 rounded border border-blue-200 bg-blue-50/40 px-1.5 py-1 font-mono text-xs tabular-nums';
	}
	if (tone === 'emerald') {
		return 'w-full min-w-0 rounded border border-emerald-200 bg-emerald-50/40 px-1.5 py-1 font-mono text-xs tabular-nums';
	}
	if (tone === 'violet') {
		return 'w-full min-w-0 rounded border border-violet-200 bg-violet-50/40 px-1.5 py-1 font-mono text-xs tabular-nums';
	}
	return 'w-full min-w-0 rounded border border-slate-200 bg-slate-50/60 px-1.5 py-1 font-mono text-xs tabular-nums';
}

export function DailyScheduleEditor(props: Props) {
	const {
		windows,
		onChange,
		emptyLabel,
		startLabel,
		endLabel,
		removeLabel,
		dayLabels,
		lockWindows = false,
		compactLockedWindows = false,
		comfortable = false,
		layout = 'stacked',
		renderWindowExtra,
	} = props;
	const inline = layout === 'inline';
	const isSingle = props.variant === 'single';
	const summarizeWindow = lockWindows && compactLockedWindows;

	const updateRow = (index: number, patch: Record<string, unknown>) => {
		onChange(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)) as never);
	};

	return (
		<div className="space-y-2">
			{windows.length === 0 ? (
				<p className="text-xs text-gray-500">{emptyLabel}</p>
			) : (
				<ul className={comfortable ? 'divide-y divide-slate-200' : 'space-y-2'}>
					{windows.map((w, i) => {
						const selected = isEveryIsoWeekday(w.days) ? [...ISO_WEEKDAYS] : w.days;
						const everyday = isEveryIsoWeekday(w.days);
						const weekdays = sameDays(w.days, ISO_WEEKDAYS_MON_FRI);
						const weekend = sameDays(w.days, ISO_WEEKDAYS_SAT_SUN);
						return (
							<li
								key={i}
								className={
									comfortable
										? summarizeWindow
											? 'grid gap-x-5 gap-y-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[120px_minmax(0,1fr)]'
											: 'space-y-4 py-4 first:pt-0 last:pb-0'
										: inline
										? 'flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-white/80 p-2'
										: 'space-y-1.5 rounded-md border border-gray-200 bg-white/80 p-2'
								}
							>
								{summarizeWindow ? (
									<div
										className={
											comfortable
												? 'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:flex-col sm:items-start sm:justify-center'
												: 'flex flex-wrap items-center gap-2 text-xs'
										}
									>
										<span className="font-mono font-medium tabular-nums text-gray-800">
											{w.start}–{w.end}
										</span>
										<span
											className={
												comfortable
													? 'text-xs text-slate-500'
													: 'rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500'
											}
										>
											{everyday
												? dayLabels.everyday
												: weekdays
												? dayLabels.weekdays
												: weekend
												? dayLabels.weekend
												: selected.map((day) => dayLabels.weekdayShort[day - 1]).join(' · ')}
										</span>
									</div>
								) : (
									<div
										className={
											inline
												? 'flex min-w-0 flex-1 flex-wrap items-center gap-1'
												: 'flex flex-wrap items-center gap-1'
										}
									>
										<span className="mr-0.5 text-[10px] font-medium text-gray-500">{dayLabels.days}</span>
										<button
											type="button"
											disabled={lockWindows}
											onClick={() => updateRow(i, { days: [] })}
											className={`${
												comfortable ? 'rounded-md px-2.5 py-1.5 text-xs' : 'rounded px-1.5 py-0.5 text-[10px]'
											} font-medium ${
												everyday ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
											} disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-gray-100`}
										>
											{dayLabels.everyday}
										</button>
										<button
											type="button"
											disabled={lockWindows}
											onClick={() => updateRow(i, { days: [...ISO_WEEKDAYS_MON_FRI] })}
											className={`${
												comfortable ? 'rounded-md px-2.5 py-1.5 text-xs' : 'rounded px-1.5 py-0.5 text-[10px]'
											} font-medium ${
												weekdays ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
											} disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-gray-100`}
										>
											{dayLabels.weekdays}
										</button>
										<button
											type="button"
											disabled={lockWindows}
											onClick={() => updateRow(i, { days: [...ISO_WEEKDAYS_SAT_SUN] })}
											className={`${
												comfortable ? 'rounded-md px-2.5 py-1.5 text-xs' : 'rounded px-1.5 py-0.5 text-[10px]'
											} font-medium ${
												weekend ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
											} disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-gray-100`}
										>
											{dayLabels.weekend}
										</button>
										<span className="mx-0.5 h-3 w-px bg-gray-200" aria-hidden />
										{ISO_WEEKDAYS.map((day) => {
											const on = selected.includes(day);
											return (
												<button
													key={day}
													type="button"
													disabled={lockWindows}
													onClick={() => updateRow(i, { days: toggleDay(w.days, day) })}
													aria-pressed={on}
													className={`${
														comfortable
															? 'min-w-7 rounded-md px-1.5 py-1.5 text-xs'
															: 'min-w-6 rounded px-1 py-0.5 text-[10px]'
													} font-medium tabular-nums ${
														on
															? comfortable
																? 'bg-blue-50 text-blue-700'
																: 'bg-blue-600 text-white'
															: 'bg-gray-100 text-gray-500 hover:bg-gray-200'
													} disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-gray-100`}
												>
													{dayLabels.weekdayShort[day - 1]}
												</button>
											);
										})}
									</div>
								)}
								<div
									className={
										comfortable
											? summarizeWindow
												? 'grid grid-cols-3 items-end gap-3'
												: 'grid grid-cols-2 items-end gap-3 sm:grid-cols-[repeat(5,minmax(0,1fr))_auto]'
											: inline
											? 'flex w-full shrink-0 items-end gap-1.5 sm:w-auto sm:min-w-[22rem]'
											: 'flex items-end gap-1.5'
									}
								>
									{!summarizeWindow && (
										<>
											<div className="min-w-0 flex-1">
												<label
													className={
														comfortable
															? 'mb-2 block text-xs font-medium text-gray-500'
															: 'mb-0.5 block text-[10px] font-medium text-gray-500'
													}
												>
													{startLabel}
												</label>
												<input
													type="text"
													aria-label={startLabel}
													inputMode="numeric"
													placeholder="00:00"
													value={w.start}
													readOnly={lockWindows}
													onChange={(e) => updateRow(i, { start: e.target.value })}
													className={
														comfortable
															? factorInputClass('slate', true)
															: 'w-full min-w-0 rounded border border-gray-300 px-1.5 py-1 font-mono text-xs tabular-nums read-only:bg-gray-50 read-only:text-gray-600'
													}
												/>
											</div>
											<div className="min-w-0 flex-1">
												<label
													className={
														comfortable
															? 'mb-2 block text-xs font-medium text-gray-500'
															: 'mb-0.5 block text-[10px] font-medium text-gray-500'
													}
												>
													{endLabel}
												</label>
												<input
													type="text"
													aria-label={endLabel}
													inputMode="numeric"
													placeholder="08:00"
													value={w.end}
													readOnly={lockWindows}
													onChange={(e) => updateRow(i, { end: e.target.value })}
													className={
														comfortable
															? factorInputClass('slate', true)
															: 'w-full min-w-0 rounded border border-gray-300 px-1.5 py-1 font-mono text-xs tabular-nums read-only:bg-gray-50 read-only:text-gray-600'
													}
												/>
											</div>
										</>
									)}
									{isSingle ? (
										<div className="min-w-0 flex-[0.85]">
											<label
												className={
													comfortable
														? 'mb-2 block text-xs font-medium text-gray-500'
														: 'mb-0.5 block text-[10px] font-medium text-slate-700/80'
												}
											>
												{props.factorLabel}
											</label>
											<input
												type="text"
												aria-label={props.factorLabel}
												inputMode="decimal"
												placeholder="1"
												value={(w as SingleScheduleFormWindow).factor}
												onChange={(e) => updateRow(i, { factor: e.target.value })}
												className={factorInputClass('slate', comfortable)}
											/>
										</div>
									) : (
										<>
											<div className="min-w-0 flex-[0.85]">
												<label
													className={
														comfortable
															? 'mb-2 block text-xs font-medium text-gray-500'
															: 'mb-0.5 block text-[10px] font-medium text-blue-700/80'
													}
												>
													{props.chargedFactorLabel}
												</label>
												<input
													type="text"
													aria-label={props.chargedFactorLabel}
													inputMode="decimal"
													placeholder="1"
													value={(w as DualScheduleFormWindow).charged_factor}
													onChange={(e) => updateRow(i, { charged_factor: e.target.value })}
													className={factorInputClass('blue', comfortable)}
												/>
											</div>
											<div className="min-w-0 flex-[0.85]">
												<label
													className={
														comfortable
															? 'mb-2 block text-xs font-medium text-gray-500'
															: 'mb-0.5 block text-[10px] font-medium text-emerald-700/80'
													}
												>
													{props.meteredFactorLabel}
												</label>
												<input
													type="text"
													aria-label={props.meteredFactorLabel}
													inputMode="decimal"
													placeholder="1"
													value={(w as DualScheduleFormWindow).metered_factor}
													onChange={(e) => updateRow(i, { metered_factor: e.target.value })}
													className={factorInputClass('emerald', comfortable)}
												/>
											</div>
											<div className="min-w-0 flex-[0.85]">
												<label
													className={
														comfortable
															? 'mb-2 block text-xs font-medium text-gray-500'
															: 'mb-0.5 block text-[10px] font-medium text-violet-700/80'
													}
												>
													{props.providerFactorLabel}
												</label>
												<input
													type="text"
													aria-label={props.providerFactorLabel}
													inputMode="decimal"
													placeholder="1"
													value={(w as DualScheduleFormWindow).provider_factor ?? ''}
													onChange={(e) => updateRow(i, { provider_factor: e.target.value })}
													className={factorInputClass('violet', comfortable)}
												/>
											</div>
										</>
									)}
									{lockWindows ? null : (
										<button
											type="button"
											onClick={() => onChange(windows.filter((_, j) => j !== i) as never)}
											className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
											aria-label={removeLabel}
											title={removeLabel}
										>
											<TrashIcon className="h-4 w-4" aria-hidden />
										</button>
									)}
								</div>
								{renderWindowExtra ? (
									<div
										className={
											comfortable && summarizeWindow
												? 'min-w-0 sm:col-start-2'
												: inline
												? 'w-full min-w-0'
												: 'min-w-0'
										}
									>
										{renderWindowExtra(i)}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
