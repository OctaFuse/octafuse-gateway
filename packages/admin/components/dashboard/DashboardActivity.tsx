'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRightIcon, CheckCircleIcon, ClockIcon, ExclamationCircleIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { GatewayRequestLog } from '@/lib/types';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { useDashboardListMotion } from './use-dashboard-list-motion';
import { formatGatewayMoneyCompact } from '@/lib/format-gateway-currency';
import { dashboardActivityCostFactor, dashboardActivityDuration, dashboardActivityError, dashboardActivityMoney, dashboardActivityUsage } from './dashboard-activity-details';
import { dashboardActivityLogsHref, dashboardLogHref } from './dashboard-links';
import { DASHBOARD_ACTIVITY_PREVIEW_LIMIT } from '@/lib/dashboard-constants';

export function DashboardActivity({ logs, errors, billingCurrency: currency }: { logs: GatewayRequestLog[]; errors: GatewayRequestLog[]; billingCurrency: string }) {
  const t = useTranslations('dashboard');
  const c = useTranslations('common');
  const detail = useTranslations('dashboard.activityDetails');
  const { formatDateTime, formatDate, formatTime } = useGatewayDateTime();
  const [view, setView] = useState<'recent' | 'errors'>('recent');
  const rootRef = useRef<HTMLElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<{ view: 'recent' | 'errors'; rows: GatewayRequestLog[] } | null>(null);
  const latest = (view === 'recent' ? logs : errors).slice(0, DASHBOARD_ACTIVITY_PREVIEW_LIMIT);
  const rows = held?.view === view ? held.rows : latest;
  const known = new Set(rows.map(row => row.id));
  const pendingCount = latest.filter(row => !known.has(row.id)).length;
  const freeze = () => setHeld(current => current?.view === view ? current : { view, rows: latest });
  useDashboardListMotion(rowsRef, view, JSON.stringify(rows.map(row => row.id)));
  return <section ref={rootRef} onPointerEnter={freeze}
    onPointerLeave={() => { if (!rootRef.current?.contains(document.activeElement)) setHeld(null); }}
    onFocusCapture={freeze} onBlurCapture={() => {
      queueMicrotask(() => {
        const root = rootRef.current;
        if (root && !root.contains(document.activeElement) && !root.matches(':hover')) setHeld(null);
      });
    }}
    className="admin-content-panel dashboard-activity-panel flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="admin-section-title inline-flex items-center gap-2 text-sm font-medium text-gray-900"><ClockIcon className="h-4 w-4 text-gray-500" aria-hidden />{t('activity')}</h2>
      <div className="inline-flex rounded-lg bg-gray-100 p-1" role="group" aria-label={t('activity')}>
        {(['recent', 'errors'] as const).map(tab => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => { setView(tab); setHeld({ view: tab, rows: (tab === 'recent' ? logs : errors).slice(0, DASHBOARD_ACTIVITY_PREVIEW_LIMIT) }); }}
          className={`rounded-md px-3 py-1 text-xs transition-colors ${view === tab ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>{t(tab === 'recent' ? 'recentRequests' : 'recentErrors')}</button>)}
      </div>
    </div>
    <div className="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-2 text-xs leading-5 text-gray-500">
      <p>{t('activityScope')}</p>
      {pendingCount > 0 && <button type="button" onClick={() => { setHeld({ view, rows: latest }); }}
        className="rounded px-1.5 text-blue-700 hover:bg-blue-50">{t('liveRefresh.activityReady', { count: pendingCount })}</button>}
    </div>
    {rows.length ? <div ref={rowsRef} role="region" aria-label={t(view === 'recent' ? 'recentRequests' : 'recentErrors')} className="mt-3 divide-y divide-gray-100">
      {rows.map(log => {
        const name = log.model_name?.trim() || log.model_id || c('unknown');
        const failure = log.status === 'error';
        const StatusIcon = log.status === 'success' ? CheckCircleIcon : ExclamationCircleIcon;
        const diagnostic = view === 'errors' || failure;
        const label = ['success', 'error', 'incomplete', 'cancelled'].includes(log.status) ? t(`requestStatus.${log.status}`) : log.status;
        const provider = log.provider_name?.trim() || detail('providerUnknown');
        const protocol = log.request_protocol || log.upstream_protocol;
        const duration = dashboardActivityDuration(log.latency_ms);
        const error = diagnostic ? dashboardActivityError(log.error_message, t('upstreamError')) : null;
        const usage = dashboardActivityUsage(log, { tokens: detail('tokens'), images: detail('images'), seconds: detail('seconds'), characters: detail('characters'), calls: detail('calls'),
          input: t('inputTokens'), output: t('outputTokens'), cacheRead: t('cacheReadTokens') });
        const charged = dashboardActivityMoney(log.charged_cost);
        const cost = dashboardActivityMoney(log.metered_cost);
        const factor = dashboardActivityCostFactor(log.charged_cost, log.standard_cost);
        const billed = charged == null ? '—' : formatGatewayMoneyCompact(charged, currency);
        const timingHint = [detail('duration'), log.first_token_ms != null ? `${detail('ttft')} ${dashboardActivityDuration(log.first_token_ms)}` : null].filter(Boolean).join(' · ');
        const context = [
          `${detail('provider')}: ${provider}${protocol ? ` · ${protocol}` : ''}`,
          log.user_email ? `${detail('user')}: ${log.user_email}` : null,
          log.route_group ? `${detail('routeGroup')}: ${log.route_group}` : null,
          `${t('chargedColumn')}: ${billed}${factor ? ` ${factor}` : ''}`,
          cost != null ? `${detail('cost')}: ${formatGatewayMoneyCompact(cost, currency)}` : null,
        ].filter(Boolean).join(' · ');
        const tone = failure || view === 'errors' ? 'bg-rose-50 text-rose-700' : log.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700';
        return <Link key={log.id} data-dashboard-item={log.id} href={dashboardLogHref(log)} aria-label={`${t('openRequest', { model: name })} · ${formatDateTime(log.created_at)} · ${provider} · ${error?.summary || `${label} ${duration}`}`}
          title={diagnostic ? `${formatDateTime(log.created_at)} · ${context} · ${error!.full}` : `${formatDateTime(log.created_at)} · ${context} · ${usage.title} · ${timingHint}`}
          className={`dashboard-activity-record group -mx-2 min-w-0 items-center rounded-lg px-2 py-3 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${diagnostic ? 'dashboard-activity-diagnostic' : ''}`}>
          <time dateTime={log.created_at} title={formatDateTime(log.created_at)} className="dashboard-activity-time whitespace-nowrap font-mono text-[11px] leading-5 tabular-nums text-gray-600">
            <span className="block">{formatTime(log.created_at)}</span><span className="block text-[10px] text-gray-400">{formatDate(log.created_at)}</span>
          </time>
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              {diagnostic ? <ExclamationCircleIcon className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden /> : <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${log.status === 'success' ? 'text-emerald-600' : 'text-amber-600'}`} aria-hidden />}
              <span className="min-w-0 truncate whitespace-nowrap text-sm font-medium text-gray-900" title={name}>{name}</span>
              {diagnostic && <span className="dashboard-activity-error-provider ml-auto max-w-[40%] truncate whitespace-nowrap text-[11px] text-gray-500" title={provider}>{provider}</span>}
            </div>
            {diagnostic ? <p className="truncate whitespace-nowrap text-xs text-rose-700" title={error!.full}>{error!.summary}</p>
              : <p className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-gray-500" title={`${detail('provider')}: ${provider}`}>
                <ServerStackIcon className="h-3 w-3 shrink-0 text-gray-400" aria-hidden /><span className="min-w-0 flex-1 truncate">{provider}</span>
                <span className="dashboard-activity-inline-time shrink-0 font-mono text-[10px] tabular-nums text-gray-400">{formatDate(log.created_at).slice(5)} {formatTime(log.created_at)}</span>
              </p>}
            {diagnostic && <span className="dashboard-activity-error-meta min-w-0 items-center gap-2 whitespace-nowrap text-[10px] text-gray-500"><span className="min-w-0 flex-1 truncate">{provider}</span><span className="shrink-0 font-mono tabular-nums">{formatDate(log.created_at).slice(5)} {formatTime(log.created_at)}</span></span>}
          </div>
          {!diagnostic && <div className="dashboard-activity-usage min-w-0 space-y-1 text-right font-mono text-[11px] leading-4 tabular-nums">
            <p title={usage.title} className="truncate whitespace-nowrap text-gray-600">{usage.value}</p>
            <p title={`${t('chargedColumn')}: ${billed}${factor ? ` · ${detail('catalogFactor')} ${factor}` : ''}`} className="truncate whitespace-nowrap text-gray-800">
              {billed}{factor && <span className="ml-1 text-[10px] text-gray-400">{factor}</span>}
            </p>
          </div>}
          <div className="space-y-1 whitespace-nowrap text-right text-[11px] leading-4">
            <span className={`inline-block whitespace-nowrap rounded px-1.5 text-[10px] ${tone}`}>{error?.code || label}</span>
            {duration !== '—' && <span title={timingHint} className="block whitespace-nowrap font-mono tabular-nums text-gray-600">{duration}</span>}
          </div>
        </Link>;
      })}
    </div> : <p className="py-10 text-center text-sm text-gray-500">{view === 'errors' ? t('noRecentErrors') : c('noRecentRequests')}</p>}
    <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
      <span>{detail('latestCount', { count: rows.length })}</span>
      <Link href={dashboardActivityLogsHref(view)} className="inline-flex items-center gap-1 rounded px-1 py-1 hover:text-gray-950">
        {view === 'errors' ? t('viewErrorLogs') : detail('viewAll')}<ArrowUpRightIcon className="h-3 w-3" aria-hidden />
      </Link>
    </footer>
  </section>;
}
