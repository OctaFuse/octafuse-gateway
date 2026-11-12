'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

/** Overview: selected-window metrics and trends, live access snapshot, global recent activity. */
import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowUpRightIcon, ArrowsRightLeftIcon, BanknotesIcon, BoltIcon, ClockIcon, KeyIcon, ShieldCheckIcon, UsersIcon } from '@heroicons/react/24/outline';
import { DashboardRangeControl } from '@/components/dashboard/DashboardRangeControl';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { DashboardModelDistributionChart } from '@/components/dashboard/DashboardModelDistributionChart';
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
import { dashboardDelta } from '@/components/dashboard/dashboard-live';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

function Metric({ icon: Icon, tone, label, value, format, scope, change, children }: {
  icon: ComponentType<{ className?: string }>; tone: string; label: string;
  value: number | null | undefined; format: (value: number) => string; scope: string;
  change?: { label: string; hint: string; tone: string } | null; children: ReactNode;
}) {
  return <div className="admin-content-panel min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <div className="flex min-h-8 items-center gap-2"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 flex-1 text-xs leading-4 text-gray-600">{label}</span>
      {change && <span title={change.hint} aria-label={change.hint} className={`hidden max-w-[45%] shrink-0 truncate rounded px-1.5 py-0.5 font-mono text-[10px] sm:inline-flex tabular-nums ${change.tone}`}>{change.label}</span>}
    </div>
    <p className="mt-3 truncate font-mono text-[28px] font-medium leading-tight tabular-nums text-gray-950 sm:text-3xl"><DashboardNumber value={value} format={format} scope={scope} /></p>
    <div className="mt-1 min-h-4 sm:hidden">{change && <span title={change.hint} aria-label={change.hint} className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${change.tone}`}>{change.label}</span>}</div>
    <div className="mt-2 min-h-5 text-xs leading-5 text-gray-500">{children}</div>
  </div>;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const c = useTranslations('common');
  const tr = useTranslations('timeRange');
  const [range, setRange] = useAnalyticsRange();
  const [rangeOpen, setRangeOpen] = useState(false);
  const { currency } = useBillingCurrency();
  const { businessTimezone, formatTime } = useGatewayDateTime();
  const pausedHint = rangeOpen ? t('liveRefresh.pausedDialog') : range.preset === 'custom' ? t('liveRefresh.pausedRange') : undefined;
  const { snapshot, loading, loadError, intervalMs, controls } = useDashboardSnapshot(range, businessTimezone, Boolean(pausedHint));
  const stats = snapshot?.data;
  const previous = snapshot?.previous?.kpi;
  const loadedRange = snapshot?.range ?? range;
  const scope = snapshot?.scope ?? 'initial';
  const rangeLabel = (value: GatewayTimeRangeValue) => formatGatewayRangeSummary(value, p => t(`rangeLabels.${p}`), tr('custom'), businessTimezone);
  const selectedRangeLabel = rangeLabel(range);
  const loadedRangeLabel = rangeLabel(loadedRange);
  const logsHref = useMemo(() => dashboardLogsHref(loadedRange), [loadedRange]);
  const errorsHref = useMemo(() => dashboardLogsHref(loadedRange, { status: 'error' }), [loadedRange]);
  const kpi = stats?.kpi;
  const hasMetrics = kpi != null;
  const count = kpi?.totalRequests ?? 0;
  const hasTraffic = hasMetrics && count > 0;
  const errorRate = kpi?.errorRate ?? 0;
  const state = !hasTraffic ? 'idle' : errorRate >= 5 ? 'critical' : errorRate >= 1 ? 'watch' : 'healthy';
  const statusStyle = { idle: 'text-gray-500', healthy: 'text-emerald-700', watch: 'text-amber-700', critical: 'text-rose-700' }[state];
  const latency = kpi?.avgLatencyMs;
  const formatLatency = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  const formatCount = (value: number) => Math.round(value).toLocaleString();
  const change = (value: number | null | undefined, before: number | null | undefined, kind: 'count' | 'rate' | 'latency' | 'money') => {
    const delta = dashboardDelta(value, before, kind === 'rate' ? 0.05 : kind === 'money' ? 0.00005 : kind === 'latency' && (value ?? 0) >= 1000 ? 10 : 1);
    if (delta == null) return null;
    const amount = Math.abs(delta);
    const text = kind === 'rate' ? t('liveRefresh.points', { value: amount.toFixed(1) }) : kind === 'latency' ? formatLatency(amount)
      : kind === 'money' ? formatGatewayMoneyCode(amount, currency, 4) : formatCount(amount);
    const label = `${delta > 0 ? '+' : '−'}${text}`;
    const better = kind === 'rate' ? delta > 0 : kind === 'latency' ? delta < 0 : null;
    return { label, hint: t('liveRefresh.changeSinceRefresh', { value: label }), tone: better === true ? 'bg-emerald-50 text-emerald-700' : better === false ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700' };
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-500"><span>{loading ? c('loading') : loadedRangeLabel}</span>
        {intervalMs !== 'off' && <span className={`inline-flex items-center gap-1.5 ${pausedHint ? 'text-gray-500' : 'text-blue-700'}`} title={pausedHint}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{pausedHint ? t('liveRefresh.paused') : t('liveRefresh.following')}</span>}
        {snapshot && <span role="status">{t('liveRefresh.updatedAt', { time: formatTime(new Date(snapshot.updatedAt).toISOString()) })}</span>}
      </div><span className={`inline-flex items-center gap-1.5 ${statusStyle}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{hasMetrics ? t(`status.${state}`) : '—'}</span></div>
      <div className="admin-summary-canvas grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Metric icon={ArrowsRightLeftIcon} tone="bg-blue-50 text-blue-700" label={t('requests')} scope={scope} value={hasMetrics ? count : null} format={formatCount} change={change(count, previous?.totalRequests, 'count')}>{hasMetrics ? t('requestContext', { users: kpi.activeUsers, tokens: formatCompactTokens(kpi.totalTokens ?? 0) }) : '—'}</Metric>
        <Metric icon={ShieldCheckIcon} tone="bg-emerald-50 text-emerald-700" label={t('successRate')} scope={scope} value={hasTraffic ? kpi!.successRate : null} format={value => `${value.toFixed(1)}%`} change={change(hasTraffic ? kpi?.successRate : null, (previous?.totalRequests ?? 0) > 0 ? previous?.successRate : null, 'rate')}>{hasTraffic ? <Link href={errorsHref} className="inline-flex items-center gap-1 hover:text-gray-950">{t('errorContext', { count: Math.round(count * errorRate / 100), rate: errorRate.toFixed(2) })}<ArrowUpRightIcon className="h-3 w-3 shrink-0" aria-hidden /></Link> : hasMetrics ? t('waitingForRequests') : '—'}</Metric>
        <Metric icon={ClockIcon} tone="bg-amber-50 text-amber-700" label={t('avgLatency')} scope={scope} value={hasTraffic ? latency : null} format={formatLatency} change={change(hasTraffic ? latency : null, (previous?.totalRequests ?? 0) > 0 ? previous?.avgLatencyMs : null, 'latency')}>{hasTraffic ? <Link href={logsHref} className="inline-flex items-center gap-1 hover:text-gray-950">{t('inspectRequests')}<ArrowUpRightIcon className="h-3 w-3 shrink-0" aria-hidden /></Link> : hasMetrics ? t('waitingForRequests') : '—'}</Metric>
        <Metric icon={BanknotesIcon} tone="bg-violet-50 text-violet-700" label={t('chargedCost')} scope={scope} value={hasMetrics ? kpi?.totalCost : null} format={value => formatGatewayMoneyCode(value, currency, 4)} change={change(kpi?.totalCost, previous?.totalCost, 'money')}>{hasTraffic ? t('avgRequestCost', { amount: formatGatewayMoneyCode(kpi!.totalCost / count, currency, 6) }) : hasMetrics ? t('noCharges') : '—'}</Metric>
      </div>
    </section>
    <div className="grid min-w-0 items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <DashboardTokenTrendChart timeseries={stats?.timeseries ?? []} granularity={stats?.granularity ?? 'hour'} billingCurrency={currency} businessTimezone={businessTimezone} onExplore={range.preset === '7d' ? undefined : exploreWeek} />
      <section className="admin-content-panel flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="admin-section-title flex items-center gap-2 text-sm font-medium text-gray-900"><BoltIcon className="h-4 w-4 text-blue-600" aria-hidden />{t('liveSnapshot')}</h2>
        <p className="mt-1 text-xs text-gray-500">{t('throughput')}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 border-b border-gray-100 pb-5">
          <div><p className="font-mono text-2xl tabular-nums text-gray-950"><DashboardNumber value={hasMetrics ? kpi?.rpm ?? 0 : null} format={formatCount} scope={scope} /></p><p className="mt-1 text-xs text-gray-500">RPM</p></div>
          <div><p className="font-mono text-2xl tabular-nums text-gray-950"><DashboardNumber value={hasMetrics ? kpi?.tpm ?? 0 : null} format={value => formatCompactTokens(Math.round(value))} scope={scope} /></p><p className="mt-1 text-xs text-gray-500">TPM</p></div>
        </div>
        <p className="mt-4 text-xs text-gray-500">{t('gatewayAccessHint')}</p>
        <div className="mt-2 space-y-1">
          {[{ href: '/gateway/keys', label: t('activeKeys'), active: stats?.gateway?.keysActive, total: stats?.gateway?.keysTotal, Icon: KeyIcon }, { href: '/gateway/users', label: t('activeAccounts'), active: stats?.gateway?.accountsActive, total: stats?.gateway?.accountsTotal, Icon: UsersIcon }].map(({ href, label, active, total, Icon }) => <Link key={href} href={href} className="group -mx-2 flex items-center gap-2 rounded-lg px-2 py-3 text-sm hover:bg-gray-50"><Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden /><span className="min-w-0 flex-1 text-gray-600">{label}</span><span className="shrink-0 font-mono text-sm tabular-nums text-gray-900">{active ?? '—'}<span className="text-xs text-gray-500"> / {total ?? '—'}</span></span><ArrowUpRightIcon className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-900" aria-hidden /></Link>)}
        </div>
        <p className="mt-auto border-t border-gray-100 pt-4 text-xs leading-5 text-gray-500">{t('liveScope')}</p>
      </section>
    </div>
    <div className="grid min-w-0 items-stretch gap-5 xl:grid-cols-2">
      <DashboardModelDistributionChart motionScope={scope} modelDistribution={stats?.modelDistribution ?? []} topUsers={stats?.topUsers ?? []} billingCurrency={currency} range={loadedRange} kpi={kpi} />
      <DashboardActivity logs={stats?.recentLogs ?? []} errors={stats?.recentErrors ?? []} />
    </div>
  </div>;
}
