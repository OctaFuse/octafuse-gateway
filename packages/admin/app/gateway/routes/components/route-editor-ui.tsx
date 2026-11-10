'use client';

import type { ReactNode } from 'react';
import type { ArrowsRightLeftIcon } from '@heroicons/react/24/outline';

export const editorInputClass =
	'h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 hover:border-gray-300 focus:border-gray-500 focus:ring-2 focus:ring-gray-500/10 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400';
export const editorLabelClass = 'mb-2 block text-xs font-medium text-gray-600';
export const editorPanelClass =
	'route-editor-section min-w-0 rounded-xl border border-gray-200 bg-white';

export function RouteEditorSectionHeader({
	title,
	description,
	action,
	icon: Icon,
	className = '',
}: {
	title: string;
	description?: string;
	action?: ReactNode;
	icon?: typeof ArrowsRightLeftIcon;
	className?: string;
}) {
	return (
		<div
			className={`route-section-heading flex items-start justify-between gap-3 rounded-t-xl border-b border-slate-200 bg-slate-50 px-5 py-3 ${className}`}
		>
			<div className="min-w-0">
				<h3 className="flex items-center gap-2 text-sm font-medium text-slate-900">
					{Icon && <span className="route-section-symbol" aria-hidden><Icon className="h-4 w-4" /></span>}
					{title}
				</h3>
				{description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
			</div>
			{action}
		</div>
	);
}

export function RouteEditorSection({
	title,
	description,
	action,
	icon,
	children,
	className = '',
}: {
	title: string;
	description?: string;
	action?: ReactNode;
	icon?: typeof ArrowsRightLeftIcon;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={`${editorPanelClass} ${className}`}>
			<RouteEditorSectionHeader title={title} description={description} action={action} icon={icon} />
			<div className="px-5 py-3">{children}</div>
		</section>
	);
}

export function RouteMultiplierInput({
	id,
	label,
	value,
	onChange,
	placeholder = '1',
}: {
	id?: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	return (
		<div className="relative min-w-0">
			<span
				aria-hidden
				className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400"
			>
				×
			</span>
			<input
				id={id}
				type="text"
				inputMode="decimal"
				aria-label={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className={`${editorInputClass.replace('h-10', 'h-8')} pl-7 font-mono tabular-nums`}
				placeholder={placeholder}
			/>
		</div>
	);
}
