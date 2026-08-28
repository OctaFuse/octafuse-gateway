'use client';

import { useTranslations } from 'next-intl';
import { getUserChargedCatalogTierRows, type CatalogPricingTierDisplayRow } from '@/lib/pricing-ui';
import type { GatewayModel } from '@/lib/types';

function parseNonNegativeFactor(text: string): number | null {
	const n = Number(text.trim());
	return Number.isFinite(n) && n >= 0 ? n : null;
}

function splitPricePair(line: string | null | undefined, dash: string): [string, string] {
	const [left = dash, right = dash] = (line ?? `${dash} / ${dash}`).split('/').map((part) => part.trim());
	return [left, right];
}

function PriceCell({ value, dash }: { value: string; dash: string }) {
	if (value === dash) {
		return <span className="text-gray-400">{dash}</span>;
	}
	return <>{value}</>;
}

function SideRows({
	sideLabel,
	sideClass,
	rows,
	dash,
	showRange,
}: {
	sideLabel: string;
	sideClass: string;
	rows: CatalogPricingTierDisplayRow[];
	dash: string;
	showRange: boolean;
}) {
	if (rows.length === 0) {
		return (
			<tr>
				<td className={`whitespace-nowrap px-2 py-1 font-medium ${sideClass}`}>{sideLabel}</td>
				{showRange ? <td className="px-2 py-1 text-gray-400">{dash}</td> : null}
				<td className="px-2 py-1 text-right text-gray-400">{dash}</td>
				<td className="px-2 py-1 text-right text-gray-400">{dash}</td>
				<td className="px-2 py-1 text-right text-gray-400">{dash}</td>
				<td className="px-2 py-1 text-right text-gray-400">{dash}</td>
			</tr>
		);
	}
	return (
		<>
			{rows.map((r, i) => {
				const [inputPrice, outputPrice] = splitPricePair(r.inputOutputLine, dash);
				const [cacheRead, cacheWrite] = splitPricePair(r.cacheLine, dash);
				return (
					<tr key={`${sideLabel}-${r.rangeLine}-${i}`} className="align-top">
						<td className={`whitespace-nowrap px-2 py-1 font-medium ${sideClass}`}>
							{i === 0 ? sideLabel : ''}
						</td>
						{showRange ? (
							<td className="whitespace-nowrap px-2 py-1 font-mono tabular-nums text-gray-700">
								{r.rangeLine}
							</td>
						) : null}
						<td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums text-gray-800">
							<PriceCell dash={dash} value={inputPrice} />
						</td>
						<td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums text-gray-800">
							<PriceCell dash={dash} value={outputPrice} />
						</td>
						<td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums text-gray-800">
							<PriceCell dash={dash} value={cacheRead} />
						</td>
						<td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums text-gray-800">
							<PriceCell dash={dash} value={cacheWrite} />
						</td>
					</tr>
				);
			})}
		</>
	);
}

export function ScheduleWindowEffectivePrices({
	model,
	catalogFactor,
	chargedFactorText,
	meteredFactorText,
	billingCurrency,
}: {
	model: GatewayModel;
	catalogFactor: number;
	chargedFactorText: string;
	meteredFactorText: string;
	billingCurrency: string;
}) {
	const t = useTranslations('routes.modal');
	const tTable = useTranslations('pricing.readOnlyTable');
	const tCommon = useTranslations('common');
	const dash = tCommon('noData');
	const official = Number.isFinite(catalogFactor) && catalogFactor > 0 ? catalogFactor : 1;
	const charged = parseNonNegativeFactor(chargedFactorText);
	const metered = parseNonNegativeFactor(meteredFactorText);
	const chargedRows = getUserChargedCatalogTierRows(
		model,
		charged == null ? null : official * charged,
		billingCurrency,
	);
	const meteredRows = getUserChargedCatalogTierRows(
		model,
		metered == null ? null : official * metered,
		billingCurrency,
	);
	const showRange = chargedRows.length > 1 || meteredRows.length > 1;

	return (
		<div className="overflow-hidden rounded border border-gray-200 bg-white">
			<table className="min-w-full text-left text-[10px]">
				<thead className="bg-gray-50 text-[10px] font-semibold tracking-wide text-gray-500">
					<tr>
						<th className="whitespace-nowrap px-2 py-1">{t('scheduleWindowPricesSide')}</th>
						{showRange ? (
							<th className="whitespace-nowrap px-2 py-1">{tTable('inputRange')}</th>
						) : null}
						<th className="whitespace-nowrap px-2 py-1 text-right">{tTable('input')}</th>
						<th className="whitespace-nowrap px-2 py-1 text-right">{tTable('output')}</th>
						<th className="whitespace-nowrap px-2 py-1 text-right">{tTable('cacheRead')}</th>
						<th className="whitespace-nowrap px-2 py-1 text-right">{tTable('cacheWrite')}</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-100">
					<SideRows
						dash={dash}
						rows={chargedRows}
						showRange={showRange}
						sideClass="text-blue-800"
						sideLabel={t('chargedCost')}
					/>
					<SideRows
						dash={dash}
						rows={meteredRows}
						showRange={showRange}
						sideClass="text-emerald-800"
						sideLabel={t('meteredCost')}
					/>
				</tbody>
			</table>
			<p className="border-t border-gray-100 bg-gray-50/90 px-2 py-1 text-[10px] leading-snug text-gray-500">
				{t('scheduleWindowPricesHint')}
			</p>
		</div>
	);
}
