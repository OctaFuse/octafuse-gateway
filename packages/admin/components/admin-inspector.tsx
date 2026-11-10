"use client";

import { useState, type ReactNode } from "react";
import { DocumentMagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { AdminDialog } from "./admin-dialog";

/** Read-only detail view, without displacing the current editing workspace. */
export function AdminInspector({
	label,
	children,
	hint,
	disabled = false,
	size = "lg",
	icon: Icon = DocumentMagnifyingGlassIcon,
}: {
	label: string;
	children: ReactNode;
	hint?: string;
	disabled?: boolean;
	size?: "md" | "lg";
	icon?: typeof DocumentMagnifyingGlassIcon;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				disabled={disabled}
				onClick={() => setOpen(true)}
				aria-haspopup="dialog"
				aria-expanded={open}
				className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<Icon className="h-4 w-4" aria-hidden />
				{label}
			</button>
			<AdminDialog
				open={open}
				title={label}
				hint={hint}
				size={size}
				onClose={() => setOpen(false)}
			>
				<div className="space-y-4">{children}</div>
			</AdminDialog>
		</>
	);
}
