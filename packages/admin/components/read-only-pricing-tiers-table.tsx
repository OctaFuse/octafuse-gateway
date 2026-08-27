'use client';

import { useTranslations } from 'next-intl';
import { getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import type { CatalogPricingTierDisplayRow } from '@/lib/pricing-ui';

export type ReadOnlyPricingTiersTableProps = {
	rows: CatalogPricingTierDisplayRow[];
	emptyLabel: string;
	/** 表格 `title`：整表悬停说明 */
	tableTitle?: string;
	/** ISO 4217，与网关 `BILLING_CURRENCY` 一致 */
	billingCurrencyCode?: string;
	/** 撑满父级高度，页脚贴底 */
	fillHeight?: boolean;
};

/**
 * 路由弹窗「标准价 / 用户价」只读阶梯表：与目录 `pricing_profile` 顺序一致。
 */
export function ReadOnlyPricingTiersTable({
	rows,
	emptyLabel,
	tableTitle,
	billingCurrencyCode = 'USD',
	fillHeight = false,
}: ReadOnlyPricingTiersTableProps) {
	const t = useTranslations('pricing.readOnlyTable');
	const tCommon = useTranslations('common');
	const billCode = billingCurrencyCode.trim().toUpperCase();
	const unitLabel = t('unitPerMillion', { symbol: getGatewayCurrencySymbol(billCode) });
	const dash = tCommon('noData');
	if (rows.length === 0) {
		return (
			<p className={`rounded-md border border-dashed border-gray-200 bg-white/80 px-2 py-3 text-center text-[11px] leading-snug text-gray-500${fillHeight ? ' flex h-full min-h-0 items-center justify-center' : ''}`}>
				{emptyLabel}
			</p>
		);
	}
	return (
		<div
			className={`overflow-hidden rounded-md border border-gray-200 bg-white${
				fillHeight ? ' flex h-full min-h-0 flex-col' : ''
			}`}
		>
			<div className={`overflow-x-auto${fillHeight ? ' min-h-0 flex-1' : ''}`}>
				<table
					className="min-w-full divide-y divide-gray-200 text-left text-[11px]"
					title={tableTitle}
				>
					<thead className="bg-gray-50 text-[10px] font-semibold tracking-wide text-gray-500">
						<tr>
							<th className="whitespace-nowrap px-3 py-2">{t('inputRange')}</th>
							<th className="whitespace-nowrap px-3 py-2 text-right">{t('input')}</th>
							<th className="whitespace-nowrap px-3 py-2 text-right">{t('output')}</th>
							<th className="whitespace-nowrap px-3 py-2 text-right">{t('cacheRead')}</th>
							<th className="whitespace-nowrap px-3 py-2 text-right">{t('cacheWrite')}</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-100 text-gray-800">
						{rows.map((r, i) => {
							const [inputPriceLine = dash, outputPriceLine = dash] = r.inputOutputLine
								.split('/')
								.map((part) => part.trim());
							const [cacheReadPriceLine = dash, cacheWritePriceLine = dash] = (r.cacheLine ?? `${dash} / ${dash}`)
								.split('/')
								.map((part) => part.trim());
							return (
								<tr key={`${r.rangeLine}-${i}`} className="align-top odd:bg-white even:bg-gray-50/40">
									<td className="whitespace-nowrap px-3 py-2 font-mono font-medium tabular-nums text-gray-900">
										{r.rangeLine}
									</td>
									<td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-gray-800">
										{inputPriceLine}
									</td>
									<td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-gray-800">
										{outputPriceLine}
									</td>
									<td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-gray-800">
										{cacheReadPriceLine === dash ? (
											<span className="text-gray-400">{dash}</span>
										) : (
											cacheReadPriceLine
										)}
									</td>
									<td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-gray-800">
										{cacheWritePriceLine === dash ? (
											<span className="text-gray-400">{dash}</span>
										) : (
											cacheWritePriceLine
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<p className="shrink-0 border-t border-gray-100 bg-gray-50/90 px-2 py-1 text-[10px] leading-snug text-gray-500">
				{t('unitFooter', { unit: unitLabel })}
			</p>
		</div>
	);
}
