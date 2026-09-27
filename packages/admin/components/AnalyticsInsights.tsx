'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { summarizeAnalytics, type AnalyticsSummaryRow, type AnalyticsView } from '@/lib/analytics-insights';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';

export function AnalyticsInsights({ rows, currency, scope }: {
  rows: readonly AnalyticsSummaryRow[]; currency: string; scope: 'models' | 'providers' | 'users' | 'reliability';
}) {
  const t = useTranslations('analytics.insights');
  const s = summarizeAnalytics(rows);
  const money = (n: number) => formatGatewayMoneyCode(n, currency, 4);
  const cards = [
    [t('requests'), s.requests.toLocaleString()],
    [t('successRate'), s.successRate == null ? '—' : `${s.successRate.toFixed(1)}%`],
    [t('errors'), s.errors.toLocaleString()],
    [t('charged'), money(s.charged)],
    [t('metered'), money(s.metered)],
    [t('margin'), money(s.margin)],
  ];
  return <section className="mb-4 space-y-3" aria-label={t('summary')}>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
      {cards.map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="mt-2 break-words text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      </div>)}
    </div>
    <div className="space-y-2 text-xs text-gray-500">
      <p>{t('outcomes', { success: Math.round(s.successes), errors: s.errors, other: Math.max(0, Math.round(s.requests - s.successes - s.errors)) })}</p>
      {s.requests > 0 && <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
        <div className="bg-emerald-500" style={{ width: `${s.successRate}%` }} />
        <div className="bg-red-400" style={{ width: `${100 * s.errors / s.requests}%` }} />
      </div>}
    </div>
    <details className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
      <summary className="cursor-pointer font-medium">{t('definitions')}</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>{t('scope.' + scope)}</p>
        <p>{t('costNote', { standard: money(s.standard) })}</p>
        <p>{t('qualityNote')}</p>
        {scope === 'users' && <p>{t('budgetNote')}</p>}
      </div>
    </details>
  </section>;
}

export function AnalyticsControls({ search, onSearch, view, onView, users = false, count, children }: {
  search: string; onSearch: (value: string) => void; view: AnalyticsView;
  onView: (value: AnalyticsView) => void; users?: boolean; count: number; children?: ReactNode;
}) {
  const t = useTranslations('analytics.insights');
  const views: AnalyticsView[] = ['overview', 'cost', users ? 'budget' : 'performance', 'all'];
  return <div className="mb-4 flex flex-wrap items-center gap-3">
    {children}
    <input aria-label={t('search')} placeholder={t('search')} value={search} onChange={e => onSearch(e.target.value)}
      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm sm:max-w-sm" />
    <div className="flex flex-wrap gap-1" role="group" aria-label={t('view')}>
      {views.map(v => <button key={v} type="button" aria-pressed={v === view} onClick={() => onView(v)}
        className={`rounded-lg px-3 py-2 text-sm ${v === view ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>{t('views.' + v)}</button>)}
    </div>
    <span className="text-xs text-gray-500">{t('matching', { count })}</span>
  </div>;
}

export function AnalyticsLoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('analytics.insights');
  return <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
    <span>{t('loadError')}</span><button type="button" className="shrink-0 underline" onClick={onRetry}>{t('retry')}</button>
  </div>;
}
