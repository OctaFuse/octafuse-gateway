'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardModelDistributionRow, DashboardTopUserRow } from '@/lib/types';

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

	const rows = useMemo(() => {
		if (view === 'models') {
			const max = Math.max(...modelDistribution.map((row) => row.request_count), 1);
			return modelDistribution.slice(0, 8).map((row) => ({
				key: row.model_id,
				label: row.model_id,
				requestCount: row.request_count,
				tokens: row.total_tokens,
				cost: row.charged_cost,
				share: (row.request_count / max) * 100,
			}));
		}
		const max = Math.max(...topUsers.map((row) => row.charged_cost), 0);
		return topUsers.slice(0, 8).map((row) => ({
			key: row.user_email,
			label: row.user_email,
			requestCount: row.request_count,
			tokens: row.total_tokens,
			cost: row.charged_cost,
			share: max > 0 ? (row.charged_cost / max) * 100 : 0,
		}));
	}, [modelDistribution, topUsers, view]);

	return (
		<section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm sm:p-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 className="text-base font-semibold text-gray-950">{t('usageBreakdown')}</h2>
					<p className="mt-1 text-xs text-gray-500">
						{view === 'models' ? t('modelBreakdownHint') : t('userBreakdownHint')}
					</p>
				</div>
				<div className="inline-flex rounded-xl bg-gray-100 p-1 text-xs">
					<button
						type="button"
						onClick={() => setView('models')}
						className={`rounded-lg px-3 py-1.5 font-medium transition ${view === 'models' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
					>
						{t('modelDistributionTab')}
					</button>
					<button
						type="button"
						onClick={() => setView('users')}
						className={`rounded-lg px-3 py-1.5 font-medium transition ${view === 'users' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
					>
						{t('userLeaderboardTab')}
					</button>
				</div>
			</div>

			{rows.length === 0 ? (
				<div className="py-16 text-center text-sm text-gray-500">{t('noChartData')}</div>
			) : (
				<div className="mt-5 overflow-x-auto">
					<div className="min-w-[34rem]">
						<div className="grid grid-cols-[minmax(12rem,1fr)_5rem_6rem_7rem] gap-3 border-b border-gray-100 pb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
							<span>{view === 'models' ? t('modelColumn') : t('userColumn')}</span>
							<span className="text-right">{t('requestsColumn')}</span>
							<span className="text-right">{t('tokensColumn')}</span>
							<span className="text-right">{t('chargedColumn')}</span>
						</div>
						{rows.map((row, index) => (
							<div key={row.key} className="grid grid-cols-[minmax(12rem,1fr)_5rem_6rem_7rem] items-center gap-3 border-b border-gray-100 py-3 last:border-0">
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="w-4 shrink-0 text-[11px] font-medium text-gray-400">{index + 1}</span>
										<span className="truncate text-sm font-medium text-gray-900" title={row.label}>{row.label}</span>
									</div>
									<div className="ml-6 mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
										<div className={`h-full rounded-full ${view === 'models' ? 'bg-blue-500' : 'bg-violet-500'}`} style={{ width: `${Math.max(row.share, 2)}%` }} />
									</div>
								</div>
								<span className="text-right text-sm tabular-nums text-gray-600">{row.requestCount.toLocaleString()}</span>
								<span className="text-right text-sm tabular-nums text-gray-600">{formatCompactTokens(row.tokens)}</span>
								<span className="text-right text-sm tabular-nums text-gray-900">{formatGatewayMoneyCode(row.cost, billingCurrency, 4)}</span>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
				<Link
					href={view === 'models' ? '/gateway/analytics/models' : '/gateway/analytics/users'}
					className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
				>
					{view === 'models' ? t('modelUsageLink') : t('userUsageLink')}
					<ChevronRightIcon className="h-3.5 w-3.5" />
				</Link>
			</div>
		</section>
	);
}
