"use client";

import { AdminContentMark } from '@/components/admin-content-mark';
import { useId, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { useAdminDialog } from "./use-admin-dialog";

export function AdminDialog({
	open,
	title,
	hint,
	busy = false,
	onClose,
	children,
	footer,
	wide = false,
	size = "lg",
	fallbackFocusRef,
}: {
	open: boolean;
	title: string;
	hint?: string;
	busy?: boolean;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	wide?: boolean;
	size?: "md" | "lg";
	fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
	const id = useId();
	const t = useTranslations("common");
	const ref = useAdminDialog(open, busy, onClose, fallbackFocusRef);
	if (!open) return null;
	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !busy) onClose();
			}}
		>
			<div
				ref={ref}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby={id}
				aria-describedby={hint ? `${id}-hint` : undefined}
				aria-busy={busy}
				className={`admin-content-dialog flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl outline-none sm:max-h-[calc(100dvh-3rem)] ${
					size === "md" ? "max-w-md" : wide ? "max-w-5xl" : "max-w-3xl"
				}`}
			>
				<header className="admin-dialog-header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6">
					<div className="min-w-0">
						<h2
							id={id}
							className="admin-dialog-title break-words text-lg font-medium text-gray-900"
						><AdminContentMark />
							{title}
						</h2>
						{hint ? (
							<p
								id={`${id}-hint`}
								className="mt-1 text-xs leading-5 text-gray-500"
							>
								{hint}
							</p>
						) : null}
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						aria-label={t("close")}
						className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 disabled:opacity-40"
					>
						<XMarkIcon className="h-4 w-4" aria-hidden="true" />
					</button>
				</header>
				<div className="admin-dialog-body min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6">
					{children}
				</div>
				<footer className="admin-dialog-footer shrink-0 border-t border-gray-100 bg-gray-50/60 px-5 py-3 sm:px-6">
					{footer ?? (
						<div className="flex justify-end">
							<button
								type="button"
								onClick={onClose}
								disabled={busy}
								className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 disabled:opacity-40"
							>
								{t("close")}
							</button>
						</div>
					)}
				</footer>
			</div>
		</div>,
		document.body
	);
}
