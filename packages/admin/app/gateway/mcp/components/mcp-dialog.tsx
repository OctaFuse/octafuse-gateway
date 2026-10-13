'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

/** Shared MCP overlay: one scrollable body, fixed actions and keyboard focus containment. */
export function McpDialog({
	open = true,
	title,
	subtitle,
	wide = false,
	width,
	navigation,
	closeWhileBusy = false,
	busy,
	onClose,
	children,
	footer,
}: {
	open?: boolean;
	title: string;
	subtitle?: string;
	wide?: boolean;
	width?: 'default' | 'form' | 'wide';
	navigation?: ReactNode;
	closeWhileBusy?: boolean;
	busy: boolean;
	onClose: () => void;
	children: ReactNode;
	footer: ReactNode;
}) {
	const t = useTranslations('common');
	const titleId = useId();
	const panel = useRef<HTMLDivElement>(null);
	const closeButton = useRef<HTMLButtonElement>(null);
	const close = useRef(onClose);
	const working = useRef(busy);
	useEffect(() => {
		close.current = onClose;
		working.current = busy && !closeWhileBusy;
	}, [onClose, busy, closeWhileBusy]);

	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const frame = requestAnimationFrame(() => closeButton.current?.focus());
		function onKey(event: KeyboardEvent) {
			// Feedback confirmation is above this panel and owns keyboard interaction while open.
			const confirmation = document.querySelector<HTMLElement>('[role="alertdialog"]');
			const scope = confirmation ?? panel.current;
			if (event.key === 'Escape') {
				if (confirmation) return;
				event.preventDefault();
				if (!working.current) close.current();
			}
			if (event.key !== 'Tab') return;
			const nodes = Array.from(
				scope?.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]'
				) ?? []
			).filter((node) => node.getClientRects().length > 0 && !node.matches(':disabled'));
			const first = nodes[0];
			const last = nodes[nodes.length - 1];
			if (!first || !last) return;
			if (!scope?.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
				event.preventDefault();
				first.focus();
			} else if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			}
		}
		window.addEventListener('keydown', onKey);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('keydown', onKey);
			document.body.style.overflow = overflow;
			if (previous?.isConnected) previous.focus();
		};
	}, [open]);

	if (!open) return null;
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			<div
				className="absolute inset-0 bg-black/50"
				aria-hidden="true"
				onMouseDown={(event) => {
					if (!busy || closeWhileBusy) {
						event.preventDefault();
						onClose();
					}
				}}
			/>
			<div
				ref={panel}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-busy={busy}
				className={`relative flex w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl ${
					width === 'form'
						? 'min-h-[min(680px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] max-w-[1040px]'
						: width === 'wide' || wide
						? 'max-h-[90dvh] max-w-5xl'
						: 'max-h-[90dvh] max-w-2xl'
				}`}
			>
				<header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
					<div className="min-w-0">
						<h2 id={titleId} className="break-words text-xl font-bold text-gray-900">
							{title}
						</h2>
						{subtitle ? <p className="mt-1 break-words text-sm text-gray-500">{subtitle}</p> : null}
					</div>
					<button
						ref={closeButton}
						type="button"
						aria-label={t('close')}
						disabled={busy && !closeWhileBusy}
						onClick={onClose}
						className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
					>
						<XMarkIcon className="h-5 w-5" aria-hidden="true" />
					</button>
				</header>
				{navigation ? <nav className="shrink-0 border-b border-gray-200">{navigation}</nav> : null}
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
				<footer className="shrink-0 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:px-6">{footer}</footer>
			</div>
		</div>
	);
}
