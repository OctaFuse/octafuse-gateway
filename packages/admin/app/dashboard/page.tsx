'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

/** Overview: selected-window metrics and trends, live access snapshot, global recent activity. */
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowPathIcon, ArrowUpRightIcon, ArrowsRightLeftIcon, BanknotesIcon, BoltIcon, ClockIcon, KeyIcon, ShieldCheckIcon, UsersIcon } from '@heroicons/react/24/outline';
import { DashboardRangeControl } from '@/components/dashboard/DashboardRangeControl';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { DashboardModelDistributionChart } from '@/components/dashboard/DashboardModelDistributionChart';
import { DashboardTokenTrendChart } from '@/components/dashboard/DashboardTokenTrendChart';
import { dashboardLogsHref } from '@/components/dashboard/dashboard-links';
import { createRangeValue, formatGatewayRangeSummary, isRollingPreset, type GatewayTimeRangeValue } from '@/lib/analytics-range';
import { readApiJson } from '@/lib/api-json';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardStats } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useAnalyticsRange } from '@/lib/use-analytics-range';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

function Metric({ icon: Icon, tone, label, value, children }: { icon: ComponentType<{ className?: string }>; tone: string; label: string; value: string; children: ReactNode }) {
  return <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <div className="flex min-h-8 items-center gap-2"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span><span className="text-xs leading-4 text-gray-600">{label}</span></div>
    <p title={value} className="mt-3 truncate font-mono text-[28px] font-medium leading-tight tabular-nums text-gray-950 sm:text-3xl">{value}</p>
    <div className="mt-2 min-h-5 text-xs leading-5 text-gray-500">{children}</div>
  </div>;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const c = useTranslations('common');
  const tr = useTranslations('timeRange');
  const [range, setRange] = useAnalyticsRange();
  const [loadedRange, setLoadedRange] = useState<GatewayTimeRangeValue>(range);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { currency } = useBillingCurrency();
  const { businessTimezone } = useGatewayDateTime();
  const rangeLabel = (value: GatewayTimeRangeValue) => formatGatewayRangeSummary(value, p => t(`rangeLabels.${p}`), tr('custom'), businessTimezone);
  const selectedRangeLabel = rangeLabel(range);
  const loadedRangeLabel = rangeLabel(loadedRange);
  const { start_date, end_date, preset } = range;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(false);
    const query = new URLSearchParams({ start_date, end_date });
    if (isRollingPreset(preset)) query.set('range', preset);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/stats?${query}`, { signal: controller.signal });
        const result = await readApiJson<DashboardStats>(response);
        if (controller.signal.aborted) return;
        if (result.success && result.data) { setStats(result.data); setLoadedRange({ preset, start_date, end_date }); }
        else setLoadError(true);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [start_date, end_date, preset, refresh]);

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
  const latencyLabel = !hasTraffic || latency == null ? '—' : latency >= 1000 ? `${(latency / 1000).toFixed(2)}s` : `${Math.round(latency)}ms`;
  const retry = () => {
    if (range.preset !== 'custom') setRange(createRangeValue(range.preset, businessTimezone));
    setRefresh(v => v + 1);
  };

  return <div className="min-h-full min-w-0 space-y-5 p-4 sm:space-y-6 sm:p-6 lg:p-8" aria-busy={loading}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><AdminPageTitle>{t('title')}</AdminPageTitle><p className="mt-1 text-sm text-gray-500">{t('overviewSubtitle')}</p></div>
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <DashboardRangeControl value={range} label={selectedRangeLabel} timeZone={businessTimezone} onChange={setRange} />
        <button type="button" aria-label={t('refresh')} disabled={loading} onClick={retry} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 disabled:opacity-50"><ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /></button>
      </div>
    </header>
    {loadError && <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><span>{t('loadError')}</span><button type="button" onClick={retry} className="shrink-0 underline underline-offset-2">{t('retry')}</button></div>}
    <section aria-label={t('overview')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-gray-500">{loading ? c('loading') : loadedRangeLabel}</span><span className={`inline-flex items-center gap-1.5 ${statusStyle}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{hasMetrics ? t(`status.${state}`) : '—'}</span></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Metric icon={ArrowsRightLeftIcon} tone="bg-blue-50 text-blue-700" label={t('requests')} value={hasMetrics ? count.toLocaleString() : '—'}>{hasMetrics ? t('requestContext', { users: kpi.activeUsers, tokens: formatCompactTokens(kpi.totalTokens ?? 0) }) : '—'}</Metric>
        <Metric icon={ShieldCheckIcon} tone="bg-emerald-50 text-emerald-700" label={t('successRate')} value={hasTraffic ? `${kpi!.successRate.toFixed(1)}%` : '—'}>{hasTraffic ? <Link href={errorsHref} className="inline-flex items-center gap-1 hover:text-gray-950">{t('errorContext', { count: Math.round(count * errorRate / 100), rate: errorRate.toFixed(2) })}<ArrowUpRightIcon className="h-3 w-3 shrink-0" aria-hidden /></Link> : hasMetrics ? t('waitingForRequests') : '—'}</Metric>
        <Metric icon={ClockIcon} tone="bg-amber-50 text-amber-700" label={t('avgLatency')} value={latencyLabel}>{hasTraffic ? <Link href={logsHref} className="inline-flex items-center gap-1 hover:text-gray-950">{t('inspectRequests')}<ArrowUpRightIcon className="h-3 w-3 shrink-0" aria-hidden /></Link> : hasMetrics ? t('waitingForRequests') : '—'}</Metric>
        <Metric icon={BanknotesIcon} tone="bg-violet-50 text-violet-700" label={t('chargedCost')} value={hasMetrics ? formatGatewayMoneyCode(kpi.totalCost, currency, 4) : '—'}>{hasTraffic ? t('avgRequestCost', { amount: formatGatewayMoneyCode(kpi!.totalCost / count, currency, 6) }) : hasMetrics ? t('noCharges') : '—'}</Metric>
      </div>
    </section>
    <div className="grid min-w-0 items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <DashboardTokenTrendChart timeseries={stats?.timeseries ?? []} granularity={stats?.granularity ?? 'hour'} billingCurrency={currency} businessTimezone={businessTimezone} onExplore={range.preset === '7d' ? undefined : () => setRange(createRangeValue('7d', businessTimezone))} />
      <section className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-medium text-gray-900"><BoltIcon className="h-4 w-4 text-blue-600" aria-hidden />{t('liveSnapshot')}</h2>
        <p className="mt-1 text-xs text-gray-500">{t('throughput')}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 border-b border-gray-100 pb-5">
          <div><p className="font-mono text-2xl tabular-nums text-gray-950">{hasMetrics ? (kpi.rpm ?? 0).toLocaleString() : '—'}</p><p className="mt-1 text-xs text-gray-500">RPM</p></div>
          <div><p className="font-mono text-2xl tabular-nums text-gray-950">{hasMetrics ? formatCompactTokens(kpi.tpm ?? 0) : '—'}</p><p className="mt-1 text-xs text-gray-500">TPM</p></div>
        </div>
        <p className="mt-4 text-xs text-gray-500">{t('gatewayAccessHint')}</p>
        <div className="mt-2 space-y-1">
          {[{ href: '/gateway/keys', label: t('activeKeys'), active: stats?.gateway?.keysActive, total: stats?.gateway?.keysTotal, Icon: KeyIcon }, { href: '/gateway/users', label: t('activeAccounts'), active: stats?.gateway?.accountsActive, total: stats?.gateway?.accountsTotal, Icon: UsersIcon }].map(({ href, label, active, total, Icon }) => <Link key={href} href={href} className="group -mx-2 flex items-center gap-2 rounded-lg px-2 py-3 text-sm hover:bg-gray-50"><Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden /><span className="min-w-0 flex-1 text-gray-600">{label}</span><span className="shrink-0 font-mono text-sm tabular-nums text-gray-900">{active ?? '—'}<span className="text-xs text-gray-500"> / {total ?? '—'}</span></span><ArrowUpRightIcon className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-900" aria-hidden /></Link>)}
        </div>
        <p className="mt-auto border-t border-gray-100 pt-4 text-xs leading-5 text-gray-500">{t('liveScope')}</p>
      </section>
    </div>
    <div className="grid min-w-0 items-stretch gap-5 xl:grid-cols-2">
      <DashboardModelDistributionChart modelDistribution={stats?.modelDistribution ?? []} topUsers={stats?.topUsers ?? []} billingCurrency={currency} range={loadedRange} kpi={kpi} />
      <DashboardActivity logs={stats?.recentLogs ?? []} errors={stats?.recentErrors ?? []} />
    </div>
  </div>;
}
