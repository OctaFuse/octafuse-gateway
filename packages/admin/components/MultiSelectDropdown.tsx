'use client';

/**
 * 筛选用下拉多选：点击开合，Esc 与点击外部关闭；勾选选项不关闭面板。
 */
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type MultiSelectOption = {
	value: string;
	label: string;
	title?: string;
	mono?: boolean;
};

export function MultiSelectDropdown({
	label,
	options,
	selected,
	onToggle,
	minSelected = 1,
	headerActions,
	emptyText,
	align = 'start',
}: {
	label: string;
	options: MultiSelectOption[];
	selected: string[];
	onToggle: (value: string, checked: boolean) => void;
	minSelected?: number;
	headerActions?: ReactNode;
	emptyText?: string;
	align?: 'start' | 'end';
}) {
	const tCommon = useTranslations('common');
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const panelId = useId();
	const selectedSet = new Set(selected);
	const triggerText = tCommon('selectedOfTotal', {
		selected: selected.length,
		total: options.length,
	});

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) {
				setOpen(false);
			}
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', onPointer);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onPointer);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	return (
		<div ref={rootRef} className="relative min-w-0">
			<div className="flex min-w-0 items-center gap-2">
				<span className="shrink-0 whitespace-nowrap text-xs text-slate-500">{label}</span>
				<div className="min-w-0 rounded-lg bg-slate-100/80 p-1">
					<button
						type="button"
						className={`flex h-6 w-32 items-center justify-between gap-2 rounded-md pl-2.5 pr-2 text-left text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
							open ? 'bg-white font-semibold text-blue-700 shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-900'
						}`}
						aria-label={label}
						aria-expanded={open}
						aria-controls={panelId}
						aria-haspopup="listbox"
						onClick={() => setOpen((prev) => !prev)}
					>
						<span className="truncate tabular-nums">{triggerText}</span>
						<ChevronDownIcon
							className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180 text-blue-600' : 'text-slate-400'}`}
							aria-hidden
						/>
					</button>
				</div>
			</div>
			{open ? (
				<div
					id={panelId}
					role="listbox"
					aria-multiselectable
					aria-label={label}
					className={`relative z-40 mt-1 w-full min-w-0 md:absolute md:top-full md:min-w-[16rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg ${
						align === 'end' ? 'right-0' : 'left-0'
					}`}
				>
					{headerActions ? (
						<div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-1.5 text-xs">
							{headerActions}
						</div>
					) : null}
					<div className="max-h-64 overflow-y-auto py-1">
						{options.length > 0 ? (
							options.map((option) => {
								const checked = selectedSet.has(option.value);
								return (
									<label
										key={option.value}
										className={`flex min-h-10 cursor-pointer items-center gap-2 px-3 py-2 md:min-h-0 md:py-1.5 text-xs hover:bg-gray-50 ${
											checked ? 'bg-blue-50/70 text-blue-900' : 'text-gray-700'
										}`}
										title={option.title ?? option.value}
									>
										<input
											type="checkbox"
											checked={checked}
											disabled={checked && selected.length <= minSelected}
											onChange={(event) => onToggle(option.value, event.target.checked)}
											className="h-3.5 w-3.5 shrink-0"
										/>
										<span className={option.mono ? 'min-w-0 break-all font-mono' : 'min-w-0 break-words'}>{option.label}</span>
									</label>
								);
							})
						) : (
							<div className="px-3 py-2 text-xs text-gray-400">{emptyText}</div>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
