'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import type { DashboardTimeseriesRow } from '@/lib/types';
import { formatDashboardBucketLabel } from './format-dashboard-bucket';

export type DashboardTokenTrendChartProps = {
	timeseries: DashboardTimeseriesRow[];
	granularity: 'hour' | 'day';
};

export function DashboardTokenTrendChart({ timeseries, granularity }: DashboardTokenTrendChartProps) {
	const t = useTranslations('dashboard');

	const chartData = useMemo(
		() =>
			timeseries.map((row) => ({
				bucket: formatDashboardBucketLabel(row.bucket, granularity),
				input_tokens: row.input_tokens,
				output_tokens: row.output_tokens,
				cache_read_tokens: row.cache_read_tokens,
				cache_write_tokens: row.cache_write_tokens,
				cache_hit_rate: row.cache_hit_rate,
			})),
		[timeseries, granularity]
	);

	return (
		<div className="bg-white rounded-lg shadow-md p-6 h-full">
			<h2 className="text-lg font-semibold text-gray-900 mb-4">{t('tokenTrend')}</h2>
			{chartData.length === 0 ? (
				<div className="text-sm text-gray-500 py-12 text-center">{t('noChartData')}</div>
			) : (
				<div className="h-72">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={chartData}>
							<CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
							<XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
							<YAxis tickFormatter={(v) => formatCompactTokens(v)} width={56} tick={{ fontSize: 11 }} />
							<Tooltip formatter={(value: number, name: string) => {
								if (name === 'cache_hit_rate') return [`${value.toFixed(1)}%`, t('cacheHitRate')];
								return [formatCompactTokens(value), name];
							}} />
							<Legend />
							<Line type="monotone" dataKey="input_tokens" name={t('inputTokens')} stroke="#2563eb" dot={false} strokeWidth={2} />
							<Line type="monotone" dataKey="output_tokens" name={t('outputTokens')} stroke="#14b8a6" dot={false} strokeWidth={2} />
							<Line type="monotone" dataKey="cache_read_tokens" name={t('cacheReadTokens')} stroke="#f59e0b" dot={false} strokeWidth={2} />
							<Line type="monotone" dataKey="cache_write_tokens" name={t('cacheWriteTokens')} stroke="#a855f7" dot={false} strokeWidth={2} />
						</LineChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
}
