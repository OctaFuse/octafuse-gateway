'use client';

import { UsersIcon } from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';

export function RouteStickyUsage({
	compact = false,
	enabled,
	count,
	total,
	routeAvailable,
	providerName,
	onClick,
}: {
	compact?: boolean;
	enabled: boolean;
	count: number | null;
	total: number | null;
	routeAvailable: boolean;
	providerName: string;
	onClick?: () => void;
}) {
	const t = useTranslations('routes.flow.stickyUsage');
	const locale = useLocale();
	const hasBindings = enabled && count != null && count > 0;
	const share =
		enabled && count != null && total != null && total > 0 ? Math.min(1, count / total) : 0;
	const percent = new Intl.NumberFormat(locale, {
		style: 'percent',
		maximumFractionDigits: 1,
	}).format(share);
	const tone = hasBindings
		? routeAvailable
			? 'bg-indigo-50 text-indigo-700 ring-indigo-100'
			: 'bg-amber-50 text-amber-800 ring-amber-200'
		: 'bg-slate-50 text-slate-500 ring-slate-200/70';
	const exactCount = count == null ? '—' : new Intl.NumberFormat(locale).format(count);
	const displayCount =
		count == null
			? '—'
			: new Intl.NumberFormat(locale, {
					notation: count >= 10000 ? 'compact' : 'standard',
					maximumFractionDigits: 1,
			  }).format(count);
	const description = !enabled
		? t('offTooltip')
		: [
				`${t('label')}: ${exactCount}`,
				count == null ? t('unavailable') : t('share', { percent }),
				hasBindings && !routeAvailable ? t('retained') : '',
				t('tooltip'),
		  ]
				.filter(Boolean)
				.join(' · ');

	const clickable = enabled && count != null && Boolean(onClick);
	const label = clickable
		? `${t('openDetails', { provider: providerName })} · ${description}`
		: description;
	const className = `inline-flex shrink-0 items-center justify-center gap-1 ${
		compact
			? hasBindings
				? routeAvailable
					? 'text-indigo-700'
					: 'text-amber-800'
				: routeAvailable
				? 'text-slate-800'
				: 'text-slate-600'
			: `h-7 min-w-12 rounded-md px-2 ring-1 ring-inset ${tone}`
	} ${
		clickable
			? 'min-h-7 min-w-8 cursor-pointer rounded-md underline decoration-indigo-300 underline-offset-2 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
			: ''
	}`;
	const content = (
		<>
			{!compact ? <UsersIcon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
			<span
				className={`${
					compact
						? enabled && count != null
							? 'text-sm font-bold'
							: 'text-xs font-medium text-slate-400'
						: 'text-sm font-semibold'
				} tabular-nums`}
			>
				{enabled ? displayCount : '—'}
			</span>
		</>
	);
	return clickable ? (
		<button
			type="button"
			onClick={onClick}
			aria-haspopup="dialog"
			className={className}
			title={label}
			aria-label={label}
		>
			{content}
		</button>
	) : (
		<div className={className} title={description} aria-label={description}>
			{content}
		</div>
	);
}
