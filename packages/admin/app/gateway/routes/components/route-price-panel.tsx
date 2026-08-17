'use client';

import type { ReactNode } from 'react';
import { routePricePanelHeaderBorder, routePricePanelShell } from '../types';

export function RoutePricePanel({
	title,
	subtitle,
	variant,
	children,
	fillHeight = false,
	headerEnd,
	headerEndBeside = 'title',
}: {
	title?: string;
	subtitle?: string;
	variant: 'neutral' | 'charged' | 'metered';
	children?: ReactNode;
	fillHeight?: boolean;
	/** Optional control aligned to the top-right of the header (e.g. factor input). */
	headerEnd?: ReactNode;
	/** `subtitle` places the control on the same row as the hint, not the title. */
	headerEndBeside?: 'title' | 'subtitle';
}) {
	const showHeader = Boolean(title || subtitle || headerEnd);
	const showBody = children != null && children !== false;
	const end = headerEnd ? <div className="shrink-0">{headerEnd}</div> : null;
	return (
		<section
			className={`${routePricePanelShell[variant]}${fillHeight ? ' flex h-full min-h-0 min-w-0 flex-col' : ''}`}
		>
			{showHeader ? (
				<header className={`shrink-0 ${showBody ? `pb-2.5 mb-3 ${routePricePanelHeaderBorder[variant]}` : ''}`}>
					{headerEndBeside === 'subtitle' ? (
						<div>
							{title ? (
								<h4 className="text-xs font-semibold tracking-wide text-gray-800">{title}</h4>
							) : null}
							{subtitle || end ? (
								<div className={`flex items-start justify-between gap-2${title ? ' mt-1' : ''}`}>
									{subtitle ? (
										<p className="min-w-0 flex-1 text-[11px] leading-snug text-gray-500">{subtitle}</p>
									) : (
										<span className="min-w-0 flex-1" />
									)}
									{end}
								</div>
							) : null}
						</div>
					) : (
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								{title ? (
									<h4 className="text-xs font-semibold tracking-wide text-gray-800">{title}</h4>
								) : null}
								{subtitle ? (
									<p className={`text-[11px] leading-snug text-gray-500${title ? ' mt-1' : ''}`}>
										{subtitle}
									</p>
								) : null}
							</div>
							{end}
						</div>
					)}
				</header>
			) : null}
			{showBody ? (
				fillHeight ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children
			) : null}
		</section>
	);
}
