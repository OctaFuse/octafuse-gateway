'use client';

import { UsersIcon } from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';

export function RouteStickyUsage({
	enabled,
	count,
	total,
	routeAvailable,
}: {
	enabled: boolean;
	count: number | null;
	total: number | null;
	routeAvailable: boolean;
}) {
	const t = useTranslations('routes.flow.stickyUsage');
	const locale = useLocale();
	const hasBindings = enabled && count != null && count > 0;
	const share = enabled && count != null && total != null && total > 0 ? Math.min(1, count / total) : 0;
	const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(share);
	const tone = hasBindings
		? routeAvailable ? 'bg-indigo-50 text-indigo-700 ring-indigo-100' : 'bg-amber-50 text-amber-800 ring-amber-200'
		: 'bg-slate-50 text-slate-500 ring-slate-200/70';
	const exactCount = count == null ? '—' : new Intl.NumberFormat(locale).format(count);
	const displayCount = count == null ? '—' : new Intl.NumberFormat(locale, {
		notation: count >= 10000 ? 'compact' : 'standard',
		maximumFractionDigits: 1,
	}).format(count);
	const description = !enabled ? t('offTooltip') : [
		`${t('label')}: ${exactCount}`,
		count == null ? t('unavailable') : t('share', { percent }),
		hasBindings && !routeAvailable ? t('retained') : '',
		t('tooltip'),
	].filter(Boolean).join(' · ');

	return (
		<div className={`inline-flex h-7 min-w-12 shrink-0 items-center justify-center gap-1 rounded-md px-2 ring-1 ring-inset ${tone}`} title={description} aria-label={description}>
			<UsersIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
			<span className="text-sm font-semibold tabular-nums">{enabled ? displayCount : '—'}</span>
		</div>
	);
}
