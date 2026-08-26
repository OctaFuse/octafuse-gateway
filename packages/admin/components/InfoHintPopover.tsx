'use client';

/**
 * 列头 / 标签旁的说明浮层：点击开合，Esc 与点击外部关闭。
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

export function InfoHintPopover({
	label,
	children,
	align = 'end',
}: {
	label: string;
	children: ReactNode;
	align?: 'start' | 'end';
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLSpanElement>(null);
	const panelId = useId();

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
		<span ref={rootRef} className="relative inline-flex items-center">
			<button
				type="button"
				className="inline-flex rounded-full text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
				aria-expanded={open}
				aria-controls={panelId}
				aria-label={label}
				onClick={(event) => {
					event.stopPropagation();
					setOpen((prev) => !prev);
				}}
			>
				<InformationCircleIcon className="h-3.5 w-3.5" aria-hidden />
			</button>
			{open ? (
				<div
					id={panelId}
					role="dialog"
					aria-label={label}
					className={`absolute top-full z-30 mt-1.5 w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case tracking-normal text-gray-600 shadow-lg ${
						align === 'end' ? 'right-0' : 'left-0'
					}`}
					onClick={(event) => event.stopPropagation()}
				>
					{children}
				</div>
			) : null}
		</span>
	);
}
