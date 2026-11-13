'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

/** Overview: selected-window metrics and trends, live access snapshot, global recent activity. */
import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowUpRightIcon, ArrowsRightLeftIcon, BanknotesIcon, BoltIcon, ClockIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { DashboardRangeControl } from '@/components/dashboard/DashboardRangeControl';
import { DashboardCosts, DashboardMetricDefinitions, DashboardOperations } from '@/components/dashboard/DashboardOperations';
import { dashboardPeriodChange } from '@/components/dashboard/dashboard-comparison';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { DashboardModelDistributionChart } from '@/components/dashboard/DashboardModelDistributionChart';
import { DashboardTokenSummary } from '@/components/dashboard/DashboardTokenSummary';
import { DashboardTokenTrendChart } from '@/components/dashboard/DashboardTokenTrendChart';
import { dashboardLogsHref } from '@/components/dashboard/dashboard-links';
import { createRangeValue, formatGatewayRangeSummary, type GatewayTimeRangeValue } from '@/lib/analytics-range';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useAnalyticsRange } from '@/lib/use-analytics-range';
import { AutoRefreshControl } from '@/components/AutoRefreshControl';
import { DASHBOARD_REFRESH_INTERVAL_OPTIONS, dashboardRefreshPreference } from '@/lib/auto-refresh-preference';
import { useDashboardSnapshot } from '@/components/dashboard/use-dashboard-snapshot';
import { DashboardNumber } from '@/components/dashboard/DashboardNumber';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

