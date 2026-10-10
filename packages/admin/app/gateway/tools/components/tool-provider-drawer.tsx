'use client';

/**
 * Tools Provider 右侧抽屉：桌面侧滑、窄屏全屏；Escape / 遮罩关闭；基础焦点陷阱。
 */
import {
	useEffect,
	useId,
	useRef,
	type ReactNode,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

type Props = {
	open: boolean;
	title: string;
	docsHref?: string;
	docsLabel?: string;
	playgroundHref?: string | null;
	playgroundLabel?: string;
	/** 保存中禁止遮罩/Escape 关闭 */
	busy?: boolean;
	/** 目录详情需要更宽的面板 */
	wide?: boolean;
	onClose: () => void;
	children: ReactNode;
	footer: ReactNode;
};

const FOCUSABLE =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ToolProviderDrawer({
	open,
	title,
	docsHref,
	docsLabel,
	playgroundHref,
	playgroundLabel,
	busy = false,
	wide = false,
	onClose,
	children,
	footer,
}: Props) {
	const tCommon = useTranslations('common');
	const titleId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	const closeBtnRef = useRef<HTMLButtonElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		previousFocusRef.current =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const frame = requestAnimationFrame(() => {
			closeBtnRef.current?.focus();
		});
		return () => {
			cancelAnimationFrame(frame);
			previousFocusRef.current?.focus?.();
			previousFocusRef.current = null;
		};
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !busy) {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, busy, onClose]);

	const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (e.key !== 'Tab' || !panelRef.current) {
			return;
		}
		const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
			(el) => !el.hasAttribute('disabled') && el.tabIndex !== -1
		);
		if (nodes.length === 0) {
			return;
		}
		const first = nodes[0]!;
		const last = nodes[nodes.length - 1]!;
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};

	if (!open) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-40 flex justify-end" role="presentation">
			<div
				className="absolute inset-0 bg-black/40"
				onMouseDown={(e) => {
					if (e.target === e.currentTarget && !busy) {
						onClose();
					}
				}}
				aria-hidden
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				onKeyDown={onPanelKeyDown}
				className={`relative flex h-full w-full max-w-full flex-col bg-white shadow-xl ring-1 ring-black/5 ${wide ? 'sm:max-w-2xl lg:max-w-3xl' : 'sm:max-w-md md:max-w-lg'}`}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
					<div className="min-w-0 flex-1">
						<h2 id={titleId} className="truncate text-base font-semibold text-gray-900">
							{title}
						</h2>
						<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
							{docsHref && docsLabel ? (
								<a
									href={docsHref}
									target="_blank"
									rel="noopener noreferrer"
									className="text-xs font-medium text-blue-600 hover:underline"
								>
									{docsLabel}
								</a>
							) : null}
							{playgroundHref && playgroundLabel ? (
								<Link
									href={playgroundHref}
									className="text-xs font-medium text-slate-700 hover:underline"
								>
									{playgroundLabel}
								</Link>
							) : null}
						</div>
					</div>
					<button
						ref={closeBtnRef}
						type="button"
						onClick={onClose}
						disabled={busy}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
						aria-label={tCommon('close')}
					>
						<XMarkIcon className="h-5 w-5" aria-hidden />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
				<div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">{footer}</div>
			</div>
		</div>
	);
}
