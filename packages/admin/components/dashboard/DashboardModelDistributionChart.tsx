'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardModelDistributionRow, DashboardTopUserRow } from '@/lib/types';

const CHART_COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#64748b', '#334155'];

type ViewMode = 'models' | 'users';

export type DashboardModelDistributionChartProps = {
	modelDistribution: DashboardModelDistributionRow[];
	topUsers: DashboardTopUserRow[];
	billingCurrency: string;
};

export function DashboardModelDistributionChart({
	modelDistribution,
	topUsers,
	billingCurrency,
}: DashboardModelDistributionChartProps) {
	const t = useTranslations('dashboard');
	const [view, setView] = useState<ViewMode>('models');

	const pieData = useMemo(() => {
		if (view === 'models') {
			return modelDistribution.map((row) => ({
				name: row.model_id,
				value: row.total_tokens,
			}));
		}
		return topUsers.map((row) => ({
			name: row.user_email,
			value: row.total_tokens,
		}));
	}, [modelDistribution, topUsers, view]);

	const tableRows = view === 'models' ? modelDistribution : topUsers;

	return (
		<div className="bg-white rounded-lg shadow-md p-6 h-full">
			<div className="flex items-center justify-between gap-4 mb-4">
				<h2 className="text-lg font-semibold text-gray-900">
					{view === 'models' ? t('modelDistribution') : t('userLeaderboard')}
				</h2>
				<div className="inline-flex rounded-md border border-gray-200 text-sm">
					<button
						type="button"
						onClick={() => setView('models')}
						className={`px-3 py-1.5 rounded-l-md ${view === 'models' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
					>
						{t('modelDistributionTab')}
					</button>
					<button
						type="button"
						onClick={() => setView('users')}
						className={`px-3 py-1.5 rounded-r-md border-l border-gray-200 ${view === 'users' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
					>
						{t('userLeaderboardTab')}
					</button>
				</div>
			</div>

			{tableRows.length === 0 ? (
				<div className="text-sm text-gray-500 py-12 text-center">{t('noChartData')}</div>
			) : (
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
					<div className="h-56">
						<ResponsiveContainer width="100%" height="100%">
							<PieChart>
								<Pie
									data={pieData}
									dataKey="value"
									nameKey="name"
									innerRadius={52}
									outerRadius={88}
									paddingAngle={2}
								>
									{pieData.map((entry, index) => (
										<Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
									))}
								</Pie>
								<Tooltip formatter={(value: number) => formatCompactTokens(value)} />
							</PieChart>
						</ResponsiveContainer>
					</div>

					<div className="overflow-auto max-h-56">
						<table className="min-w-full text-sm">
							<thead>
								<tr className="text-left text-gray-500 border-b">
									<th className="py-2 pr-3 font-medium">{view === 'models' ? t('modelColumn') : t('userColumn')}</th>
									<th className="py-2 pr-3 font-medium">{t('requestsColumn')}</th>
									<th className="py-2 pr-3 font-medium">{t('tokensColumn')}</th>
									<th className="py-2 font-medium">{t('chargedColumn')}</th>
								</tr>
							</thead>
							<tbody>
								{tableRows.map((row) => {
									const label = view === 'models'
										? (row as DashboardModelDistributionRow).model_id
										: (row as DashboardTopUserRow).user_email;
									return (
										<tr key={label} className="border-b border-gray-100">
											<td className="py-2 pr-3 text-gray-900 truncate max-w-[10rem]" title={label}>{label}</td>
											<td className="py-2 pr-3 tabular-nums text-gray-700">{row.request_count.toLocaleString()}</td>
											<td className="py-2 pr-3 tabular-nums text-gray-700">{formatCompactTokens(row.total_tokens)}</td>
											<td className="py-2 tabular-nums text-gray-700">
												{formatGatewayMoneyCode(row.charged_cost, billingCurrency, 4)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
}
