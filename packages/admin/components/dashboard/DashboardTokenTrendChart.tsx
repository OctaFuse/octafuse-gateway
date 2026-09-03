'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
	Area,
	AreaChart,
	CartesianGrid,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardTimeseriesRow } from '@/lib/types';
import { formatDashboardBucketLabel } from './format-dashboard-bucket';

type TrendView = 'requests' | 'tokens' | 'cost' | 'latency';

export type DashboardTokenTrendChartProps = {
	timeseries: DashboardTimeseriesRow[];
	granularity: 'hour' | 'day';
	billingCurrency: string;
};

export function DashboardTokenTrendChart({ timeseries, granularity, billingCurrency }: DashboardTokenTrendChartProps) {
	const t = useTranslations('dashboard');
	const [view, setView] = useState<TrendView>('requests');

	const chartData = useMemo(
		() =>
			timeseries.map((row) => ({
				bucket: formatDashboardBucketLabel(row.bucket, granularity),
				requests: row.request_count,
				input_tokens: row.input_tokens,
				output_tokens: row.output_tokens,
				cache_read_tokens: row.cache_read_tokens,
				cost: row.charged_cost,
				latency: row.avg_latency_ms,
			})),
		[timeseries, granularity]
	);

	const valueFormatter = (value: number) => {
		if (view === 'tokens') return formatCompactTokens(value);
		if (view === 'cost') return formatGatewayMoneyCode(value, billingCurrency, 4);
		if (view === 'latency') return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
		return value.toLocaleString();
	};

	const tabs: TrendView[] = ['requests', 'tokens', 'cost', 'latency'];

	return (
		<div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm sm:p-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 className="text-base font-semibold text-gray-950">{t('trafficTrend')}</h2>
					<p className="mt-1 text-xs text-gray-500">{t(`trendHints.${view}`)}</p>
				</div>
				<div className="inline-flex max-w-full overflow-x-auto rounded-xl bg-gray-100 p-1">
					{tabs.map((tab) => (
						<button
							key={tab}
							type="button"
							onClick={() => setView(tab)}
							className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${view === tab ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
						>
							{t(`trendTabs.${tab}`)}
						</button>
					))}
				</div>
			</div>

			{chartData.length === 0 ? (
				<div className="py-16 text-center text-sm text-gray-500">{t('noChartData')}</div>
			) : (
				<div className="mt-5 h-72">
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
							<defs>
								<linearGradient id="dashboardBlue" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#2563eb" stopOpacity={0.24} />
									<stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
								</linearGradient>
								<linearGradient id="dashboardViolet" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#7c3aed" stopOpacity={0.22} />
									<stop offset="100%" stopColor="#7c3aed" stopOpacity={0.02} />
								</linearGradient>
							</defs>
							<CartesianGrid vertical={false} stroke="#eef2f7" />
							<XAxis dataKey="bucket" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} interval="preserveStartEnd" dy={8} />
							<YAxis axisLine={false} tickLine={false} tickFormatter={valueFormatter} width={64} tick={{ fontSize: 11, fill: '#9ca3af' }} />
							<Tooltip
								contentStyle={{ borderRadius: 12, borderColor: '#e5e7eb', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)', fontSize: 12 }}
								formatter={(value: number, name: string) => [valueFormatter(value), name]}
							/>
							{view === 'requests' ? <Area type="monotone" dataKey="requests" name={t('trendTabs.requests')} stroke="#2563eb" fill="url(#dashboardBlue)" strokeWidth={2} /> : null}
							{view === 'cost' ? <Area type="monotone" dataKey="cost" name={t('trendTabs.cost')} stroke="#7c3aed" fill="url(#dashboardViolet)" strokeWidth={2} /> : null}
							{view === 'latency' ? <Area type="monotone" dataKey="latency" name={t('trendTabs.latency')} stroke="#d97706" fill="#fef3c7" strokeWidth={2} connectNulls /> : null}
							{view === 'tokens' ? (
								<>
									<Line type="monotone" dataKey="input_tokens" name={t('inputTokens')} stroke="#2563eb" dot={false} strokeWidth={2} />
									<Line type="monotone" dataKey="output_tokens" name={t('outputTokens')} stroke="#0d9488" dot={false} strokeWidth={2} />
									<Line type="monotone" dataKey="cache_read_tokens" name={t('cacheReadTokens')} stroke="#d97706" dot={false} strokeWidth={2} />
								</>
							) : null}
						</AreaChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
}
