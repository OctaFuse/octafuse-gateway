'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRightIcon, CheckCircleIcon, ClockIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { GatewayRequestLog } from '@/lib/types';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { dashboardLogHref } from './dashboard-links';
import { dashboardErrorSummary } from './dashboard-presentation';

export function DashboardActivity({ logs, errors }: { logs: GatewayRequestLog[]; errors: GatewayRequestLog[] }) {
  const t = useTranslations('dashboard');
  const c = useTranslations('common');
  const { formatDateTime } = useGatewayDateTime();
  const [view, setView] = useState<'recent' | 'errors'>('recent');
  const rows = view === 'recent' ? logs : errors;
  return <section className="admin-content-panel flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="admin-section-title inline-flex items-center gap-2 text-sm font-medium text-gray-900"><ClockIcon className="h-4 w-4 text-gray-500" aria-hidden />{t('activity')}</h2>
      <div className="inline-flex rounded-lg bg-gray-100 p-1" role="group" aria-label={t('activity')}>
        {(['recent', 'errors'] as const).map(tab => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => setView(tab)}
          className={`rounded-md px-3 py-1 text-xs transition-colors ${view === tab ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>{t(tab === 'recent' ? 'recentRequests' : 'recentErrors')}</button>)}
      </div>
    </div>
    <p className="mt-2 text-xs leading-5 text-gray-500">{t('activityScope')}</p>
    {rows.length ? <div className="mt-3 divide-y divide-gray-100">
      {rows.slice(0, 5).map(log => {
        const name = log.model_name?.trim() || log.model_id || c('unknown');
        const success = log.status === 'success';
        const failure = log.status === 'error';
        const Icon = success ? CheckCircleIcon : ExclamationCircleIcon;
        const label = ['success', 'error', 'incomplete', 'cancelled'].includes(log.status) ? t(`requestStatus.${log.status}`) : log.status;
        return <Link key={log.id} href={dashboardLogHref(log)} aria-label={t('openRequest', { model: name })}
          className="group -mx-2 flex min-w-0 items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-gray-50">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${success ? 'text-emerald-600' : failure ? 'text-rose-500' : 'text-amber-600'}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-3"><span className="truncate text-sm text-gray-900" title={name}>{name}</span><span className={`shrink-0 text-xs ${failure ? 'text-rose-600' : 'text-gray-500'}`}>{label}</span></div>
            <p className="mt-1 truncate text-xs text-gray-500" title={view === 'errors' ? dashboardErrorSummary(log.error_message, t('upstreamError')) : log.provider_name || ''}>{view === 'errors' ? dashboardErrorSummary(log.error_message, t('upstreamError')) : (log.provider_name || c('unknown'))}</p>
            <time className="mt-1 block text-xs tabular-nums text-gray-500">{formatDateTime(log.created_at)}</time>
          </div>
          <ArrowUpRightIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-gray-900" aria-hidden />
        </Link>;
      })}
    </div> : <p className="py-10 text-center text-sm text-gray-500">{view === 'errors' ? t('noRecentErrors') : c('noRecentRequests')}</p>}
  </section>;
}
