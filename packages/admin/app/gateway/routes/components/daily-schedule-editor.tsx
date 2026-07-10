'use client';

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
							className="flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-white/80 p-2"
						>
							<div>
								<label className="mb-0.5 block text-[10px] font-medium text-gray-500">
									{startLabel}
								</label>
								<input
									type="text"
									inputMode="numeric"
									placeholder="00:00"
									value={w.start}
									onChange={(e) => updateRow(i, { start: e.target.value })}
									className="w-[4.5rem] rounded border border-gray-300 px-1.5 py-1 font-mono text-xs tabular-nums"
								/>
							</div>
							<div>
								<label className="mb-0.5 block text-[10px] font-medium text-gray-500">
									{endLabel}
								</label>
								<input
									type="text"
									inputMode="numeric"
									placeholder="08:00"
									value={w.end}
									onChange={(e) => updateRow(i, { end: e.target.value })}
									className="w-[4.5rem] rounded border border-gray-300 px-1.5 py-1 font-mono text-xs tabular-nums"
								/>
							</div>
							<div>
								<label className="mb-0.5 block text-[10px] font-medium text-gray-500">
									{factorLabel}
								</label>
								<input
									type="text"
									inputMode="decimal"
									placeholder="1"
									value={w.factor}
									onChange={(e) => updateRow(i, { factor: e.target.value })}
									className="w-[4rem] rounded border border-gray-300 px-1.5 py-1 font-mono text-xs tabular-nums"
								/>
							</div>
							<button
								type="button"
								onClick={() => onChange(windows.filter((_, j) => j !== i))}
								className="ml-auto rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
							>
								{removeLabel}
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
