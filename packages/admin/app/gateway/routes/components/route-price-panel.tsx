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
}: {
	title: string;
	subtitle?: string;
	variant: 'neutral' | 'charged' | 'metered';
	children: ReactNode;
	fillHeight?: boolean;
	/** Optional control aligned to the top-right of the header (e.g. factor input). */
	headerEnd?: ReactNode;
}) {
	return (
		<section
			className={`${routePricePanelShell[variant]}${fillHeight ? ' flex h-full min-h-0 min-w-0 flex-col' : ''}`}
		>
			<header className={`shrink-0 pb-2.5 mb-3 ${routePricePanelHeaderBorder[variant]}`}>
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<h4 className="text-xs font-semibold uppercase tracking-wide text-gray-800">{title}</h4>
						{subtitle ? (
							<p className="mt-1 text-[11px] leading-snug text-gray-500">{subtitle}</p>
						) : null}
					</div>
					{headerEnd ? <div className="shrink-0 pt-0.5">{headerEnd}</div> : null}
				</div>
			</header>
			{fillHeight ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
		</section>
	);
}
