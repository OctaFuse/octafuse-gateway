'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRightIcon, CircleStackIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardModelDistributionRow, DashboardTopUserRow, KpiMetrics } from '@/lib/types';
import type { GatewayTimeRangeValue } from '@/lib/analytics-range';
import { dashboardLogsHref } from './dashboard-links';

type ViewMode = 'models' | 'users';
export type DashboardModelDistributionChartProps = {
  modelDistribution: DashboardModelDistributionRow[]; topUsers: DashboardTopUserRow[]; billingCurrency: string; range: GatewayTimeRangeValue; kpi?: KpiMetrics;
};

export function DashboardModelDistributionChart({ modelDistribution, topUsers, billingCurrency, range, kpi }: DashboardModelDistributionChartProps) {
  const t = useTranslations('dashboard');
  const [view, setView] = useState<ViewMode>('models');
  const rows = useMemo(() => {
    const items = view === 'models' ? modelDistribution.map(row => ({ key: row.model_id, requests: row.request_count, tokens: row.total_tokens, cost: row.charged_cost, value: row.request_count }))
      : topUsers.map(row => ({ key: row.user_email, requests: row.request_count, tokens: row.total_tokens, cost: row.charged_cost, value: row.charged_cost }));
    const sorted = items.sort((a, b) => b.value - a.value);
    const max = Math.max(...sorted.map(row => row.value), 0);
    return sorted.slice(0, 5).map(row => ({ ...row, width: max > 0 ? row.value / max * 100 : 0 }));
  }, [view, modelDistribution, topUsers]);
  const cacheReadShare = kpi?.inputTokens != null && kpi.inputTokens > 0 && kpi.cacheReadTokens != null
    ? (kpi.cacheReadTokens / kpi.inputTokens * 100).toFixed(1) : '—';
  return <section className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-gray-900"><Squares2X2Icon className="h-4 w-4 text-gray-500" aria-hidden />{t('usageBreakdown')}</h2>
      <div className="inline-flex rounded-lg bg-gray-100 p-1" role="group" aria-label={t('usageBreakdown')}>
        {(['models', 'users'] as const).map(tab => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => setView(tab)} className={`rounded-md px-3 py-1 text-xs transition-colors ${view === tab ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>{t(tab === 'models' ? 'modelDistributionTab' : 'userLeaderboardTab')}</button>)}
      </div>
    </div>
    <p className="mt-2 text-xs leading-5 text-gray-500">{t(view === 'models' ? 'modelBreakdownHint' : 'userBreakdownHint')}</p>
    {rows.length ? <div className="mt-3 divide-y divide-gray-100">
      {rows.map((row, index) => <Link key={row.key} href={dashboardLogsHref(range, { [view === 'models' ? 'model_id' : 'user_email']: row.key })} className="group -mx-2 flex min-w-0 items-start gap-3 rounded-lg px-2 py-3 hover:bg-gray-50" aria-label={t('inspectUsage', { name: row.key })}>
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 font-mono text-xs text-gray-500">{index + 1}</span>
        <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center justify-between gap-3"><span className="truncate text-sm text-gray-900" title={row.key}>{row.key}</span><span className="shrink-0 font-mono text-sm tabular-nums text-gray-900">{view === 'models' ? row.requests.toLocaleString() : formatGatewayMoneyCode(row.cost, billingCurrency, 4)}</span></div>
          <div className="mt-1 flex justify-between gap-3 text-xs text-gray-500"><span>{formatCompactTokens(row.tokens)} Token</span><span className="shrink-0 tabular-nums">{view === 'models' ? formatGatewayMoneyCode(row.cost, billingCurrency, 4) : t('requestCount', { count: row.requests })}</span></div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100" aria-hidden><div className={`h-full rounded-full ${index === 0 ? 'bg-blue-500' : 'bg-gray-300'}`} style={{ width: `${row.width}%` }} /></div>
        </div><ArrowUpRightIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-gray-900" aria-hidden />
      </Link>)}
    </div> : <p className="py-10 text-center text-sm text-gray-500">{t('noChartData')}</p>}
    <div className="mt-auto pt-5">
      <div className="rounded-lg bg-gray-50 p-4">
        <h3 className="flex items-center gap-2 text-xs font-medium text-gray-700"><CircleStackIcon className="h-4 w-4 text-blue-600" aria-hidden />{t('tokenSummary')}</h3>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          {[{ label: t('inputTokens'), value: kpi?.inputTokens }, { label: t('outputTokens'), value: kpi?.outputTokens }, { label: t('cacheReadTokens'), value: kpi?.cacheReadTokens }].map(item => <div key={item.label} className="min-w-0"><dt className="text-xs leading-5 text-gray-500">{item.label}</dt><dd className="mt-1 break-all font-mono text-lg tabular-nums text-gray-950" title={item.value?.toLocaleString()}>{item.value == null ? '—' : formatCompactTokens(item.value)}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs leading-5 text-gray-500">{t('cacheReadShare', { rate: cacheReadShare === '—' ? cacheReadShare : `${cacheReadShare}%` })}</p>
      </div>
    </div>
    <div className="mt-4 flex justify-end border-t border-gray-100 pt-3"><Link href={dashboardLogsHref(range)} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-950">{t('inspectRequests')}<ArrowUpRightIcon className="h-3 w-3" aria-hidden /></Link></div>
  </section>;
}
