'use client';

import { TrashIcon } from '@heroicons/react/24/outline';
import type { RouteScheduleFormSide, RouteScheduleFormWindow } from '../types';

type Props = {
	windows: RouteScheduleFormSide;
	onChange: (windows: RouteScheduleFormSide) => void;
	emptyLabel: string;
	startLabel: string;
	endLabel: string;
	chargedFactorLabel: string;
	meteredFactorLabel: string;
	removeLabel: string;
};

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
					{windows.map((w, i) => (
						<li
							key={i}
							className="flex items-end gap-1.5 rounded-md border border-gray-200 bg-white/80 p-2"
						>
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
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
