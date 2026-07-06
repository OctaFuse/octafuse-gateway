import type { ReactNode } from 'react';

/** Left filter panel: compact grouped nav, low visual weight vs main content cards. */
export function FilterNavSection({
	title,
	ariaLabel,
	children,
}: {
	title: string;
	ariaLabel: string;
	children: ReactNode;
}) {
	return (
		<nav
			className="overflow-hidden rounded-lg border border-gray-200/70 bg-white/50"
			aria-label={ariaLabel}
		>
			<div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
				{title}
			</div>
			<ul className="space-y-0.5 px-1 pb-1">{children}</ul>
		</nav>
	);
}

export function FilterNavButton({
	label,
	count,
	isActive,
	onClick,
}: {
	label: string;
	count?: number;
	isActive: boolean;
	onClick: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={onClick}
				aria-current={isActive ? 'true' : undefined}
				className={
					(isActive
						? 'bg-blue-100/80 text-blue-800 ring-1 ring-blue-200/80 '
						: 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900 ') +
					'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors'
				}
			>
				<span className="truncate font-medium" title={label}>
					{label}
				</span>
				{count !== undefined ? (
					<span
						className={
							(isActive ? 'bg-blue-200/60 text-blue-800 ' : 'bg-gray-100/90 text-gray-500 ') +
							'shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums'
						}
					>
						{count}
					</span>
				) : null}
			</button>
		</li>
	);
}
