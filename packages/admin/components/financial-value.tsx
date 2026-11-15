'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';
import { getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';

/** Keep the caller's precision and pricing semantics; this component only styles the value. */
export function MultiplierBadge({
	children,
	title,
	compact = false,
}: {
	children: ReactNode;
	title?: string;
	compact?: boolean;
}) {
	return (
		<span
			title={title}
			className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-md bg-blue-50 px-1.5 font-mono font-medium tabular-nums text-blue-700 ${
				compact ? 'text-[10px] leading-4' : 'text-xs leading-5'
			}`}
		>
			{children}
		</span>
	);
}

/** Currency and multipliers have distinct prefixes, without changing input validation or values. */
export function FinancialInput({
	kind = 'amount',
	currency,
	compact = false,
	className = '',
	...props
}: InputHTMLAttributes<HTMLInputElement> & {
	kind?: 'amount' | 'factor';
	currency?: string;
	compact?: boolean;
}) {
	const factor = kind === 'factor';
	const muted = props.disabled || props.readOnly;
	return (
		<div className="relative min-w-0">
			<span
				aria-hidden
				className={`pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-md font-mono font-medium ${
					compact ? 'h-6 w-6 text-sm' : 'h-8 w-8 text-base'
				} ${factor && !muted ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
			>
				{factor ? '×' : currency ? getGatewayCurrencySymbol(currency) : ''}
			</span>
			<input
				type="text"
				inputMode="decimal"
				{...props}
				className={`w-full min-w-0 rounded-lg border border-gray-200 bg-white pr-3 font-mono font-medium tabular-nums outline-none transition placeholder:text-gray-400 hover:border-gray-300 focus:border-gray-500 focus:ring-2 focus:ring-gray-500/10 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 read-only:bg-gray-100 read-only:text-gray-500 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
					compact ? 'h-9 pl-9 text-sm' : 'h-10 pl-12 text-base'
				} ${factor ? 'text-blue-700' : 'text-gray-900'} ${className}`}
			/>
		</div>
	);
}
