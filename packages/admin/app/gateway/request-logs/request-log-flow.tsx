'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowRightIcon, ArrowsRightLeftIcon, CheckCircleIcon, ClockIcon,
  CodeBracketIcon, CurrencyDollarIcon, ExclamationCircleIcon, ServerStackIcon,
} from '@heroicons/react/24/outline';
import type { GatewayRequestLog } from '@/lib/types';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { normalizeRouteGroup } from '@/lib/route-group-ui';
import { summarizePricingAuditJson } from '@/lib/pricing-ui';
import { compareLogBodies, flowTimeExtent, observedMs, readFlowAttempts, readLogObject, requestAccountingHref } from './request-log-flow-data';

type Stage = 'entry' | 'route' | 'upstream' | 'response' | 'billing';
type Selection = Stage | `attempt:${number}`;

const ms = (value: unknown) => {
  const n = observedMs(value);
  return n === null ? '—' : `${n.toLocaleString('en-US')} ms`;
};
const json = (value: unknown) => JSON.stringify(value, null, 2);
const buttonClass = 'rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-indigo-300 hover:text-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500';

function Fields({ rows }: { rows: [string, unknown][] }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
    {rows.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-slate-800 [overflow-wrap:anywhere]">{value == null || value === '' ? '—' : String(value)}</dd>
    </div>)}
  </dl>;
}

function RawData({ title, raw }: { title: string; raw: string | null | undefined }) {
  const common = useTranslations('common');
  const t = useTranslations('requestLogs.flow');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  let display = raw?.trim() ?? '';
  try { if (display) display = json(JSON.parse(display)); } catch { /* Keep malformed legacy values readable. */ }
  return <details className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
    <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">{title}</summary>
    <div className="border-t border-slate-100 p-3">
      <div className="mb-2 flex justify-end gap-2">
        {copyFailed && <span role="status" className="text-xs text-red-600">{t('copyFailed')}</span>}
        <button type="button" className={buttonClass} disabled={!display} onClick={async () => {
          try {
            await navigator.clipboard.writeText(display);
            setCopiedText(display);
            setCopyFailed(false);
          } catch { setCopyFailed(true); }
        }}>{copiedText === display ? common('copied') : common('copy')}</button>
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">{display || common('noDataFound')}</pre>
    </div>
  </details>;
}

