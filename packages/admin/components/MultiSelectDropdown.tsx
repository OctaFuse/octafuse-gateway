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
			<label className="mb-1 block text-sm font-medium text-gray-600">{label}</label>
			<button
				type="button"
				className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-left text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
				aria-expanded={open}
				aria-controls={panelId}
				aria-haspopup="listbox"
				onClick={() => setOpen((prev) => !prev)}
			>
				<span className="truncate tabular-nums">{triggerText}</span>
				<ChevronDownIcon
					className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
					aria-hidden
				/>
			</button>
			{open ? (
				<div
					id={panelId}
					role="listbox"
					aria-multiselectable
					aria-label={label}
					className={`absolute top-full z-40 mt-1 w-full min-w-[16rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg ${
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
										className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 ${
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
										<span className={option.mono ? 'font-mono' : undefined}>{option.label}</span>
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
