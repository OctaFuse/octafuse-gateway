'use client';

import { useTranslations } from 'next-intl';
import { isEveryIsoWeekday, type DailyScheduleWindow } from '@octafuse/core/db/pricing-schedule';
import { getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import type { CatalogPricingTierDisplayRow } from '@/lib/pricing-ui';

export type CatalogPeriodPrices = {
	window: DailyScheduleWindow | null;
	rows: CatalogPricingTierDisplayRow[];
	active: boolean;
};

/** One flat catalog table: default period and scheduled prices share columns and units. */
export function RouteCatalogPricingTable({
	periods,
	billingCurrency,
	emptyLabel,
	showPrices = true,
}: {
	periods: CatalogPeriodPrices[];
	billingCurrency: string;
	emptyLabel: string;
	showPrices?: boolean;
}) {
	const t = useTranslations('routes.modal');
	const prices = useTranslations('pricing.readOnlyTable');
	const common = useTranslations('common');
	const weekdays = [
		t('weekdayMon'),
		t('weekdayTue'),
		t('weekdayWed'),
		t('weekdayThu'),
		t('weekdayFri'),
		t('weekdaySat'),
		t('weekdaySun'),
	];
	const daySummary = (days: number[] = []) =>
		isEveryIsoWeekday(days)
			? t('scheduleEveryday')
			: days.join(',') === '1,2,3,4,5'
			? t('scheduleWeekdays')
			: days.join(',') === '6,7'
			? t('scheduleWeekend')
			: days.map((day) => weekdays[day - 1]).join(' ');
	const showRange =
		showPrices &&
		periods.some(({ rows }) => rows.length > 1 || rows.some((row) => row.rangeLine !== '[0, ∞)'));
	const hasSchedule = periods.length > 1;
	const dash = common('noData');
	if (showPrices && !periods.some(({ rows }) => rows.length)) {
		return <p className="py-3 text-sm text-slate-500">{emptyLabel}</p>;
	}

	return (
		<div>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-xs" aria-label={t('standardCatalog')}>
					<thead className="border-b border-slate-200 text-slate-500">
						<tr>
							<th scope="col" className="pb-3 pr-3 font-medium">
								{t('editor.period')}
							</th>
							{showRange && (
								<th scope="col" className="whitespace-nowrap px-2 pb-3 font-medium">
									{prices('inputRange')}
								</th>
							)}
							{showPrices &&
								(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key) => (
									<th key={key} scope="col" className="whitespace-nowrap pb-3 pl-3 text-right font-medium">
										{prices(key)}
									</th>
								))}
						</tr>
					</thead>
					{periods.map(({ window, rows, active }, periodIndex) => {
						const label = window
							? `${window.start}–${window.end}`
							: t(hasSchedule ? 'editor.otherPeriods' : 'editor.allPeriods');
						const entries = showPrices ? rows : [null];
						return (
							<tbody key={periodIndex} className="border-b border-slate-200 last:border-b-0">
								{entries.map((row, index) => {
									const [input = dash, output = dash] =
										row?.inputOutputLine.split('/').map((part) => part.trim()) ?? [];
									const [cacheRead = dash, cacheWrite = dash] =
										row?.cacheLine?.split('/').map((part) => part.trim()) ?? [];
									return (
										<tr key={index} className={index ? 'border-t border-slate-100' : ''}>
											{index === 0 && (
												<>
													<th
														scope="rowgroup"
														rowSpan={entries.length}
														className="py-4 pr-3 align-top font-normal"
													>
														<p
															className={`whitespace-nowrap text-slate-800 ${
																window ? 'font-mono text-[11px] tabular-nums' : 'font-medium'
															}`}
														>
															{label}
														</p>
														<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-slate-500">
															{window && <span>{daySummary(window.days)}</span>}
															{window && window.factor !== 1 && (
																<span
																	className="inline-flex items-center rounded bg-violet-50 px-1.5 font-mono tabular-nums text-violet-700"
																	title={`${t('editor.catalogFactor')} ×${window.factor}`}
																>
																	×{window.factor}
																</span>
															)}
															{active && hasSchedule && (
																<span className="inline-flex items-center gap-1 text-blue-600">
																	<span className="h-1 w-1 rounded-full bg-blue-500" aria-hidden />
																	{t('catalogScheduleNow')}
																</span>
															)}
														</div>
													</th>
												</>
											)}
											{showRange && (
												<td className="whitespace-nowrap px-2 py-4 font-mono text-[11px] tabular-nums text-slate-500">
													{row?.rangeLine}
												</td>
											)}
											{showPrices &&
												[input, output, cacheRead, cacheWrite].map((value, column) => (
													<td
														key={column}
														className={`whitespace-nowrap py-4 pl-3 text-right align-top font-mono tabular-nums ${
															value === dash ? 'text-slate-400' : 'text-slate-800'
														}`}
													>
														{value}
													</td>
												))}
										</tr>
									);
								})}
							</tbody>
						);
					})}
				</table>
			</div>
			{showPrices && (
				<p className="border-t border-slate-200 pt-3 text-[11px] leading-5 text-slate-500">
					{prices('unitFooter', {
						unit: prices('unitPerMillion', {
							symbol: getGatewayCurrencySymbol(billingCurrency.trim().toUpperCase()),
						}),
					})}
					{hasSchedule && <span className="block">{t('editor.catalogPricesHint')}</span>}
				</p>
			)}
		</div>
	);
}
