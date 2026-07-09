'use client';

/**
 * 总览页：拉取 `/api/admin/stats`（`start_date`/`end_date` 或 `range`），展示 KPI、图表、近期日志与错误摘要。
 */
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { DashboardModelDistributionChart } from '@/components/dashboard/DashboardModelDistributionChart';
import { DashboardTokenTrendChart } from '@/components/dashboard/DashboardTokenTrendChart';
import { DashboardUserTrendChart } from '@/components/dashboard/DashboardUserTrendChart';
import { createRangeValue, formatGatewayRangeSummary, type GatewayTimeRangeValue } from '@/lib/analytics-range';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayTime } from '@/lib/datetime';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardStats } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';

function formatLatency(ms: number | null | undefined): string {
	if (ms == null || !Number.isFinite(ms)) return '—';
	if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
	return `${Math.round(ms)}ms`;
}

export default function DashboardPage() {
	const t = useTranslations('dashboard');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const tPricing = useTranslations('pricing');
	const tTimeRange = useTranslations('timeRange');
	const [stats, setStats] = useState<DashboardStats | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue('1d'));
	const { currency: billingCurrency } = useBillingCurrency();

	const rangeLabel = useMemo(
		() =>
			formatGatewayRangeSummary(
				rangeValue,
				(preset) => t(`rangeLabels.${preset}`),
				tTimeRange('custom')
			),
		[rangeValue, t, tTimeRange]
	);

	useEffect(() => {
		fetchStats();
	}, [rangeValue.start_date, rangeValue.end_date]);

	const fetchStats = async () => {
		setIsLoading(true);
		try {
			const params = new URLSearchParams();
			if (rangeValue.start_date) params.set('start_date', rangeValue.start_date);
			if (rangeValue.end_date) params.set('end_date', rangeValue.end_date);
			if (rangeValue.preset !== 'custom') params.set('range', rangeValue.preset);
			const response = await fetch(`/api/admin/stats?${params.toString()}`);
			const data = await readApiJson<DashboardStats>(response);
			if (data.success && data.data != null) {
				setStats(data.data);
			}
		} catch (error) {
			console.error('Fetch stats error:', error);
		} finally {
			setIsLoading(false);
		}
	};

	if (isLoading && !stats) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	const kpi = stats?.kpi;
	const gateway = stats?.gateway;

	return (
		<div className="p-8">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
					<p className="text-sm text-gray-500 mt-1">{t('subtitle', { product: tBrand('product') })}</p>
				</div>
				<button
					type="button"
					onClick={() => fetchStats()}
					disabled={isLoading}
					className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
				>
					<ArrowPathIcon className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
					{t('refresh')}
				</button>
			</div>

			<div className="mb-8 w-full min-w-0">
				<GatewayTimeRangePicker value={rangeValue} onChange={setRangeValue} />
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
				<div className="bg-white rounded-lg shadow-md p-5">
					<div className="text-sm text-gray-500 mb-1">{t('apiKeys')}</div>
					<div className="text-2xl font-bold text-gray-900">{gateway?.keysTotal ?? 0}</div>
					<div className="text-xs text-gray-500 mt-1">{t('enabledCount', { count: gateway?.keysActive ?? 0 })}</div>
					<Link href="/gateway/keys" className="text-sm text-blue-600 hover:underline mt-2 inline-block">{t('keysLink')}</Link>
				</div>
				<div className="bg-white rounded-lg shadow-md p-5">
					<div className="text-sm text-gray-500 mb-1">{t('accounts')}</div>
					<div className="text-2xl font-bold text-gray-900">{gateway?.accountsTotal ?? 0}</div>
					<div className="text-xs text-gray-500 mt-1">{t('enabledCount', { count: gateway?.accountsActive ?? 0 })}</div>
					<Link href="/gateway/users" className="text-sm text-blue-600 hover:underline mt-2 inline-block">{t('usersLink')}</Link>
				</div>
				<div className="bg-white rounded-lg shadow-md p-5">
					<div className="text-sm text-gray-500 mb-1">{t('todayRequests')}</div>
					<div className="text-2xl font-bold text-gray-900">{gateway?.todayRequestsCount?.toLocaleString() ?? 0}</div>
					<div className="text-xs text-gray-500 mt-1">
						{tPricing('cost', { amount: formatGatewayMoneyCode(gateway?.todayCost ?? 0, billingCurrency, 4) })}
					</div>
				</div>
				<div className="bg-white rounded-lg shadow-md p-5">
					<div className="text-sm text-gray-500 mb-1">{t('activeUsersRange', { range: rangeLabel })}</div>
					<div className="text-2xl font-bold text-gray-900">{kpi?.activeUsers ?? 0}</div>
					<div className="text-xs text-gray-500 mt-1">{t('accountsTotalHint', { count: gateway?.accountsTotal ?? 0 })}</div>
				</div>
				<div className="bg-white rounded-lg shadow-md p-5">
					<div className="text-sm text-gray-500 mb-1">{t('todayTokens')}</div>
					<div className="text-2xl font-bold text-gray-900">{formatCompactTokens(gateway?.todayTokens ?? 0)}</div>
					<div className="text-xs text-gray-500 mt-1">
						{t('rangeTokens', { range: rangeLabel, count: formatCompactTokens(kpi?.totalTokens ?? 0) })}
					</div>
				</div>
				<div className="bg-white rounded-lg shadow-md p-5">
					<div className="text-sm text-gray-500 mb-1">{t('rangeCost', { range: rangeLabel })}</div>
					<div className="text-xl font-bold text-gray-900">
						{formatGatewayMoneyCode(kpi?.totalCost ?? 0, billingCurrency, 4)}
					</div>
					<div className="text-xs text-gray-500 mt-1">
						{tPricing('stdMetered', {
							std: formatGatewayMoneyCode(kpi?.standardCost ?? 0, billingCurrency, 4),
							metered: formatGatewayMoneyCode(kpi?.meteredCost ?? 0, billingCurrency, 4),
						})}
					</div>
				</div>
				<div className="bg-white rounded-lg shadow-md p-5">
					<div className="text-sm text-gray-500 mb-1">{t('throughput')}</div>
					<div className="text-2xl font-bold text-gray-900">{kpi?.rpm?.toLocaleString() ?? 0} RPM</div>
					<div className="text-xs text-gray-500 mt-1">{t('tpmValue', { count: formatCompactTokens(kpi?.tpm ?? 0) })}</div>
				</div>
				<div className="bg-white rounded-lg shadow-md p-5">
					<div className="text-sm text-gray-500 mb-1">{t('avgLatencyRange', { range: rangeLabel })}</div>
					<div className="text-2xl font-bold text-gray-900">{formatLatency(kpi?.avgLatencyMs)}</div>
					<div className="text-xs text-gray-500 mt-1">
						{t('successRateValue', { rate: (kpi?.successRate ?? 0).toFixed(1) })}
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
				<DashboardModelDistributionChart
					modelDistribution={stats?.modelDistribution ?? []}
					topUsers={stats?.topUsers ?? []}
					billingCurrency={billingCurrency}
				/>
				<DashboardTokenTrendChart
					timeseries={stats?.timeseries ?? []}
					granularity={stats?.granularity ?? 'hour'}
				/>
			</div>

			<div className="mb-8">
				<DashboardUserTrendChart
					userTimeseries={stats?.userTimeseries ?? []}
					granularity={stats?.granularity ?? 'hour'}
				/>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
				<div className="bg-white rounded-lg shadow-md p-6">
					<div className="flex items-center justify-between">
						<div>
							<div className="text-sm text-gray-500 mb-1">{t('errorRateRange', { range: rangeLabel })}</div>
							<div className={`text-2xl font-bold ${(kpi?.errorRate ?? gateway?.errorRate ?? 0) > 5 ? 'text-red-600' : 'text-green-600'}`}>
								{(kpi?.errorRate ?? gateway?.errorRate ?? 0).toFixed(2)}%
							</div>
						</div>
						<Link href="/gateway/request-logs?status=error" className="text-sm text-blue-600 hover:underline">{t('viewErrorLogs')}</Link>
					</div>
					<div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
						<Link href="/gateway/analytics/providers" className="text-sm text-blue-600 hover:underline">{t('providerUsageLink')}</Link>
						<Link href="/gateway/analytics/reliability" className="text-sm text-blue-600 hover:underline">{t('reliabilityLink')}</Link>
					</div>
				</div>
				<div className="bg-white rounded-lg shadow-md p-6">
					<div className="text-sm text-gray-500 mb-1">{t('requestsRange', { range: rangeLabel })}</div>
					<div className="text-2xl font-bold text-gray-900">{kpi?.totalRequests?.toLocaleString() ?? 0}</div>
					<Link href="/gateway/analytics/models" className="text-sm text-blue-600 hover:underline mt-2 inline-block">{t('modelUsageLink')}</Link>
				</div>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<div className="bg-white rounded-lg shadow-md p-6">
					<h2 className="text-lg font-semibold text-gray-900 mb-4">{t('recentRequests')}</h2>
					{stats?.recentLogs && stats.recentLogs.length > 0 ? (
						<div className="space-y-3">
							{stats.recentLogs.map((log) => (
								<div key={log.id} className="flex items-center justify-between text-sm border-b pb-2">
									<div>
										<div>
											<span className="font-medium text-gray-900">{log.model_id || tCommon('unknown')}</span>
											<span className={`ml-2 px-2 py-0.5 rounded text-xs ${log.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
												{log.status}
											</span>
										</div>
										{log.provider_id && <div className="text-xs text-gray-500 mt-0.5">{tPricing('providerLabel', { id: log.provider_id })}</div>}
									</div>
									<div className="text-gray-500">
										{formatGatewayTime(log.created_at)}
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="text-gray-500 text-sm">{tCommon('noRecentRequests')}</div>
					)}
					<Link href="/gateway/request-logs" className="text-sm text-blue-600 hover:underline mt-4 inline-block">{tCommon('viewAll')}</Link>
				</div>

				<div className="bg-white rounded-lg shadow-md p-6">
					<h2 className="text-lg font-semibold text-gray-900 mb-4">{t('recentErrors')}</h2>
					{stats?.recentErrors && stats.recentErrors.length > 0 ? (
						<div className="space-y-3">
							{stats.recentErrors.map((log) => (
								<div key={log.id} className="flex items-center justify-between text-sm border-b pb-2">
									<div className="truncate flex-1">
										<div>
											<span className="font-medium text-gray-900">{log.model_id || tCommon('unknown')}</span>
											<span className="ml-2 text-red-600 text-xs truncate">{log.error_message || tCommon('unknownError')}</span>
										</div>
										{log.provider_id && <div className="text-xs text-gray-500 mt-0.5">{tPricing('providerLabel', { id: log.provider_id })}</div>}
									</div>
									<div className="text-gray-500 ml-2">
										{formatGatewayTime(log.created_at)}
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="text-gray-500 text-sm">{tCommon('noRecentErrors')}</div>
					)}
				</div>
			</div>
		</div>
	);
}
