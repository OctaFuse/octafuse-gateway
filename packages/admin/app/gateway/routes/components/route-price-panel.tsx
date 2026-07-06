'use client';

import type { ReactNode } from 'react';
import { routePricePanelHeaderBorder, routePricePanelShell } from '../types';

export function RoutePricePanel({
	title,
	subtitle,
	variant,
	children,
	fillHeight = false,
}: {
	title: string;
	subtitle: string;
	variant: 'neutral' | 'charged' | 'metered';
	children: ReactNode;
	fillHeight?: boolean;
}) {
	return (
		<section
			className={`${routePricePanelShell[variant]}${fillHeight ? ' flex h-full min-h-0 min-w-0 flex-col' : ''}`}
		>
			<header className={`shrink-0 pb-3 mb-4 ${routePricePanelHeaderBorder[variant]}`}>
				<h4 className="text-xs font-semibold uppercase tracking-wide text-gray-800">{title}</h4>
				<p className="mt-1.5 text-xs leading-relaxed text-gray-600">{subtitle}</p>
			</header>
			{fillHeight ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
		</section>
	);
}