function Metric({ icon: Icon, tone, label, value, format, scope, change, children }: {
  icon: ComponentType<{ className?: string }>; tone: string; label: string;
  value: number | null | undefined; format: (value: number) => string; scope: string;
  change?: { label: string; hint: string; tone: string } | null; children?: ReactNode;
}) {
  return <div className="admin-content-panel min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <div className="flex min-h-8 items-center gap-2"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 flex-1 text-xs leading-4 text-gray-600">{label}</span>
      {change && <span title={change.hint} aria-label={change.hint} className={`hidden max-w-[45%] shrink-0 truncate rounded px-1.5 py-0.5 font-mono text-[10px] sm:inline-flex tabular-nums ${change.tone}`}>{change.label}</span>}
    </div>
    <p title={value == null ? undefined : format(value)} className="mt-3 truncate font-mono text-[28px] font-medium leading-tight tabular-nums text-gray-950 sm:text-3xl"><DashboardNumber value={value} format={format} scope={scope} /></p>
    {change && <div className="mt-1 sm:hidden"><span title={change.hint} aria-label={change.hint} className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${change.tone}`}>{change.label}</span></div>}
    {children && <div className="mt-2 text-xs leading-5 text-gray-500">{children}</div>}
  </div>;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const c = useTranslations('common');
  const op = useTranslations('dashboard.operations');
  const tr = useTranslations('timeRange');
  const review = useTranslations('dashboard.review');
  const [range, setRange] = useAnalyticsRange(true);
  const [rangeOpen, setRangeOpen] = useState(false);
  const { currency } = useBillingCurrency();
  const { businessTimezone, formatTime, formatDateTime } = useGatewayDateTime();
  const pausedHint = rangeOpen ? t('liveRefresh.pausedDialog') : range.preset === 'custom' ? t('liveRefresh.pausedRange') : undefined;
  const { snapshot, loading, loadError, intervalMs, controls } = useDashboardSnapshot(range, businessTimezone, Boolean(pausedHint));
  const stats = snapshot?.data;
  const operations = stats?.operations;
  const baseline = operations?.previous;
  const loadedRange = snapshot?.range ?? range;
  const scope = snapshot?.scope ?? 'initial';
  const rangeLabel = (value: GatewayTimeRangeValue) => formatGatewayRangeSummary(value, p => t(`rangeLabels.${p}`), tr('custom'), businessTimezone);
  const selectedRangeLabel = rangeLabel(range);
  const loadedRangeLabel = rangeLabel(loadedRange);
  const errorsHref = useMemo(() => dashboardLogsHref(loadedRange, { status: 'error' }), [loadedRange]);
  const kpi = stats?.kpi;
  const hasMetrics = kpi != null;
  const count = kpi?.totalRequests ?? 0;
  const hasTraffic = hasMetrics && count > 0;
  const errorRate = kpi?.errorRate ?? 0;
  const formatLatency = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  const formatCount = (value: number) => Math.round(value).toLocaleString();
  const comparisonHint = operations ? `${op('comparisonHint')} ${formatDateTime(operations.window.previousStart)} → ${formatDateTime(operations.window.previousEnd)}` : '';
  const change = (value: number | null | undefined, before: number | null | undefined, kind: 'count' | 'rate' | 'latency' | 'money') => {
    const result = dashboardPeriodChange(value,before,kind);
    if (!result) return null;
    const label = result.unit === 'new' ? op('newActivity') : `${result.delta > 0 ? '+' : '−'}${result.unit === 'points' ? t('liveRefresh.points',{value:result.value.toFixed(1)}) : `${result.value.toFixed(1)}%`}`;
    const better = kind === 'rate' ? result.delta > 0 : kind === 'latency' ? result.delta < 0 : null;
    return { label, hint: comparisonHint, tone: better === true ? 'bg-emerald-50 text-emerald-700' : better === false ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600' };
  };
  const exploreWeek = useCallback(() => setRange(createRangeValue('7d', businessTimezone)), [setRange, businessTimezone]);
  const retry = () => void controls.refreshNow();

  return <div className="admin-content-workspace content-tone-inference min-h-full min-w-0 space-y-5 p-4 sm:space-y-6 sm:p-6 lg:p-8" aria-busy={loading}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><AdminPageTitle>{t('title')}</AdminPageTitle><p className="mt-1 text-sm text-gray-500">{t('overviewSubtitle')}</p></div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        <DashboardRangeControl value={range} label={selectedRangeLabel} timeZone={businessTimezone} onChange={setRange} onOpenChange={setRangeOpen} />
        <AutoRefreshControl {...controls} intervalMs={intervalMs} intervalOptions={DASHBOARD_REFRESH_INTERVAL_OPTIONS}
          onIntervalChange={dashboardRefreshPreference.write} refresh={controls.refreshNow} pausedHint={pausedHint} disabled={loading}
          label={t('liveRefresh.refreshLabel')} refreshLabel={t('refresh')} lastUpdatedAt={snapshot?.updatedAt ?? controls.lastUpdatedAt} />
      </div>
    </header>
    {loadError && <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><span>{t('loadError')}</span><button type="button" onClick={retry} className="shrink-0 underline underline-offset-2">{t('retry')}</button></div>}
    <section aria-label={t('overview')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-500">{loading ? <span>{c('loading')}</span> : loadedRangeLabel !== selectedRangeLabel ? <span>{loadedRangeLabel}</span> : null}{operations && <span title={comparisonHint} className="cursor-help underline decoration-dotted underline-offset-4">{op(loadedRange.preset === 'today' ? 'compareYesterday' : 'comparePrevious')}</span>}

        {snapshot && <span role="status">{t('liveRefresh.updatedAt', { time: formatTime(new Date(snapshot.updatedAt).toISOString()) })}</span>}
      </div></div>
      <div className="admin-summary-canvas grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4 2xl:grid-cols-6">
        <Metric icon={ArrowsRightLeftIcon} tone="bg-blue-50 text-blue-700" label={t('requests')} scope={scope} value={hasMetrics ? count : null} format={formatCount} change={change(count, baseline?.requests, 'count')}>{hasMetrics ? <span className="flex flex-wrap gap-x-2"><span className="whitespace-nowrap">{op('activeUsers',{count:kpi.activeUsers})}</span><span className="whitespace-nowrap">{formatCompactTokens(kpi.totalTokens ?? 0)} Token</span></span> : '—'}</Metric>
        <Metric icon={ShieldCheckIcon} tone="bg-emerald-50 text-emerald-700" label={t('successRate')} scope={scope} value={hasTraffic ? kpi!.successRate : null} format={value => `${value.toFixed(1)}%`} change={change(hasTraffic ? kpi?.successRate : null, baseline && baseline.requests > 0 ? baseline.success / baseline.requests * 100 : null, 'rate')}>{hasTraffic && errorRate > 0 ? <Link href={errorsHref} className="inline-flex items-center gap-1 hover:text-gray-950"><span className="flex min-w-0 flex-wrap gap-x-2"><span className="whitespace-nowrap">{op('errorCount',{count:operations?.current.errors ?? Math.round(count*errorRate/100)})}</span></span><ArrowUpRightIcon className="h-3 w-3 shrink-0" aria-hidden /></Link> : hasTraffic ? null : hasMetrics ? t('waitingForRequests') : '—'}</Metric>
        <Metric icon={BoltIcon} tone="bg-cyan-50 text-cyan-700" label={op('ttftP95')} scope={scope} value={operations?.current.ttftP95} format={formatLatency} change={change(operations?.current.ttftP95, baseline?.ttftP95, 'latency')}>{(operations?.current.ttftSamples ?? 0) > 0 ? <Link href={dashboardLogsHref(loadedRange,{status:'success'})} className="inline-flex max-w-full items-center gap-1 hover:text-gray-950" title={op('ttftHint')}>{operations ? <span className="flex min-w-0 flex-wrap gap-x-2"><span className="whitespace-nowrap">{op('median',{value:operations.current.ttftP50 == null ? '—' : formatLatency(operations.current.ttftP50)})}</span><span className="whitespace-nowrap">{op('sampleCount',{count:operations.current.ttftSamples})}</span></span> : '—'}<ArrowUpRightIcon className="h-3 w-3 shrink-0" aria-hidden /></Link> : <span>{operations ? review('noTimingSamples') : '—'}</span>}</Metric>
        <Metric icon={ClockIcon} tone="bg-amber-50 text-amber-700" label={op('latencyP95')} scope={scope} value={operations?.current.latencyP95} format={formatLatency} change={change(operations?.current.latencyP95, baseline?.latencyP95, 'latency')}>{(operations?.current.latencySamples ?? 0) > 0 ? <Link href={dashboardLogsHref(loadedRange,{status:'success'})} className="inline-flex max-w-full items-center gap-1 hover:text-gray-950" title={op('latencyHint')}>{operations ? <span className="flex min-w-0 flex-wrap gap-x-2"><span className="whitespace-nowrap">{op('median',{value:operations.current.latencyP50 == null ? '—' : formatLatency(operations.current.latencyP50)})}</span><span className="whitespace-nowrap">{op('sampleCount',{count:operations.current.latencySamples})}</span></span> : '—'}<ArrowUpRightIcon className="h-3 w-3 shrink-0" aria-hidden /></Link> : <span>{operations ? review('noTimingSamples') : '—'}</span>}</Metric>
        <Metric icon={BanknotesIcon} tone="bg-violet-50 text-violet-700" label={t('chargedCost')} scope={scope} value={hasMetrics ? kpi?.totalCost : null} format={value => formatGatewayMoneyCode(value, currency, 4)} change={change(kpi?.totalCost, baseline?.charged, 'money')}>{hasTraffic ? t('avgRequestCost', { amount: formatGatewayMoneyCode(kpi!.totalCost / count, currency, 6) }) : hasMetrics ? t('noCharges') : '—'}</Metric>
        <Metric icon={BanknotesIcon} tone="bg-orange-50 text-orange-700" label={op('metered')} scope={scope} value={operations?.current.metered} format={value => formatGatewayMoneyCode(value,currency,4)} change={change(operations?.current.metered,baseline?.metered,'money')} />
      </div>
    </section>
    <div className={`grid min-w-0 items-stretch gap-5 ${hasTraffic ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
      <DashboardTokenTrendChart timeseries={stats?.timeseries ?? []} granularity={stats?.granularity ?? 'hour'} billingCurrency={currency} businessTimezone={businessTimezone} onExplore={range.preset === '7d' ? undefined : exploreWeek}
        throughput={hasMetrics ? {rpm:kpi.rpm ?? 0,tpm:kpi.tpm ?? 0,scope} : undefined} />
      {hasTraffic && <div className="grid min-w-0 content-start gap-5 sm:grid-cols-2 xl:grid-cols-1">
        {operations && <DashboardCosts operations={operations} range={loadedRange} currency={currency} scope={scope} />}
        <DashboardTokenSummary kpi={kpi} rangeLabel={loadedRangeLabel} scope={scope} />
      </div>}
    </div>
    {operations && hasTraffic && <DashboardOperations operations={operations} range={loadedRange} />}
    <div className={`grid min-w-0 items-stretch gap-5 ${hasTraffic ? 'xl:grid-cols-2' : ''}`}>
      {hasTraffic && <DashboardModelDistributionChart motionScope={scope} modelDistribution={stats?.modelDistribution ?? []} topUsers={stats?.topUsers ?? []} billingCurrency={currency} range={loadedRange} rangeLabel={loadedRangeLabel} />}
      <DashboardActivity billingCurrency={currency} logs={stats?.recentLogs ?? []} errors={stats?.recentErrors ?? []} />
    </div>
    <DashboardMetricDefinitions />
  </div>;
}
