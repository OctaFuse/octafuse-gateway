'use client';

/**
 * 网关总览：围绕「流量、稳定性、响应、费用」组织首屏，弱化配置数量与重复的今日口径。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
	ArrowPathIcon,
	BanknotesIcon,
	BoltIcon,
	CheckCircleIcon,
	ChevronRightIcon,
	ClockIcon,
	ExclamationTriangleIcon,
	KeyIcon,
	QueueListIcon,
	UserGroupIcon,
} from '@heroicons/react/24/outline';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { DashboardModelDistributionChart } from '@/components/dashboard/DashboardModelDistributionChart';
import { DashboardTokenTrendChart } from '@/components/dashboard/DashboardTokenTrendChart';
import {
	createRangeValue,
	DEFAULT_GATEWAY_TIME_RANGE_PRESET,
	formatGatewayRangeSummary,
	isRollingPreset,
	type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { readApiJson } from '@/lib/api-json';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardStats, GatewayRequestLog } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

function formatLatency(ms: number | null | undefined): string {
	if (ms == null || !Number.isFinite(ms)) return '—';
	if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
	return `${Math.round(ms)}ms`;
}

function dashboardLogModelLabel(log: GatewayRequestLog, unknown: string): string {
	return log.model_name?.trim() || log.model_id?.trim() || unknown;
}

function dashboardLogProviderLabel(log: GatewayRequestLog): string {
	return log.provider_name?.trim() || log.provider_id?.trim() || '';
}

function dashboardLogModelTitle(log: GatewayRequestLog): string | undefined {
	const name = log.model_name?.trim();
	const id = log.model_id?.trim();
	if (name && id && name !== id) return `${name} (${id})`;
	return name || id || undefined;
}

function dashboardLogProviderTitle(log: GatewayRequestLog): string | undefined {
	const name = log.provider_name?.trim();
	const id = log.provider_id?.trim();
	if (name && id && name !== id) return `${name} (${id})`;
	return name || id || undefined;
}

function MetricCard({
	icon,
	label,
	value,
	footer,
	tone = 'blue',
}: {
	icon: ReactNode;
	label: string;
	value: string;
	footer: ReactNode;
	tone?: 'blue' | 'emerald' | 'amber' | 'violet';
}) {
	const toneClasses = {
		blue: 'bg-blue-50 text-blue-700 ring-blue-100',
		emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
		amber: 'bg-amber-50 text-amber-700 ring-amber-100',
		violet: 'bg-violet-50 text-violet-700 ring-violet-100',
	};

	return (
		<div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<p className="text-sm font-medium text-gray-500">{label}</p>
					<p className="mt-2 truncate text-3xl font-semibold tracking-tight text-gray-950 tabular-nums">{value}</p>
				</div>
				<div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${toneClasses[tone]}`}>
					{icon}
				</div>
			</div>
			<div className="mt-4 min-h-5 text-xs leading-5 text-gray-500">{footer}</div>
		</div>
	);
}

function RequestRow({ log, formatTime, unknown }: {
	log: GatewayRequestLog;
	formatTime: (value: string | null | undefined) => string;
	unknown: string;
}) {
	const success = log.status === 'success';
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-gray-100 py-3 last:border-0">
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-2">
					<span className={`h-2 w-2 shrink-0 rounded-full ${success ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden />
					<span className="truncate text-sm font-medium text-gray-900" title={dashboardLogModelTitle(log)}>
						{dashboardLogModelLabel(log, unknown)}
					</span>
					<span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
						{log.status}
					</span>
				</div>
				<p className="mt-1 truncate pl-4 text-xs text-gray-500" title={dashboardLogProviderTitle(log)}>
					{dashboardLogProviderLabel(log) || unknown}
				</p>
			</div>
			<time className="whitespace-nowrap text-xs text-gray-400">{formatTime(log.created_at)}</time>
		</div>
	);
}

export default function DashboardPage() {
	const t = useTranslations('dashboard');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const tTimeRange = useTranslations('timeRange');
	const [stats, setStats] = useState<DashboardStats | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue(DEFAULT_GATEWAY_TIME_RANGE_PRESET));
	const { currency: billingCurrency } = useBillingCurrency();
	const { businessTimezone, formatTime } = useGatewayDateTime();

	const rangeLabel = useMemo(
		() =>
			formatGatewayRangeSummary(
				rangeValue,
				(preset) => t(`rangeLabels.${preset}`),
				tTimeRange('custom'),
				businessTimezone
			),
		[rangeValue, t, tTimeRange, businessTimezone]
	);

	const fetchStats = async () => {
		setIsLoading(true);
		setLoadError(false);
		try {
			const params = new URLSearchParams();
			if (rangeValue.start_date) params.set('start_date', rangeValue.start_date);
			if (rangeValue.end_date) params.set('end_date', rangeValue.end_date);
			if (isRollingPreset(rangeValue.preset)) params.set('range', rangeValue.preset);
			const response = await fetch(`/api/admin/stats?${params.toString()}`);
			const data = await readApiJson<DashboardStats>(response);
			if (data.success && data.data != null) {
				setStats(data.data);
			} else {
				setLoadError(true);
			}
		} catch (error) {
			console.error('Fetch stats error:', error);
			setLoadError(true);
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		void fetchStats();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rangeValue.start_date, rangeValue.end_date]);

	if (isLoading && !stats) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="flex items-center gap-2 text-sm text-gray-500">
					<ArrowPathIcon className="h-4 w-4 animate-spin" />
					{tCommon('loading')}
				</div>
			</div>
		);
	}

	const kpi = stats?.kpi;
	const gateway = stats?.gateway;
	const totalRequests = kpi?.totalRequests ?? 0;
	const totalCost = kpi?.totalCost ?? 0;
	const errorRate = kpi?.errorRate ?? 0;
	const estimatedErrors = Math.round((totalRequests * errorRate) / 100);
	const successRate = kpi?.successRate ?? 0;
	const statusTone = totalRequests === 0 ? 'idle' : errorRate >= 5 ? 'critical' : errorRate >= 1 ? 'watch' : 'healthy';
	const statusClasses = {
		idle: 'bg-gray-100 text-gray-600 ring-gray-200',
		healthy: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		watch: 'bg-amber-50 text-amber-700 ring-amber-200',
		critical: 'bg-red-50 text-red-700 ring-red-200',
	};

	return (
		<div className="min-h-full min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl">{t('title')}</h1>
						<span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${statusClasses[statusTone]}`}>
							<span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
							{t(`status.${statusTone}`)}
						</span>
					</div>
					<p className="mt-1.5 text-sm text-gray-500">{t('subtitle', { product: tBrand('product') })}</p>
				</div>
				<div className="flex items-center gap-3">
					<div className="hidden items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 shadow-sm sm:flex">
						<span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
							<BoltIcon className="h-4 w-4 text-amber-500" />
							{t('live')}
						</span>
						<span><strong className="font-semibold text-gray-900 tabular-nums">{kpi?.rpm?.toLocaleString() ?? 0}</strong> RPM</span>
						<span><strong className="font-semibold text-gray-900 tabular-nums">{formatCompactTokens(kpi?.tpm ?? 0)}</strong> TPM</span>
					</div>
					<button
						type="button"
						onClick={() => void fetchStats()}
						disabled={isLoading}
						aria-label={t('refresh')}
						className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-60"
					>
						<ArrowPathIcon className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
					</button>
				</div>
			</header>

			<div className="mt-6 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
				<GatewayTimeRangePicker value={rangeValue} onChange={setRangeValue} label={t('analysisWindow')} />
			</div>

			{loadError ? (
				<div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
					<span>{t('loadError')}</span>
					<button type="button" onClick={() => void fetchStats()} className="shrink-0 font-medium underline underline-offset-2">{t('retry')}</button>
				</div>
			) : null}

			<section className="mt-6" aria-labelledby="overview-heading">
				<div className="mb-3 flex items-end justify-between gap-4">
					<div>
						<h2 id="overview-heading" className="text-sm font-semibold text-gray-900">{t('overview')}</h2>
						<p className="mt-0.5 text-xs text-gray-500">{rangeLabel}</p>
					</div>
					<div className="flex items-center gap-3 text-xs text-gray-500 sm:hidden">
						<span>{kpi?.rpm?.toLocaleString() ?? 0} RPM</span>
						<span>{formatCompactTokens(kpi?.tpm ?? 0)} TPM</span>
					</div>
				</div>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<MetricCard
						icon={<QueueListIcon className="h-5 w-5" />}
						label={t('requests')}
						value={totalRequests.toLocaleString()}
						footer={<span>{t('requestContext', { users: kpi?.activeUsers ?? 0, tokens: formatCompactTokens(kpi?.totalTokens ?? 0) })}</span>}
					/>
					<MetricCard
						icon={<CheckCircleIcon className="h-5 w-5" />}
						label={t('successRate')}
						value={`${successRate.toFixed(1)}%`}
						footer={(
							<Link href="/gateway/request-logs?status=error" className="inline-flex items-center gap-1 text-gray-500 transition hover:text-blue-700">
								{t('errorContext', { count: estimatedErrors, rate: errorRate.toFixed(2) })}
								<ChevronRightIcon className="h-3 w-3" />
							</Link>
						)}
						tone="emerald"
					/>
					<MetricCard
						icon={<ClockIcon className="h-5 w-5" />}
						label={t('avgLatency')}
						value={formatLatency(kpi?.avgLatencyMs)}
						footer={<Link href="/gateway/analytics/reliability" className="inline-flex items-center gap-1 transition hover:text-blue-700">{t('inspectReliability')}<ChevronRightIcon className="h-3 w-3" /></Link>}
						tone="amber"
					/>
					<MetricCard
						icon={<BanknotesIcon className="h-5 w-5" />}
						label={t('chargedCost')}
						value={formatGatewayMoneyCode(totalCost, billingCurrency, 4)}
						footer={<span>{t('avgRequestCost', { amount: formatGatewayMoneyCode(totalRequests > 0 ? totalCost / totalRequests : 0, billingCurrency, 6) })}</span>}
						tone="violet"
					/>
				</div>
			</section>

			<section className="mt-6">
				<DashboardTokenTrendChart
					timeseries={stats?.timeseries ?? []}
					granularity={stats?.granularity ?? 'hour'}
					billingCurrency={billingCurrency}
				/>
			</section>

			<div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.8fr)]">
				<DashboardModelDistributionChart
					modelDistribution={stats?.modelDistribution ?? []}
					topUsers={stats?.topUsers ?? []}
					billingCurrency={billingCurrency}
				/>

				<div className="grid content-start gap-6">
					<section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
						<div>
							<h2 className="text-base font-semibold text-gray-950">{t('gatewayAccess')}</h2>
							<p className="mt-1 text-xs text-gray-500">{t('gatewayAccessHint')}</p>
						</div>
						<div className="mt-4 grid grid-cols-2 gap-3">
							<Link href="/gateway/keys" className="group rounded-xl bg-gray-50 p-4 ring-1 ring-inset ring-gray-100 transition hover:bg-blue-50 hover:ring-blue-100">
								<KeyIcon className="h-5 w-5 text-gray-400 transition group-hover:text-blue-600" />
								<p className="mt-3 text-2xl font-semibold text-gray-950 tabular-nums">{gateway?.keysActive ?? 0}<span className="text-sm font-normal text-gray-400"> / {gateway?.keysTotal ?? 0}</span></p>
								<p className="mt-1 text-xs text-gray-500">{t('activeKeys')}</p>
							</Link>
							<Link href="/gateway/users" className="group rounded-xl bg-gray-50 p-4 ring-1 ring-inset ring-gray-100 transition hover:bg-blue-50 hover:ring-blue-100">
								<UserGroupIcon className="h-5 w-5 text-gray-400 transition group-hover:text-blue-600" />
								<p className="mt-3 text-2xl font-semibold text-gray-950 tabular-nums">{gateway?.accountsActive ?? 0}<span className="text-sm font-normal text-gray-400"> / {gateway?.accountsTotal ?? 0}</span></p>
								<p className="mt-1 text-xs text-gray-500">{t('activeAccounts')}</p>
							</Link>
						</div>
					</section>

					<section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
						<div className="flex items-center justify-between gap-4">
							<div className="flex items-center gap-2">
								<ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
								<h2 className="text-base font-semibold text-gray-950">{t('needsAttention')}</h2>
							</div>
							<Link href="/gateway/request-logs?status=error" className="text-xs font-medium text-blue-700 hover:underline">{tCommon('viewAll')}</Link>
						</div>
						{stats?.recentErrors && stats.recentErrors.length > 0 ? (
							<div className="mt-3">
								{stats.recentErrors.slice(0, 3).map((log) => {
									const providerLabel = dashboardLogProviderLabel(log);
									return (
									<div key={log.id} className="border-b border-gray-100 py-3 last:border-0">
										<div className="flex items-start justify-between gap-3">
											<p className="truncate text-sm font-medium text-gray-900" title={dashboardLogModelTitle(log)}>
												{dashboardLogModelLabel(log, tCommon('unknown'))}
											</p>
											<time className="shrink-0 text-[11px] text-gray-400">{formatTime(log.created_at)}</time>
										</div>
										<p className="mt-1 line-clamp-2 text-xs leading-5 text-red-600">{log.error_message || tCommon('unknownError')}</p>
										{providerLabel ? (
											<p className="mt-1 text-[11px] text-gray-400" title={dashboardLogProviderTitle(log)}>
												{providerLabel}
											</p>
										) : null}
									</div>
									);
								})}
							</div>
						) : (
							<div className="mt-4 rounded-xl bg-emerald-50 px-4 py-5 text-center text-sm text-emerald-700">{t('noRecentErrors')}</div>
						)}
					</section>
				</div>
			</div>

			<section className="mt-6 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm sm:p-6">
				<div className="flex items-center justify-between gap-4">
					<div>
						<h2 className="text-base font-semibold text-gray-950">{t('recentRequests')}</h2>
						<p className="mt-1 text-xs text-gray-500">{t('recentRequestsHint')}</p>
					</div>
					<Link href="/gateway/request-logs" className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
						{tCommon('viewAll')}<ChevronRightIcon className="h-4 w-4" />
					</Link>
				</div>
				{stats?.recentLogs && stats.recentLogs.length > 0 ? (
					<div className="mt-3">
						{stats.recentLogs.map((log) => <RequestRow key={log.id} log={log} formatTime={formatTime} unknown={tCommon('unknown')} />)}
					</div>
				) : (
					<div className="py-10 text-center text-sm text-gray-500">{tCommon('noRecentRequests')}</div>
				)}
			</section>
		</div>
	);
}
