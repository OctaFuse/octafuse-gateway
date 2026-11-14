'use client';

import { CircleStackIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { KpiMetrics } from '@/lib/types';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { DashboardNumber } from './DashboardNumber';
import { InfoHintPopover } from '@/components/InfoHintPopover';

/** Period totals stay visible beside the chart; RPM/TPM retain their separate 60-second window. */
export function DashboardTokenSummary({ kpi, rangeLabel, scope }: {
  kpi: Pick<KpiMetrics, 'inputTokens' | 'outputTokens' | 'cacheReadTokens'>;
  rangeLabel: string;
  scope: string;
}) {
  const t = useTranslations('dashboard');
  const review = useTranslations('dashboard.review');
  const cacheReadShare = kpi.inputTokens != null && kpi.inputTokens > 0 && kpi.cacheReadTokens != null
    ? kpi.cacheReadTokens / kpi.inputTokens * 100 : null;
  return <section className="admin-content-panel min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5" aria-label={t('tokenSummary')}>
    <div className="flex items-center gap-2"><h2 className="admin-section-title flex items-center gap-2 text-sm font-medium text-gray-900"><CircleStackIcon className="h-4 w-4 text-blue-600" aria-hidden />{t('tokenSummary')}</h2><InfoHintPopover label={t('tokenSummary')} openOnHover openOnFocus portal align="start"><p className="leading-6">{review('inputHint')}</p></InfoHintPopover></div>
    <p className="mt-2 truncate text-xs text-gray-500" title={rangeLabel}>{review('selectedPeriod')} · {rangeLabel}</p>
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
      {[
        { label: t('inputTokens'), value: kpi.inputTokens, format: formatCompactTokens },
        { label: t('outputTokens'), value: kpi.outputTokens, format: formatCompactTokens },
        { label: t('cacheReadTokens'), value: kpi.cacheReadTokens, format: formatCompactTokens },
        { label: review('cacheShare'), value: cacheReadShare, format: (value: number) => `${value.toFixed(1)}%` },
      ].map(metric => <div key={metric.label} className="min-w-0">
        <dt className="text-xs leading-5 text-gray-500">{metric.label}</dt>
        <dd className="mt-1 whitespace-nowrap font-mono text-xl leading-6 tabular-nums text-gray-950" title={metric.value?.toLocaleString()}><DashboardNumber value={metric.value} format={metric.format} scope={scope} /></dd>
      </div>)}
    </dl>
  </section>;
}