export function RequestLogFlow({ log, providerLabel, identityLabel, currency, onExplainTiming }: {
  log: GatewayRequestLog;
  providerLabel: string;
  identityLabel: string;
  currency: string;
  onExplainTiming: () => void;
}) {
  const t = useTranslations('requestLogs');
  const f = useTranslations('requestLogs.flow');
  const options = useTranslations('options');
  const common = useTranslations('common');
  const [selection, setSelection] = useState<Selection | null>(null);
  const panelId = useId();
  const attempts = readFlowAttempts(log.timing_metadata);
  const changes = compareLogBodies(log.request_body, log.upstream_request_body);
  const selectedAttempt = attempts.find(attempt => attempt.selected);
  const attempt = selection?.startsWith('attempt:') ? attempts.find(item => `attempt:${item.position}` === selection) : undefined;
  const metadata = readLogObject(log.timing_metadata);
  const extent = flowTimeExtent(log.latency_ms, attempts, log.gateway_overhead_ms, log.stream_duration_ms);
  const money = (value: number | undefined) => value == null ? '—' : formatGatewayMoneyCode(value, currency, 6);
  const count = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString();
  const status = ['success', 'error', 'incomplete', 'cancelled'].includes(log.status) ? options(`requestStatus.${log.status}`) : log.status;
  const statusClass = log.status === 'success' ? 'bg-emerald-50 text-emerald-700' : log.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800';
  const attemptCount = log.upstream_attempt_count ?? (attempts.length || null);
  const failoverCount = log.upstream_failover_count;
  const stageData = [
    { id: 'entry', icon: CodeBracketIcon, title: f('entry'), value: log.model_id || '—', meta: log.ingress_host || log.request_protocol || '—', timing: null },
    { id: 'route', icon: ArrowsRightLeftIcon, title: f('route'), value: normalizeRouteGroup(log.route_group), meta: changes === null ? f('snapshotUnavailable') : changes.length ? f('changeCount', { count: changes.length }) : f('noChanges'), timing: ms(log.gateway_overhead_ms) },
    { id: 'upstream', icon: ServerStackIcon, title: f('upstream'), value: providerLabel || '—', meta: f('attemptSummary', { attempts: count(attemptCount), failovers: count(failoverCount) }), timing: ms(log.upstream_response_ms) },
    { id: 'response', icon: log.status === 'success' ? CheckCircleIcon : ExclamationCircleIcon, title: f('response'), value: status, meta: selectedAttempt?.status != null ? `HTTP ${selectedAttempt.status}` : f('httpUnavailable'), timing: ms(log.stream_duration_ms) },
    { id: 'billing', icon: CurrencyDollarIcon, title: f('billing'), value: money(log.charged_cost), meta: `${t('titles.meteredSupplierCost')} ${money(log.metered_cost)}`, timing: null },
  ] as const;
  const panelTitle = attempt ? f('attempt', { index: attempt.index }) : stageData.find(stage => stage.id === selection)?.title;
  const select = (value: Selection) => setSelection(previous => previous === value ? null : value);
  const providerKey = [log.provider_key_label, log.provider_key_fingerprint, log.provider_key_id].filter(Boolean).join(' · ');
  const protocolMapping = `${[log.request_protocol, log.request_operation].filter(Boolean).join('.')} → ${[log.upstream_protocol, log.upstream_operation].filter(Boolean).join('.')}`;
  const timelineStage = (stage: Stage, label: string, start: number | null, duration: number | null, tone: string) => {
    if (start === null || duration === null) return null;
    const left = Math.min(99, start / extent * 100);
    return <button type="button" aria-controls={panelId} aria-expanded={selection === stage} onClick={() => select(stage)}
      className={`grid w-full grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 rounded-md border px-2 py-2 text-left sm:grid-cols-[minmax(0,12rem)_minmax(4rem,1fr)_7rem] ${selection === stage ? 'border-indigo-300 bg-indigo-50' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500`}>
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <span className="relative hidden h-5 overflow-hidden rounded bg-slate-50 sm:block" aria-hidden="true"><span className={`absolute inset-y-1 rounded-sm ${tone}`} style={{ left: `${left}%`, width: `${Math.min(100 - left, Math.max(0.6, duration / extent * 100))}%` }} /></span>
      <span className="text-right font-mono text-[10px] text-slate-400">{ms(duration)}</span>
    </button>;
  };

  return <section className="min-w-0" aria-label={f('title')}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">{f('title')}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>{status}</span>
        <span className="break-all font-mono text-[10px] text-slate-400">{log.id}</span>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><ClockIcon className="h-3.5 w-3.5" />{f('total')} <strong className="font-mono font-medium text-slate-800">{ms(log.latency_ms)}</strong></span>
        <span>{t('timing.ttftContent')} <strong className="font-mono font-medium text-slate-800">{ms(log.first_token_ms)}</strong></span>
        <button type="button" className="text-[11px] text-indigo-600 hover:underline" onClick={onExplainTiming}>{t('timing.explain')}</button>
      </div>
    </div>

    <div className="bg-slate-50/60 p-4">
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-[760px] items-stretch gap-2">
          {stageData.map((stage, index) => {
            const Icon = stage.icon;
            const active = selection === stage.id || (stage.id === 'upstream' && Boolean(attempt));
            return <div key={stage.id} className="flex min-w-0 flex-1 items-center gap-2">
              {index > 0 && <ArrowRightIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-300" />}
              <button type="button" aria-expanded={selection === stage.id} aria-controls={panelId} onClick={() => select(stage.id)}
                className={`group flex h-full min-h-[124px] min-w-0 flex-1 flex-col rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${active ? 'border-indigo-400 bg-indigo-50 shadow-sm ring-1 ring-indigo-100' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40'}`}>
                <div className="mb-3 flex w-full items-center justify-between gap-1">
                  <Icon aria-hidden="true" className={`h-4 w-4 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />
                  <span className="font-mono text-[10px] text-slate-500" title={stage.id === 'response' ? t('timing.streamDesc') : stage.id === 'route' ? t('timing.gatewayDesc') : stage.id === 'upstream' ? t('timing.upstreamDesc') : undefined}>{stage.timing}</span>
                </div>
                <span className="text-[11px] font-medium text-slate-500">{stage.title}</span>
                <span className={`mt-1 w-full truncate text-xs font-semibold ${stage.id === 'response' && log.status === 'error' ? 'text-red-600' : 'text-slate-900'}`} title={stage.value}>{stage.value}</span>
                <span className={`mt-1 w-full truncate text-[10px] ${stage.id === 'upstream' && (failoverCount ?? 0) > 0 ? 'text-amber-700' : 'text-slate-500'}`} title={stage.meta}>{stage.meta}</span>
              </button>
            </div>;
          })}
        </div>
      </div>

      {attempts.length > 0 ? <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
          <span className="font-medium text-slate-600">{f('attemptTimeline')}</span>
          <span>{f('timeOrigin')} · 0 — {ms(extent)}</span>
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {timelineStage('route', t('timing.gateway'), 0, observedMs(log.gateway_overhead_ms), 'bg-indigo-300')}
          {attempts.map(item => {
            const active = selection === `attempt:${item.position}`;
            const hasRange = item.startMs !== null && item.headersMs !== null;
            const left = Math.min(99, (item.startMs ?? 0) / extent * 100);
            const width = hasRange ? Math.min(100 - left, Math.max(0.6, item.headersMs! / extent * 100)) : 0.6;
            return <div key={item.position}>
              {item.position > attempts[0].position && <div className="pl-5 text-[10px] text-amber-700">↳ {f('nextAttempt', { index: item.index })}</div>}
              <button type="button" aria-controls={panelId} aria-expanded={active}
              onClick={() => select(`attempt:${item.position}`)}
              className={`grid w-full grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 rounded-md border px-2 py-2 text-left sm:grid-cols-[minmax(0,12rem)_minmax(4rem,1fr)_7rem] ${active ? 'border-indigo-300 bg-indigo-50' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500`}>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.failed ? 'bg-red-400' : item.selected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  <span className="font-mono text-slate-400">#{item.index}</span>
                  <span className="truncate font-medium text-slate-700" title={item.provider || undefined}>{item.provider || '—'}</span>
                </span>
                <span className="mt-0.5 block truncate pl-3 text-[10px] text-slate-400" title={item.error || item.model || undefined}>{item.error || item.model || '—'}</span>
              </span>
              <span className="relative hidden h-5 overflow-hidden rounded bg-slate-50 sm:block" aria-hidden="true">
                <span className={`absolute inset-y-1 rounded-sm ${item.failed ? 'bg-red-300' : item.selected ? 'bg-emerald-400' : 'bg-slate-300'}`} style={{ left: `${left}%`, width: `${width}%` }} />
              </span>
              <span className="text-right text-[10px]">
                <span className={item.failed ? 'text-red-600' : 'text-slate-600'}>{item.status != null ? `HTTP ${item.status}` : item.failureKind || f('httpUnavailable')}{item.selected ? ` · ${f('selected')}` : ''}</span>
                <span className="mt-0.5 block font-mono text-slate-400">{ms(item.headersMs)}</span>
              </span>
            </button></div>;
          })}
          {timelineStage('response', f('responseOutput'), selectedAttempt?.headersElapsedMs ?? null, observedMs(log.stream_duration_ms), 'bg-sky-300')}
        </div>
        <p className="mt-2 text-[10px] text-slate-400">{f('timelineNote')}</p>
      </div> : <p className="mt-2 text-[11px] text-slate-400">{f('noAttemptData')}</p>}
      {!selection && <p className="mt-3 text-center text-[11px] text-slate-400">{f('selectHint')}</p>}
    </div>

    <div id={panelId}>
      {selection && <div className="border-t border-slate-200 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="h-3 w-1 rounded bg-indigo-500" />{panelTitle}</h3>
          <button type="button" className={buttonClass} onClick={() => setSelection(null)}>{common('close')}</button>
        </div>
        {selection === 'entry' && <>
          <Fields rows={[[t('detail.requestId'), log.id], [t('detail.identity'), identityLabel], [t('detail.ingressHost'), log.ingress_host], [t('detail.modelId'), log.model_id], [f('protocol'), [log.request_protocol, log.request_operation].filter(Boolean).join('.')]]} />
          <RawData title={t('detail.entryRequestBody')} raw={log.request_body} />
        </>}
        {selection === 'route' && <>
          <Fields rows={[[t('detail.routeGroup'), normalizeRouteGroup(log.route_group)], [t('detail.protocolMapping'), protocolMapping], [f('adapter'), log.adapter], [f('surface'), log.model_surface_id], [f('pool'), log.route_pool_id], [t('detail.routeTarget'), log.route_target_id], [t('timing.gateway'), ms(log.gateway_overhead_ms)]]} />
          <div className="mt-4 rounded-lg border border-slate-200">
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-700">{f('bodyChanges')}</div>
            <p className="px-3 py-2 text-[11px] text-slate-500">{f('diffNote')}</p>
            {changes === null || changes.length === 0 ? <p className="px-3 pb-3 text-xs text-slate-600">{changes === null ? f('snapshotUnavailable') : f('noChanges')}</p> :
              <div className="max-h-80 overflow-auto"><table className="w-full table-fixed text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="w-1/4 px-3 py-2 font-medium">{f('field')}</th><th className="px-3 py-2 font-medium">{f('before')}</th><th className="px-3 py-2 font-medium">{f('after')}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{changes.map(change => <tr key={change.path}>
                  <td className="px-3 py-2 align-top"><span className="break-all font-mono">{change.path}</span><span className="mt-1 block text-[10px] text-indigo-500">{f(change.kind)}</span></td>
                  <td className="px-3 py-2 align-top"><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-red-700">{change.kind === 'added' ? '—' : json(change.before)}</pre></td>
                  <td className="px-3 py-2 align-top"><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-emerald-700">{change.kind === 'removed' ? '—' : json(change.after)}</pre></td>
                </tr>)}</tbody>
              </table></div>}
          </div>
          <RawData title={t('detail.entryRequestBody')} raw={log.request_body} />
          <RawData title={t('detail.upstreamRequestBody')} raw={log.upstream_request_body} />
          <RawData title={f('routeTrace')} raw={log.route_trace} />
        </>}
        {selection === 'upstream' && <>
          <Fields rows={[[t('detail.providerRoute'), [providerLabel, log.provider_model_name].filter(Boolean).join(' · ')], [t('detail.providerKey'), providerKey], [t('timing.attempts'), count(attemptCount)], [f('failovers'), count(failoverCount)], [t('timing.upstream'), ms(log.upstream_response_ms)], [t('timing.headers'), ms(log.final_upstream_headers_ms)]]} />
          <p className="mt-3 text-[11px] text-slate-500">{t('timing.upstreamDesc')}</p>
          <RawData title={t('detail.timing')} raw={log.timing_metadata} />
          <RawData title={t('detail.upstreamRequestBody')} raw={log.upstream_request_body} />
        </>}
        {attempt && <>
          <Fields rows={[[f('provider'), attempt.provider], [t('detail.modelId'), attempt.model], [f('httpStatus'), attempt.status], [f('startOffset'), ms(attempt.startMs)], [t('timing.headers'), ms(attempt.headersMs)], [f('headersOffset'), ms(attempt.headersElapsedMs)], [f('selected'), attempt.selected ? f('yes') : f('no')], [f('failureKind'), attempt.failureKind], [t('detail.routeTarget'), attempt.raw.target_id], [t('detail.providerKey'), [attempt.raw.provider_key_label, attempt.raw.provider_key_fingerprint, attempt.raw.provider_key_id].filter(value => typeof value === 'string').join(' · ')]]} />
          {attempt.error && <p className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">{attempt.error}</p>}
          <p className="mt-3 text-[11px] text-slate-500">{f('attemptNote')}</p>
          <RawData title={f('attemptRaw')} raw={json(attempt.raw)} />
        </>}
        {selection === 'response' && <>
          <Fields rows={[[f('result'), status], [f('httpStatus'), selectedAttempt?.status], [t('detail.upstreamRequestId'), log.upstream_request_id], [t('detail.upstreamMessageId'), log.upstream_message_id], [f('firstByte'), ms(metadata?.first_byte_ms)], [f('firstEvent'), ms(metadata?.first_event_ms)], [t('timing.reasoning'), ms(log.first_reasoning_token_ms)], [t('timing.ttftContent'), ms(log.first_token_ms)], [t('timing.stream'), ms(log.stream_duration_ms)]]} />
          {log.error_message && <p className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">{log.error_message}</p>}
          <p className="mt-3 text-[11px] text-slate-500">{f('responseNote')}</p>
          <RawData title={t('detail.upstreamUsageRaw')} raw={log.raw_usage} />
        </>}
        {selection === 'billing' && <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[[t('titles.chargedUserBudget'), log.charged_cost], [t('titles.meteredSupplierCost'), log.metered_cost], [f('catalogAmount'), log.standard_cost]].map(([label, amount]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 font-mono text-base font-semibold text-slate-800">{money(amount as number | undefined)}</div></div>)}
          </div>
          <div className="mt-4"><Fields rows={[[f('inputTokens'), count(log.input_tokens)], [f('outputTokens'), count(log.output_tokens)], [f('cacheRead'), count(log.cache_read_tokens)], [f('cacheWrite'), count(log.cache_write_tokens)], [f('reasoningTokens'), count(log.reasoning_tokens)], [f('billingKind'), log.billing_kind], ...(log.billing_kind?.startsWith('image') ? [[f('inputImages'), count(log.input_image_count)], [f('outputImages'), count(log.output_image_count)]] as [string, unknown][] : []), ...(log.audio_duration_seconds != null ? [[f('audioSeconds'), count(log.audio_duration_seconds)]] as [string, unknown][] : []), ...(log.audio_characters != null ? [[f('audioCharacters'), count(log.audio_characters)]] as [string, unknown][] : [])]} /></div>
          <p className="mt-3 text-[11px] text-slate-500">{f('billingNote')}</p>
          <a href={requestAccountingHref(log.id, log.created_at)} className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline">{f('viewAccountingAudit')}<ArrowRightIcon aria-hidden="true" className="h-3 w-3" /></a>
          {log.pricing_audit && <p className="mt-3 rounded-lg bg-violet-50 p-3 text-xs text-violet-800">{summarizePricingAuditJson(log.pricing_audit)}</p>}
          <RawData title={t('detail.pricingAudit')} raw={log.pricing_audit} />
          <RawData title={t('detail.upstreamUsageRaw')} raw={log.raw_usage} />
        </>}
      </div>}
    </div>
  </section>;
}
