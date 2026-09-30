'use client';

import { useMemo } from 'react';
import { ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useLocale, useNow, useTranslations } from 'next-intl';
import {
	isProviderFactorActive,
	normalizeScheduleFactor,
	parseRouteBaseFactors,
	resolveDailyScheduleFactor,
	resolveProviderFactorValidity,
} from '@octafuse/core/db/pricing-schedule';
import { useBusinessTimezone } from '@/components/BusinessTimezoneProvider';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import {
	factorChipClassForValue,
	formatFactorMultiplier,
	formatFactorMultiplierForChip,
	formatScheduleRange,
	hasBasePricingInversion,
	resolveRouteScheduleDisplay,
} from '../route-utils';

/** One line per period; factors are relative to that period's catalog prices. */
export function RouteTargetPricing({
	priceOverride,
	onEdit,
}: {
	priceOverride: string | null | undefined;
	onEdit: () => void;
}) {
	const t = useTranslations('routes.flow');
	const modal = useTranslations('routes.modal');
	const list = useTranslations('routes.listItem');
	const locale = useLocale();
	const timezone = useBusinessTimezone();
	const now = useNow({ updateInterval: 1000 });
	const bases = useMemo(() => parseRouteBaseFactors(priceOverride ?? null), [priceOverride]);
	const windows = useMemo(() => resolveRouteScheduleDisplay(priceOverride), [priceOverride]);
	const periods = useMemo(() => windows.map((window, index) => ({
		start: window.start,
		end: window.end,
		days: window.days,
		factor: index + 1,
	})), [windows]);
	const current = resolveDailyScheduleFactor(periods, now, timezone).window;
	const currentIndex = current ? current.factor - 1 : -1;
	const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
	const dateFormatter = new Intl.DateTimeFormat(locale, {
		timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	});
	const formatDays = (days?: number[]) => {
		const sorted = [...new Set(days ?? [])].sort((a, b) => a - b);
		if (!sorted.length || sorted.length === 7) return modal('scheduleEveryday');
		if (sorted.join(',') === '1,2,3,4,5') return modal('scheduleWeekdays');
		if (sorted.join(',') === '6,7') return modal('scheduleWeekend');
		const groups: number[][] = [];
		for (const day of sorted) {
			const previous = groups[groups.length - 1];
			if (previous && previous[previous.length - 1] + 1 === day) previous.push(day);
			else groups.push([day]);
		}
		const label = (day: number) => weekdayFormatter.format(new Date(Date.UTC(2026, 0, 4 + day)));
		return groups.map(group => group.length > 1 ? `${label(group[0])}–${label(group[group.length - 1])}` : label(group[0])).join('/');
	};
	const columns = 'col-span-3 grid grid-cols-subgrid items-center';
	const help = t('effectivePricing.help', { timezone });
	const baseProvider = isProviderFactorActive(bases, now) ? bases.providerFactor : 1;
	const baseInversion = hasBasePricingInversion(
		normalizeScheduleFactor(baseProvider * bases.chargedFactor),
		normalizeScheduleFactor(baseProvider * bases.meteredFactor),
	);

	return (
		<div className="overflow-x-auto border-t border-slate-100 px-3 py-2">
			<div className="grid min-w-0 grid-cols-[minmax(max-content,1fr)_minmax(max-content,4.25rem)_minmax(max-content,4.25rem)] gap-x-1">
				<div className={`${columns} pb-1.5 text-[10px] leading-4 text-slate-500`}>
					<span className="inline-flex items-center gap-1"><ClockIcon className="h-3 w-3" aria-hidden />{t('pricingPeriod')}</span>
					{(['charged', 'metered'] as const).map(side => (
						<span key={side} className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
							{t(`effectivePricing.${side}`)}
							<InfoHintPopover label={t(`effectivePricing.${side}`)} openOnHover portal>
								<p className="whitespace-pre-line leading-6">{help}</p>
							</InfoHintPopover>
						</span>
					))}
				</div>
				{[null, ...windows].map((window, position) => {
					const validity = resolveProviderFactorValidity(bases, window ? {
						start: window.start, end: window.end, factor: window.provider_factor,
						...(window.provider_validity !== undefined ? { validity: window.provider_validity } : {}),
					} : null);
					const active = isProviderFactorActive(validity, now);
					const provider = window?.provider_factor ?? bases.providerFactor;
					const effectiveProvider = active ? provider : 1;
					const timing = validity.providerWindowInvalid ? t('effectivePricing.invalidValidity')
						: t(`providerFactorTiming.${active ? 'active' : validity.providerStartsAt && Date.parse(validity.providerStartsAt) > now.getTime() ? 'scheduled' : 'expired'}`);
					const period = window ? `${formatScheduleRange(window.start, window.end)} ${formatDays(window.days)}`
						: modal(windows.length ? 'editor.otherPeriods' : 'editor.allPeriods');
					const isCurrent = windows.length > 0 && currentIndex === position - 1;
					const providerInfo = [
						t('providerFactorBadge', { value: formatFactorMultiplier(provider), status: timing }),
						validity.providerStartsAt ? `${modal('providerFactorStarts')}: ${dateFormatter.format(new Date(validity.providerStartsAt))} (${timezone})` : '',
						validity.providerExpiresAt ? `${modal('providerFactorExpires')}: ${dateFormatter.format(new Date(validity.providerExpiresAt))} (${timezone})` : '',
						!active ? t('effectivePricing.inactiveProvider') : '',
					].filter(Boolean).join('\n');
					const factors = (['charged', 'metered'] as const).map(side => {
						const configured = side === 'charged' ? window?.charged_factor ?? bases.chargedFactor : window?.metered_factor ?? bases.meteredFactor;
						const effective = normalizeScheduleFactor(effectiveProvider * configured);
						const formula = t(`effectivePricing.${side}Formula`, {
							provider: formatFactorMultiplier(effectiveProvider), configured: formatFactorMultiplier(configured), effective: formatFactorMultiplier(effective),
						});
						return { side, effective, tooltip: `${period}\n${formula}\n${providerInfo}` };
					});
					return (
						<button
							key={position}
							type="button"
							onClick={onEdit}
							className={`${columns} w-full min-h-8 border-t border-dashed border-slate-100 py-1 text-left text-[11px] transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500`}
							aria-label={`${t('editRoute')} · ${period} · ${factors.map(factor => factor.tooltip).join(' · ')}`}
							title={factors.map(factor => factor.tooltip).join('\n\n')}
						>
							<span className="flex items-center gap-1 whitespace-nowrap text-slate-600">
								<span className="tabular-nums">{window ? formatScheduleRange(window.start, window.end) : period}</span>
								{window && <span className="text-[10px] text-slate-500">{formatDays(window.days)}</span>}
								{isCurrent && <span className="rounded bg-blue-50 px-1 text-[9px] font-medium leading-4 text-blue-600">{modal('catalogScheduleNow')}</span>}
							</span>
							{factors.map(({ side, effective, tooltip }) => (
								<span key={side} className="inline-flex items-center justify-self-end gap-1" title={tooltip} aria-label={tooltip}>
									{!active && <ClockIcon className="h-3 w-3 text-amber-500" aria-hidden />}
									<span className={factorChipClassForValue(effective, side)}>{formatFactorMultiplierForChip(effective)}</span>
								</span>
							))}
						</button>
					);
				})}
				{baseInversion && (
					<span className="col-span-3 mt-1 flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800" title={list('baseInversionTooltip')}>
						<ExclamationTriangleIcon className="h-3 w-3 shrink-0" aria-hidden />
						{list('baseInversionBadge')}
					</span>
				)}
			</div>
		</div>
	);
}
