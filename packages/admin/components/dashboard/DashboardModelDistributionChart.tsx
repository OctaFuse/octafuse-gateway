'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRightIcon, CircleStackIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardModelDistributionRow, DashboardTopUserRow, KpiMetrics } from '@/lib/types';
import type { GatewayTimeRangeValue } from '@/lib/analytics-range';
import { useDashboardListMotion } from './use-dashboard-list-motion';
import { dashboardLogsHref } from './dashboard-links';

type ViewMode = 'models' | 'users';
export type DashboardModelDistributionChartProps = {
  motionScope?: string; modelDistribution: DashboardModelDistributionRow[]; topUsers: DashboardTopUserRow[]; billingCurrency: string; range: GatewayTimeRangeValue; kpi?: KpiMetrics;
};

export function DashboardModelDistributionChart({ modelDistribution, topUsers, billingCurrency, range, kpi, motionScope = '' }: DashboardModelDistributionChartProps) {
  const t = useTranslations('dashboard');
  const review = useTranslations('dashboard.review');
  const rowsRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewMode>('models');
  const rows = useMemo(() => {
    const items = view === 'models' ? modelDistribution.map(row => ({ key: row.model_id, requests: row.request_count, tokens: row.total_tokens, cost: row.charged_cost, value: row.request_count }))
      : topUsers.map(row => ({ key: row.user_email, requests: row.request_count, tokens: row.total_tokens, cost: row.charged_cost, value: row.charged_cost }));
    const sorted = items.sort((a, b) => b.value - a.value);
    const max = Math.max(...sorted.map(row => row.value), 0);
    return sorted.slice(0, 5).map(row => ({ ...row, width: max > 0 ? row.value / max * 100 : 0 }));
  }, [view, modelDistribution, topUsers]);
  useDashboardListMotion(rowsRef, `${motionScope}:${view}`, JSON.stringify(rows.map(row => row.key)));
  const cacheReadShare = kpi?.inputTokens != null && kpi.inputTokens > 0 && kpi.cacheReadTokens != null
    ? (kpi.cacheReadTokens / kpi.inputTokens * 100).toFixed(1) : '—';
  const analysisHref = `/gateway/analytics/${view === 'models' ? 'models' : 'users'}?${new URLSearchParams({start_date:range.start_date,end_date:range.end_date,range:'custom'})}`;
  return <section className="admin-content-panel flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="admin-section-title flex items-center gap-2 text-sm font-medium text-gray-900"><Squares2X2Icon className="h-4 w-4 text-gray-500" aria-hidden />{review(view === 'models' ? 'modelUsage' : 'userSpend')}</h2>
      <div className="flex items-center gap-2"><div className="inline-flex rounded-lg bg-gray-100 p-1" role="group" aria-label={t('usageBreakdown')}>
        {(['models', 'users'] as const).map(tab => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => { setView(tab); }} className={`rounded-md px-3 py-1 text-xs transition-colors ${view === tab ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>{t(tab === 'models' ? 'modelDistributionTab' : 'userLeaderboardTab')}</button>)}
      </div><Link href={analysisHref} className="inline-flex items-center gap-1 rounded px-1 py-1 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900" aria-label={review('usageAnalysis')}><span>{review('usageAnalysis')}</span><ArrowUpRightIcon className="h-3.5 w-3.5" aria-hidden /></Link></div>
    </div>
    {rows.length ? <div ref={rowsRef} role="region" aria-label={review(view === 'models' ? 'modelUsage' : 'userSpend')} className="mt-3 divide-y divide-gray-100">
      {rows.map((row, index) => <Link key={row.key} data-dashboard-item={row.key} href={dashboardLogsHref(range, { [view === 'models' ? 'model_id' : 'user_email']: row.key })} className="group -mx-2 flex min-w-0 items-start gap-3 rounded-lg px-2 py-3 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" aria-label={t('inspectUsage', { name: row.key })}>
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 font-mono text-xs text-gray-500">{index + 1}</span>
        <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center justify-between gap-3"><span className="truncate text-sm text-gray-900" title={row.key}>{row.key}</span><span className="shrink-0 font-mono text-sm tabular-nums text-gray-900">{view === 'models' ? row.requests.toLocaleString() : formatGatewayMoneyCode(row.cost, billingCurrency, 4)}</span></div>
          {(row.tokens > 0 || row.cost > 0 || view === 'users') && <div className="mt-1 flex justify-between gap-3 text-xs text-gray-500">{row.tokens > 0 && <span className="whitespace-nowrap">{formatCompactTokens(row.tokens)} Token</span>}<span className="ml-auto shrink-0 whitespace-nowrap tabular-nums">{view === 'models' ? formatGatewayMoneyCode(row.cost, billingCurrency, 4) : t('requestCount', { count: row.requests })}</span></div>}
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100" aria-hidden><div className={`h-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none ${index === 0 ? 'bg-blue-500' : 'bg-gray-300'}`} style={{ transform: `scaleX(${row.width / 100})` }} /></div>
        </div><ArrowUpRightIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-gray-900" aria-hidden />
      </Link>)}
    </div> : <p className="py-10 text-center text-sm text-gray-500">{t('noChartData')}</p>}
    {(kpi?.totalTokens ?? 0) > 0 && <div className="pt-4">
      <div className="rounded-lg bg-gray-50 p-4">
        <h3 className="flex items-center gap-2 text-xs font-medium text-gray-700"><CircleStackIcon className="h-4 w-4 text-blue-600" aria-hidden />{t('tokenSummary')}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[{ label: t('inputTokens'), value: kpi?.inputTokens }, { label: t('outputTokens'), value: kpi?.outputTokens }, { label: t('cacheReadTokens'), value: kpi?.cacheReadTokens }].map(item => <div key={item.label} className="min-w-0"><dt title={item.label === t('inputTokens') ? review('inputHint') : undefined} className="text-xs leading-5 text-gray-500">{item.label}</dt><dd className="mt-1 break-all font-mono text-lg tabular-nums text-gray-950" title={item.value?.toLocaleString()}>{item.value == null ? '—' : formatCompactTokens(item.value)}</dd></div>)}
          <div className="min-w-0"><dt className="text-xs leading-5 text-gray-500">{review('cacheShare')}</dt><dd className="mt-1 whitespace-nowrap font-mono text-lg tabular-nums text-gray-950">{cacheReadShare === '—' ? '—' : `${cacheReadShare}%`}</dd></div>
        </dl>

      </div>
    </div>}
  </section>;
}
