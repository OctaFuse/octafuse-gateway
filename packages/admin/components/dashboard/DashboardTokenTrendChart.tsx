'use client';

import { useMemo, useState } from 'react';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import {
	Area,
	CartesianGrid,
	ComposedChart,
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
	businessTimezone: string;
	onExplore?: () => void;
};

export function DashboardTokenTrendChart({ timeseries, granularity, billingCurrency, businessTimezone, onExplore }: DashboardTokenTrendChartProps) {
	const t = useTranslations('dashboard');
	const [view, setView] = useState<TrendView>('requests');

	const chartData = useMemo(
		() =>
			timeseries.map((row) => ({
				bucket: formatDashboardBucketLabel(row.bucket, granularity, businessTimezone),
				requests: row.request_count,
				input_tokens: row.input_tokens,
				output_tokens: row.output_tokens,
				cache_read_tokens: row.cache_read_tokens,
				cost: row.charged_cost,
				latency: row.avg_latency_ms,
			})),
		[timeseries, granularity, businessTimezone]
	);

	const valueFormatter = (value: number) => {
		if (view === 'tokens') return formatCompactTokens(value);
		if (view === 'cost') return formatGatewayMoneyCode(value, billingCurrency, 4);
		if (view === 'latency') return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
		return value.toLocaleString();
	};

	const tabs: TrendView[] = ['requests', 'tokens', 'cost', 'latency'];

	return (
		<div className="admin-content-panel flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 className="admin-section-title flex items-center gap-2 text-sm font-medium text-gray-950"><ChartBarIcon className="h-4 w-4 text-gray-500" aria-hidden />{t('trafficTrend')}</h2>
					<p className="mt-1 text-xs text-gray-500">{t(`trendHints.${view}`)}</p>
				</div>
				<div role="group" aria-label={t('trafficTrend')} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-gray-100 p-1">
					{tabs.map((tab) => (
						<button
							key={tab}
							type="button"
							onClick={() => setView(tab)}
							aria-pressed={view === tab}
							className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${view === tab ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
						>
							{t(`trendTabs.${tab}`)}
						</button>
					))}
				</div>
			</div>

			{chartData.length === 0 ? (
				<div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ChartBarIcon className="h-5 w-5" aria-hidden /></span>
          <p className="text-sm text-gray-600">{t('noChartData')}</p>
          {onExplore && <button type="button" className="rounded-lg px-3 py-2 text-xs text-blue-700 hover:bg-blue-50" onClick={onExplore}>{t('exploreWeek')}</button>}
        </div>
			) : (
				<div className="mt-5 flex flex-1 flex-col">
          {view === 'tokens' && <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">{[{ label: t('inputTokens'), color: '#2563eb' }, { label: t('outputTokens'), color: '#0d9488' }, { label: t('cacheReadTokens'), color: '#d97706' }].map(item => <span key={item.label} className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />{item.label}</span>)}</div>}
          <div className="h-64 min-h-64 flex-1 sm:h-72 sm:min-h-72">
					<ResponsiveContainer width="100%" height="100%">
						<ComposedChart key={view} data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
							<defs>
								<linearGradient id="dashboardBlue" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#2563eb" stopOpacity={0.12} />
									<stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
								</linearGradient>
								<linearGradient id="dashboardCost" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#3f3f46" stopOpacity={0.08} />
									<stop offset="100%" stopColor="#3f3f46" stopOpacity={0.02} />
								</linearGradient>
							</defs>
							<CartesianGrid vertical={false} stroke="#f0f0f1" />
							<XAxis dataKey="bucket" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a', fontFamily: 'monospace' }} interval="preserveStartEnd" dy={8} />
							<YAxis axisLine={false} tickLine={false} tickFormatter={valueFormatter} width={64} tick={{ fontSize: 12, fill: '#71717a', fontFamily: 'monospace' }} />
							<Tooltip
								contentStyle={{ borderRadius: 12, borderColor: '#e4e4e7', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)', fontSize: 12 }}
								formatter={(value: number, name: string) => [valueFormatter(value), name]}
							/>
							{view === 'requests' ? <Area isAnimationActive={false} type="monotone" dataKey="requests" name={t('trendTabs.requests')} stroke="#2563eb" fill="url(#dashboardBlue)" strokeWidth={2} /> : null}
							{view === 'cost' ? <Area isAnimationActive={false} type="monotone" dataKey="cost" name={t('trendTabs.cost')} stroke="#3f3f46" fill="url(#dashboardCost)" strokeWidth={2} /> : null}
							{view === 'latency' ? <Area isAnimationActive={false} type="monotone" dataKey="latency" name={t('trendTabs.latency')} stroke="#52525b" fill="#f4f4f5" strokeWidth={2} connectNulls /> : null}
							{view === 'tokens' ? <Line isAnimationActive={false} type="monotone" dataKey="input_tokens" name={t('inputTokens')} stroke="#2563eb" dot={false} strokeWidth={2} /> : null}
							{view === 'tokens' ? <Line isAnimationActive={false} type="monotone" dataKey="output_tokens" name={t('outputTokens')} stroke="#0d9488" dot={false} strokeWidth={2} /> : null}
							{view === 'tokens' ? <Line isAnimationActive={false} type="monotone" dataKey="cache_read_tokens" name={t('cacheReadTokens')} stroke="#d97706" dot={false} strokeWidth={2} /> : null}
						</ComposedChart>
					</ResponsiveContainer>
          </div>
				</div>
			)}
		</div>
	);
}
