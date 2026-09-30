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
	const baseProvider = isProviderFactorActive(bases, now) ? bases.providerFactor : 1;
	const baseInversion = hasBasePricingInversion(
		normalizeScheduleFactor(baseProvider * bases.chargedFactor),
		normalizeScheduleFactor(baseProvider * bases.meteredFactor),
	);

	return (
		<div className="overflow-x-auto border-t border-slate-100 px-2.5 py-1.5">
			<div className="grid min-w-0 grid-cols-[minmax(max-content,1fr)_minmax(max-content,3.25rem)_minmax(max-content,3.25rem)] gap-x-1">
				<div className={`${columns} pb-1.5 text-[10px] leading-4 text-slate-500`}>
					<span className="inline-flex items-center gap-1">
						<ClockIcon className="h-3 w-3" aria-hidden />{t('pricingPeriod')}
						<InfoHintPopover label={t('effectivePricing.guide.title')} openOnHover portal align="start">
							<h4 className="mb-3 text-sm font-semibold text-slate-900">{t('effectivePricing.guide.title')}</h4>
							<dl className="space-y-3 text-xs leading-5">
								<div>
									<dt className="font-semibold text-slate-800">{t('effectivePricing.guide.periodTitle')}</dt>
									<dd className="mt-1 space-y-1">
										<p>{t('effectivePricing.guide.periodBody')}</p>
										<p>{t('effectivePricing.guide.currentBody')}</p>
										<p className="text-[11px] text-slate-500">{t('effectivePricing.guide.timezone', { timezone })}</p>
									</dd>
								</div>
								<div className="border-t border-slate-100 pt-3">
									<dt className="font-semibold text-slate-800">{t('effectivePricing.guide.factorTitle')}</dt>
									<dd className="mt-1 space-y-1">
										<p>{t('effectivePricing.guide.factorBody')}</p>
										<p className="flex items-start gap-1.5 text-violet-700"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" aria-hidden />{t('effectivePricing.breakdown.marker')}</p>
										<p className="text-blue-700">{t('effectivePricing.guide.chargedFormula')}</p>
										<p className="text-emerald-700">{t('effectivePricing.guide.meteredFormula')}</p>
									</dd>
								</div>
								<div className="border-t border-slate-100 pt-3">
									<dt className="font-semibold text-slate-800">{t('effectivePricing.guide.validityTitle')}</dt>
									<dd className="mt-1">{t('effectivePricing.guide.validityBody')}</dd>
								</div>
								<div className="border-t border-slate-100 pt-3">
									<dt className="font-semibold text-slate-800">{t('effectivePricing.guide.scopeTitle')}</dt>
									<dd className="mt-1">{t('effectivePricing.guide.scopeBody')}</dd>
								</div>
							</dl>
							<p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-5 text-slate-500">{t('effectivePricing.guide.hint')}</p>
						</InfoHintPopover>
					</span>
					{(['charged', 'metered'] as const).map(side => (
						<span key={side} className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
							{t(`effectivePricing.${side}`)}
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
					const providerApplied = active && provider !== 1;
					const providerStatus = t(`effectivePricing.breakdown.${!active ? 'notApplied' : providerApplied ? 'applied' : 'standard'}`);
					const validityInfo = [
						validity.providerStartsAt ? `${modal('providerFactorStarts')}: ${dateFormatter.format(new Date(validity.providerStartsAt))}` : '',
						validity.providerExpiresAt ? `${modal('providerFactorExpires')}: ${dateFormatter.format(new Date(validity.providerExpiresAt))}` : '',
					].filter(Boolean);
					const factors = (['charged', 'metered'] as const).map(side => {
						const configured = side === 'charged' ? window?.charged_factor ?? bases.chargedFactor : window?.metered_factor ?? bases.meteredFactor;
						const effective = normalizeScheduleFactor(effectiveProvider * configured);
						const formula = t(`effectivePricing.${side}Formula`, {
							provider: formatFactorMultiplier(effectiveProvider), configured: formatFactorMultiplier(configured), effective: formatFactorMultiplier(effective),
						});
						return { side, effective, configured, tooltip: `${period} · ${providerStatus} · ${formula}` };
					});
					return (
						<div key={position} className={`${columns} w-full min-h-8 border-t border-dashed border-slate-100 py-1 text-left text-[11px] transition hover:bg-slate-50`}>
							<button
								type="button"
								onClick={onEdit}
								className="flex items-center gap-1 whitespace-nowrap rounded text-left text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
								title={t('editRoute')}
								aria-label={`${t('editRoute')} · ${period}`}
							>
								<span className="tabular-nums">{window ? formatScheduleRange(window.start, window.end) : period}</span>
								{window && <span className="text-[10px] text-slate-500">{formatDays(window.days)}</span>}
								{isCurrent && <span className="rounded bg-blue-50 px-1 text-[9px] font-medium leading-4 text-blue-600">{modal('catalogScheduleNow')}</span>}
							</button>
							{factors.map(({ side, effective, configured, tooltip }) => (
								<span key={side} className="inline-flex justify-self-end">
									<InfoHintPopover label={tooltip} openOnHover portal icon={
										<span className="inline-flex items-center gap-1">
											{!active && <ClockIcon className="h-3 w-3 text-amber-500" aria-hidden />}
											<span className={`relative ${factorChipClassForValue(effective, side)}`}>
												{formatFactorMultiplierForChip(effective)}
												{providerApplied && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-violet-500 ring-1 ring-white" aria-hidden />}
											</span>
										</span>
									}>
										<p className="font-semibold text-slate-900">{t(`effectivePricing.${side}`)}</p>
										<p className="mt-1 text-[11px] text-slate-500">{period}</p>
										<p className={`mt-2 flex items-center gap-1.5 text-[11px] ${!active ? 'text-amber-700' : providerApplied ? 'text-violet-700' : 'text-slate-500'}`}>
											{providerApplied && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-hidden />}
											{providerStatus}
										</p>
										<dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
											<div className="flex justify-between gap-3"><dt>{modal('providerFactor')}</dt><dd className="text-right tabular-nums">{formatFactorMultiplier(provider)} · {timing}</dd></div>
											<div className="flex justify-between gap-3"><dt>{modal(side === 'charged' ? 'editor.chargedFactorLabel' : 'editor.meteredFactorLabel')}</dt><dd className="font-mono tabular-nums">{formatFactorMultiplier(configured)}</dd></div>
										</dl>
										{!active && <p className="mt-2 text-[11px] leading-5 text-amber-700">{t('effectivePricing.inactiveProvider')}</p>}
										<p className="mt-3 rounded bg-slate-50 px-2 py-2 font-mono text-sm font-semibold tabular-nums text-slate-900">{effectiveProvider} × {configured} = {effective}</p>
										<div className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-5 text-slate-500">
											<p className="font-medium text-slate-700">{t('effectivePricing.breakdown.validity')}</p>
											{validity.providerWindowInvalid ? <p>{t('effectivePricing.invalidValidity')}</p> : validityInfo.length ? validityInfo.map(line => <p key={line}>{line}</p>) : <p>{t('effectivePricing.breakdown.unlimited')}</p>}
											{validityInfo.length > 0 && <p>{t('effectivePricing.guide.timezone', { timezone })}</p>}
											<p className="mt-2">{t('effectivePricing.breakdown.basis')}</p>
										</div>
									</InfoHintPopover>
								</span>
							))}
						</div>
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
