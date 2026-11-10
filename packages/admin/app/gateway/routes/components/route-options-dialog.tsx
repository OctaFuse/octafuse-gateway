'use client';

import { useId, useState, type ReactNode } from 'react';
import { AdjustmentsHorizontalIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useAdminDialog } from '@/components/use-admin-dialog';

/** Low-frequency filters and display preferences, with the same keyboard behavior as editors. */
export function RouteOptionsDialog({
	label,
	children,
	activeCount = 0,
	compact = false,
}: {
	label: string;
	children: ReactNode;
	activeCount?: number;
	compact?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const id = useId();
	const t = useTranslations('common');
	const ref = useAdminDialog(open, false, () => setOpen(false));
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-label={label}
				className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-100 ${
					compact ? 'h-9 w-9 sm:w-auto sm:px-3' : 'h-10 px-3'
				}`}
			>
				<AdjustmentsHorizontalIcon className="h-4 w-4" aria-hidden />
				<span className={compact ? 'hidden sm:inline' : ''}>{label}</span>
				{activeCount > 0 && (
					<span className="rounded bg-gray-100 px-1.5 font-mono tabular-nums">{activeCount}</span>
				)}
			</button>
			{open && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setOpen(false);
					}}
				>
					<div
						ref={ref}
						tabIndex={-1}
						role="dialog"
						aria-modal="true"
						aria-labelledby={id}
						className="route-design-dialog flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-panel outline-none"
					>
						<header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
							<h2 id={id} className="flex items-center gap-2 text-base font-medium text-gray-950"><span className="route-dialog-symbol" aria-hidden><AdjustmentsHorizontalIcon className="h-4 w-4" /></span>
								{label}
							</h2>
							<button
								type="button"
								onClick={() => setOpen(false)}
								aria-label={t('close')}
								className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-800"
							>
								<XMarkIcon className="h-5 w-5" aria-hidden />
							</button>
						</header>
						<div className="min-h-0 space-y-5 overflow-y-auto p-5">{children}</div>
						<footer className="flex shrink-0 justify-end border-t border-gray-100 bg-gray-50 px-5 py-3">
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
							>
								{t('close')}
							</button>
						</footer>
					</div>
				</div>
			)}
		</>
	);
}
