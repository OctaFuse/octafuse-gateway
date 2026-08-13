'use client';

import { TrashIcon } from '@heroicons/react/24/outline';
import type { RouteScheduleFormSide, RouteScheduleFormWindow } from '../types';

type Props = {
	windows: RouteScheduleFormSide;
	onChange: (windows: RouteScheduleFormSide) => void;
	addLabel: string;
	emptyLabel: string;
	startLabel: string;
	endLabel: string;
	factorLabel: string;
	removeLabel: string;
};

export function DailyScheduleEditor(props: Props) {
	const {
		windows,
		onChange,
		addLabel,
		emptyLabel,
		startLabel,
		endLabel,
		factorLabel,
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
								<label className="mb-0.5 block text-[10px] font-medium text-gray-500">
									{factorLabel}
								</label>
								<input
									type="text"
									inputMode="decimal"
									placeholder="1"
									value={w.factor}
									onChange={(e) => updateRow(i, { factor: e.target.value })}
									className="w-full min-w-0 rounded border border-gray-300 px-1.5 py-1 font-mono text-xs tabular-nums"
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
			<button
				type="button"
				onClick={() =>
					onChange([...windows, { start: '00:00', end: '08:00', factor: '1' }])
				}
				className="rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
			>
				{addLabel}
			</button>
		</div>
	);
}
