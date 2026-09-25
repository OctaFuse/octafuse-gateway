'use client';

import { useTranslations } from 'next-intl';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';

type Totals = { standard: number; charged: number; metered: number };

/** Model/User Usage 页顶栏：Range total Std / Charged / Metered */
export function AnalyticsRangeCostTotals(props: {
	isLoading: boolean;
	totals: Totals;
	/** ISO 4217，与网关 `BILLING_CURRENCY` 一致 */
	billingCurrency: string;
}) {
	const t = useTranslations('analytics.rangeTotals');
	const { isLoading, totals, billingCurrency } = props;
	const val = (n: number) =>
		isLoading ? (
			<span className="text-gray-400">…</span>
		) : (
			<span className="tabular-nums text-gray-900">{formatGatewayMoneyCode(n, billingCurrency, 4)}</span>
		);
	return (
		<div className="w-full min-w-0 md:ml-auto md:w-auto">
			<p className="mb-2 text-xs text-gray-500">{t('rangeTotal')}</p>
			<dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 md:flex md:flex-wrap md:gap-4">
				{(['standard', 'charged', 'metered'] as const).map((key) => (
					<div key={key} className="min-w-0 rounded-md bg-gray-50 px-3 py-2">
						<dt className="text-xs text-gray-500">{t(key)}</dt>
						<dd className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">{val(totals[key])}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}
