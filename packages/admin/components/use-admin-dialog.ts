"use client";

import { useEffect, useRef } from "react";

/** Keep keyboard navigation inside the current admin overlay and restore its trigger. */
export function useAdminDialog(
	open: boolean,
	busy: boolean,
	onClose: () => void
) {
	const ref = useRef<HTMLDivElement>(null);
	const current = useRef({ busy, onClose });
	useEffect(() => {
		current.current = { busy, onClose };
	}, [busy, onClose]);
	useEffect(() => {
		if (!open) return;
		const previous =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		ref.current?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const dialogs = Array.from(
				document.querySelectorAll<HTMLElement>(
					'[role="dialog"], [role="alertdialog"], dialog[open]'
				)
			).filter((element) => element.getClientRects().length > 0);
			if (dialogs[dialogs.length - 1] !== ref.current) return;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				if (!current.current.busy) current.current.onClose();
			}
			if (event.key !== "Tab") return;
			const elements = Array.from(
				ref.current?.querySelectorAll<HTMLElement>(
					'summary, button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
				) ?? []
			).filter((element) => element.getClientRects().length > 0);
			const first = elements[0];
			const last = elements[elements.length - 1];
			if (!first) {
				event.preventDefault();
				ref.current?.focus();
				return;
			}
			if (
				event.shiftKey &&
				(document.activeElement === first ||
					document.activeElement === ref.current)
			) {
				event.preventDefault();
				last?.focus();
			} else if (
				!event.shiftKey &&
				(document.activeElement === last ||
					document.activeElement === ref.current)
			) {
				event.preventDefault();
				first?.focus();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = overflow;
			if (previous?.isConnected) previous.focus();
		};
	}, [open]);
	return ref;
}
