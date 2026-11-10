'use client';

import { AdminContentMark } from '@/components/admin-content-mark';

/**
 * Tools Provider 居中弹窗：内容滚动、固定操作区；Escape / 遮罩关闭与焦点恢复。
 */
import {
	useEffect,
	useId,
	useRef,
	type ReactNode,
	type RefObject,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { XMarkIcon, ArrowTopRightOnSquareIcon, BeakerIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

type Props = {
	open: boolean;
	title: string;
	subtitle?: string;
	headerActions?: ReactNode;
	navigation?: ReactNode;
	/** 状态变化使原服务行被筛掉时，关闭后仍有可用的焦点目标。 */
	fallbackFocusRef?: RefObject<HTMLElement>;
	docsHref?: string;
	docsLabel?: string;
	playgroundHref?: string | null;
	playgroundLabel?: string;
	playgroundHint?: string;
	/** 保存中禁止遮罩/Escape 关闭 */
	busy?: boolean;
	/** 目录详情需要更宽的面板 */
	wide?: boolean;
	onClose: () => void;
	children: ReactNode;
	footer: ReactNode;
};

const FOCUSABLE =
	'summary, a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ToolProviderDrawer({
	open,
	title,
	subtitle,
	headerActions,
	navigation,
	fallbackFocusRef,
	docsHref,
	docsLabel,
	playgroundHref,
	playgroundLabel,
	playgroundHint,
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
		previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const fallbackFocus = fallbackFocusRef?.current;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const frame = requestAnimationFrame(() => {
			closeBtnRef.current?.focus();
		});
		return () => {
			cancelAnimationFrame(frame);
			document.body.style.overflow = overflow;
			const previous = previousFocusRef.current;
			(previous?.isConnected ? previous : fallbackFocus)?.focus();
			previousFocusRef.current = null;
		};
	}, [open, fallbackFocusRef]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.defaultPrevented || document.querySelector('[role="alertdialog"]')) return;
			const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
			if (dialogs.at(-1) !== panelRef.current) return;
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
			(el) => !el.matches(':disabled') && el.tabIndex !== -1 && el.getClientRects().length > 0
		);
		if (nodes.length === 0) {
			return;
		}
		const first = nodes[0]!;
		const last = nodes[nodes.length - 1]!;
		if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
			e.preventDefault();
			last.focus();
		} else if (
			!e.shiftKey &&
			(document.activeElement === last || document.activeElement === panelRef.current)
		) {
			e.preventDefault();
			first.focus();
		}
	};

	if (!open) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="presentation">
			<div
				className="absolute inset-0 bg-gray-950/35"
				onMouseDown={(e) => {
					if (e.target === e.currentTarget && !busy) {
						e.preventDefault();
						onClose();
					}
				}}
				aria-hidden
			/>
			<div
				ref={panelRef}
				role="dialog"
				tabIndex={-1}
				aria-modal="true"
				aria-labelledby={titleId}
				aria-busy={busy}
				onKeyDown={onPanelKeyDown}
				className={`admin-content-dialog relative flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl outline-none ${
					wide ? 'max-w-5xl' : 'max-w-[720px]'
				}`}
			>
				<div className="admin-dialog-header flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-5 sm:px-6">
					<div className="min-w-0 flex-1">
						<h2 id={titleId} className="admin-dialog-title break-words text-lg font-medium text-gray-900">
							<AdminContentMark />
							{title}
						</h2>
						{subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
						<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
							{docsHref && docsLabel ? (
								<a
									href={docsHref}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900"
								>
									<ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
									{docsLabel}
								</a>
							) : null}
							{playgroundHref && playgroundLabel ? (
								<Link
									href={playgroundHref}
									title={playgroundHint}
									className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900"
								>
									<BeakerIcon className="h-4 w-4" aria-hidden="true" />
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
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50"
						aria-label={tCommon('close')}
					>
						<XMarkIcon className="h-5 w-5" aria-hidden />
					</button>
				</div>
				{headerActions ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3 sm:px-6">
						{headerActions}
					</div>
				) : null}
				{navigation}
				<div className="admin-dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6">{children}</div>
				<div className="admin-dialog-footer shrink-0 border-t border-gray-100 bg-gray-50/60 px-5 py-4 sm:px-6">{footer}</div>
			</div>
		</div>
	);
}
