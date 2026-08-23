'use client';

import { TrashIcon } from '@heroicons/react/24/outline';
import {
	ISO_WEEKDAYS,
	ISO_WEEKDAYS_MON_FRI,
	ISO_WEEKDAYS_SAT_SUN,
	isEveryIsoWeekday,
} from '@octafuse/core/db/pricing-schedule';
import type { RouteScheduleFormSide, RouteScheduleFormWindow } from '../types';

export type ScheduleDayLabels = {
	days: string;
	everyday: string;
	weekdays: string;
	weekend: string;
	weekdayShort: [string, string, string, string, string, string, string];
};

type Props = {
	windows: RouteScheduleFormSide;
	onChange: (windows: RouteScheduleFormSide) => void;
	emptyLabel: string;
	startLabel: string;
	endLabel: string;
	chargedFactorLabel: string;
	meteredFactorLabel: string;
	removeLabel: string;
	dayLabels: ScheduleDayLabels;
};

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

export function DailyScheduleEditor(props: Props) {
	const {
		windows,
		onChange,
		emptyLabel,
		startLabel,
		endLabel,
		chargedFactorLabel,
		meteredFactorLabel,
		removeLabel,
		dayLabels,
	} = props;

	const updateRow = (index: number, patch: Partial<RouteScheduleFormWindow>) => {
		onChange(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
	};

	return (
		<div className="space-y-2">
			{windows.length === 0 ? (
				<p className="text-xs text-gray-500">{emptyLabel}</p>
			) : (
				<ul className="space-y-2">
					{windows.map((w, i) => {
						const selected = isEveryIsoWeekday(w.days) ? [...ISO_WEEKDAYS] : w.days;
						const everyday = isEveryIsoWeekday(w.days);
						const weekdays = sameDays(w.days, ISO_WEEKDAYS_MON_FRI);
						const weekend = sameDays(w.days, ISO_WEEKDAYS_SAT_SUN);
						return (
							<li
								key={i}
								className="space-y-1.5 rounded-md border border-gray-200 bg-white/80 p-2"
							>
								<div className="flex flex-wrap items-center gap-1">
									<span className="mr-0.5 text-[10px] font-medium text-gray-500">
										{dayLabels.days}
									</span>
									<button
										type="button"
										onClick={() => updateRow(i, { days: [] })}
										className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
											everyday
												? 'bg-gray-800 text-white'
												: 'bg-gray-100 text-gray-600 hover:bg-gray-200'
										}`}
									>
										{dayLabels.everyday}
									</button>
									<button
										type="button"
										onClick={() => updateRow(i, { days: [...ISO_WEEKDAYS_MON_FRI] })}
										className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
											weekdays
												? 'bg-gray-800 text-white'
												: 'bg-gray-100 text-gray-600 hover:bg-gray-200'
										}`}
									>
										{dayLabels.weekdays}
									</button>
									<button
										type="button"
										onClick={() => updateRow(i, { days: [...ISO_WEEKDAYS_SAT_SUN] })}
										className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
											weekend
												? 'bg-gray-800 text-white'
												: 'bg-gray-100 text-gray-600 hover:bg-gray-200'
										}`}
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
												onClick={() => updateRow(i, { days: toggleDay(w.days, day) })}
												aria-pressed={on}
												className={`min-w-6 rounded px-1 py-0.5 text-[10px] font-medium tabular-nums ${
													on
														? 'bg-blue-600 text-white'
														: 'bg-gray-100 text-gray-500 hover:bg-gray-200'
												}`}
											>
												{dayLabels.weekdayShort[day - 1]}
											</button>
										);
									})}
								</div>
								<div className="flex items-end gap-1.5">
									<div className="min-w-0 flex-1">
										<label className="mb-0.5 block text-[10px] font-medium text-gray-500">
											{startLabel}
										</label>
										<input
											type="text"
											inputMode="numeric"
											placeholder="00:00"
											value={w.start}
											onChange={(e) => updateRow(i, { start: e.target.value })}
											className="w-full min-w-0 rounded border border-gray-300 px-1.5 py-1 font-mono text-xs tabular-nums"
										/>
									</div>
									<div className="min-w-0 flex-1">
										<label className="mb-0.5 block text-[10px] font-medium text-gray-500">
											{endLabel}
										</label>
										<input
											type="text"
											inputMode="numeric"
											placeholder="08:00"
											value={w.end}
											onChange={(e) => updateRow(i, { end: e.target.value })}
											className="w-full min-w-0 rounded border border-gray-300 px-1.5 py-1 font-mono text-xs tabular-nums"
										/>
									</div>
									<div className="min-w-0 flex-[0.85]">
										<label className="mb-0.5 block text-[10px] font-medium text-blue-700/80">
											{chargedFactorLabel}
										</label>
										<input
											type="text"
											inputMode="decimal"
											placeholder="1"
											value={w.charged_factor}
											onChange={(e) => updateRow(i, { charged_factor: e.target.value })}
											className="w-full min-w-0 rounded border border-blue-200 bg-blue-50/40 px-1.5 py-1 font-mono text-xs tabular-nums"
										/>
									</div>
									<div className="min-w-0 flex-[0.85]">
										<label className="mb-0.5 block text-[10px] font-medium text-emerald-700/80">
											{meteredFactorLabel}
										</label>
										<input
											type="text"
											inputMode="decimal"
											placeholder="1"
											value={w.metered_factor}
											onChange={(e) => updateRow(i, { metered_factor: e.target.value })}
											className="w-full min-w-0 rounded border border-emerald-200 bg-emerald-50/40 px-1.5 py-1 font-mono text-xs tabular-nums"
										/>
									</div>
									<button
										type="button"
										onClick={() => onChange(windows.filter((_, j) => j !== i))}
										className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
										aria-label={removeLabel}
										title={removeLabel}
									>
										<TrashIcon className="h-4 w-4" aria-hidden />
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
