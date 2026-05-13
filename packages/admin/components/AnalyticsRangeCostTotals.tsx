'use client';

import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';

type Totals = { standard: number; charged: number; metered: number };

/** Model/User Usage 页顶栏：Range total Std / Charged / Metered */
export function AnalyticsRangeCostTotals(props: {
	isLoading: boolean;
	totals: Totals;
	/** ISO 4217，与网关 `BILLING_CURRENCY` 一致 */
	billingCurrency: string;
}) {
	const { isLoading, totals, billingCurrency } = props;
	const val = (n: number) =>
		isLoading ? (
			<span className="text-gray-400">…</span>
		) : (
			<span className="tabular-nums text-gray-900">{formatGatewayMoneyCode(n, billingCurrency, 4)}</span>
		);
	return (
		<div className="flex flex-wrap justify-end items-baseline gap-x-6 gap-y-1 ml-auto">
			<span className="text-gray-500">
				Range total <span className="text-gray-700 font-medium">Std</span>: {val(totals.standard)}
			</span>
			<span className="text-gray-500">
				<span className="text-gray-700 font-medium">Charged</span>: {val(totals.charged)}
			</span>
			<span className="text-gray-500">
				<span className="text-gray-700 font-medium">Metered</span>: {val(totals.metered)}
			</span>
		</div>
	);
}
