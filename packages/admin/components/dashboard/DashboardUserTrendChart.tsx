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
import type { DashboardUserTimeseriesRow } from '@/lib/types';
import { formatDashboardBucketLabel } from './format-dashboard-bucket';

const USER_COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#f97316', '#a855f7'];

export type DashboardUserTrendChartProps = {
	userTimeseries: DashboardUserTimeseriesRow[];
	granularity: 'hour' | 'day';
};

export function DashboardUserTrendChart({ userTimeseries, granularity }: DashboardUserTrendChartProps) {
	const t = useTranslations('dashboard');

	const { chartData, userEmails } = useMemo(() => {
		const emails = [...new Set(userTimeseries.map((row) => row.user_email))].slice(0, 5);
		const buckets = [...new Set(userTimeseries.map((row) => row.bucket))].sort();
		const data = buckets.map((bucket) => {
			const point: Record<string, string | number> = {
				bucket: formatDashboardBucketLabel(bucket, granularity),
			};
			for (const email of emails) {
				const match = userTimeseries.find((row) => row.bucket === bucket && row.user_email === email);
				point[email] = match?.total_tokens ?? 0;
			}
			return point;
		});
		return { chartData: data, userEmails: emails };
	}, [userTimeseries, granularity]);

	return (
		<div className="bg-white rounded-lg shadow-md p-6">
			<h2 className="text-lg font-semibold text-gray-900 mb-4">{t('userTrend')}</h2>
			{chartData.length === 0 || userEmails.length === 0 ? (
				<div className="text-sm text-gray-500 py-12 text-center">{t('noChartData')}</div>
			) : (
				<div className="h-72">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={chartData}>
							<CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
							<XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
							<YAxis tickFormatter={(v) => formatCompactTokens(v)} width={56} tick={{ fontSize: 11 }} />
							<Tooltip formatter={(value: number) => formatCompactTokens(value)} />
							<Legend />
							{userEmails.map((email, index) => (
								<Line
									key={email}
									type="monotone"
									dataKey={email}
									name={email}
									stroke={USER_COLORS[index % USER_COLORS.length]}
									dot={false}
									strokeWidth={2}
								/>
							))}
						</LineChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
}
