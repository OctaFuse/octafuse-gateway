'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowUpRightIcon, BanknotesIcon, ExclamationTriangleIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import type { DashboardStats } from '@/lib/types';
import type { GatewayTimeRangeValue } from '@/lib/analytics-range';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { dashboardLogsHref } from './dashboard-links';
import { DashboardNumber } from './DashboardNumber';

type Overview = NonNullable<DashboardStats['operations']>;
const panel = 'admin-content-panel min-w-0 rounded-xl border border-gray-200 bg-white p-5 sm:p-6';
const heading = 'admin-section-title flex items-center gap-2 text-sm font-medium text-gray-900';
const percent = (n: number, d: number) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : '—';

/** Totals live in the KPI strip; this panel adds only the relationship between them. */
export function DashboardCosts({ operations, range, currency, scope }: { operations: Overview; range: GatewayTimeRangeValue; currency: string; scope: string }) {
 const t = useTranslations('dashboard.operations');
 const review = useTranslations('dashboard.review');
 const c = operations.current;
 const money = (value: number) => formatGatewayMoneyCode(value, currency, 4);
 const ratio = (value: number) => c.standard > 0 ? `×${(value / c.standard).toFixed(2)}` : '—';
 const spread = c.charged - c.metered;
 return <section className={`${panel} flex h-full flex-col`} aria-label={review('costEfficiency')}>
  <h2 className={heading}><BanknotesIcon className="h-4 w-4 text-violet-600" aria-hidden />{review('costEfficiency')}</h2>
  <div className="mt-5 flex flex-1 flex-col justify-center rounded-lg bg-gray-50 p-4">
   <p className="text-xs text-gray-500">{review('spreadAmount')}</p>
   <p title={money(spread)} className={`mt-2 truncate whitespace-nowrap font-mono text-2xl tabular-nums ${spread < 0 ? 'text-rose-700' : 'text-gray-950'}`}><DashboardNumber value={spread} format={money} scope={scope} /></p>
   <p className="mt-2 text-xs text-gray-500">{review('spreadRate')} <span className="ml-1 whitespace-nowrap font-mono tabular-nums text-gray-700">{percent(spread,c.charged)}</span></p>
   {c.charged > 0 && <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-emerald-200" aria-hidden><span className={`h-full ${spread < 0 ? 'bg-rose-400' : 'bg-gray-400'}`} style={{width:`${Math.min(100,Math.max(0,c.metered/c.charged*100))}%`}} /></div>}
  </div>
  <dl className="mt-4 grid grid-cols-2 gap-4" title={`${t('factorHint')} ${t('catalog')}: ${money(c.standard)}`}>
   {[{label:review('chargeFactor'),value:c.charged},{label:review('costFactor'),value:c.metered}].map(item => <div className="min-w-0" key={item.label}><dt className="text-xs text-gray-500">{item.label}</dt><dd className="mt-2 whitespace-nowrap font-mono text-lg tabular-nums text-gray-900">{ratio(item.value)}</dd></div>)}
  </dl>
  {c.errorCost > 0 && <Link href={dashboardLogsHref(range,{status:'error'})} className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600 hover:text-gray-950"><span className="flex-1">{t('errorCost')}</span><span className="whitespace-nowrap font-mono tabular-nums text-rose-700">{money(c.errorCost)}</span><ArrowUpRightIcon className="h-3 w-3 shrink-0" aria-hidden /></Link>}
 </section>;
}

export function DashboardOperations({ operations, range }: { operations: Overview; range: GatewayTimeRangeValue }) {
 const t = useTranslations('dashboard.operations');
 const review = useTranslations('dashboard.review');
 const c = operations.current;
 const errorHref = dashboardLogsHref(range,{status:'error'});
 const reliabilityHref = `/gateway/analytics/reliability?${new URLSearchParams({start_date:range.start_date,end_date:range.end_date,range:'custom'})}`;
 const tones: Record<string,string> = { rate_limit:'bg-amber-400',timeout:'bg-orange-400',auth:'bg-violet-400',upstream:'bg-rose-400',request:'bg-blue-400',other:'bg-gray-400' };
 const detailed = operations.providers.length >= 3;
 const otherStates = (['incomplete','cancelled'] as const).filter(status => c[status] > 0);
 return <div className={`grid min-w-0 items-stretch gap-5 ${operations.providers.length ? 'lg:grid-cols-2' : ''}`}>
  <section className={`${panel} flex h-full flex-col`} aria-label={t('quality')}>
   <div className="flex items-center justify-between gap-3"><h2 className={heading}><ExclamationTriangleIcon className="h-4 w-4 text-amber-600" aria-hidden />{t('quality')}</h2><Link href={reliabilityHref} className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-500 hover:text-gray-950">{t('reliability')}<ArrowUpRightIcon className="h-3 w-3" aria-hidden /></Link></div>
   <div className={`mt-4 grid flex-1 gap-4 ${detailed ? 'grid-rows-[auto_minmax(0,1fr)]' : c.errors > 0 ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center' : 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'}`}>
    <div className="grid grid-cols-2 gap-4">
     <div><p className="text-xs text-gray-500">{t('failover')}</p><p className="mt-2 whitespace-nowrap font-mono text-2xl tabular-nums text-gray-950">{percent(c.failoverRequests,c.failoverSamples)}</p><p title={t('coverage',{count:c.failoverSamples,total:c.requests})} className="mt-1 whitespace-nowrap font-mono text-[11px] tabular-nums text-gray-500">{c.failoverSamples > 0 ? `${c.failoverRequests} / ${c.failoverSamples}` : review('noObservations')}</p></div>
     <div><p className="text-xs text-gray-500">{t('attempts')}</p><p className="mt-2 whitespace-nowrap font-mono text-2xl tabular-nums text-gray-950">{c.avgAttempts?.toFixed(2) ?? '—'}</p><p className="mt-1 whitespace-nowrap text-[11px] text-gray-500">{c.attemptsSamples > 0 ? t('attemptSamples',{count:c.attemptsSamples}) : review('noObservations')}</p></div>
    </div>
    {c.errors > 0 ? <div className={`min-w-0 border-t border-gray-100 pt-4 ${detailed ? 'flex flex-col justify-center' : 'sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0'}`}>
     <div className="flex items-center justify-between gap-3 text-xs"><h3 className="font-medium text-gray-700">{t('errors')}</h3><Link href={errorHref} className="inline-flex items-center gap-1 whitespace-nowrap text-gray-500 hover:text-gray-950">{review('errorLogs')}<ArrowUpRightIcon className="h-3 w-3" aria-hidden /></Link></div>
     <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden>{operations.errorCategories.map(row => <span key={row.category} className={tones[row.category]} style={{width:`${row.count/c.errors*100}%`}} />)}</div>
     <dl className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-2 ${detailed ? 'sm:grid-cols-3' : ''}`}>{operations.errorCategories.map(row => <div key={row.category} className="flex min-w-0 items-center gap-2 text-xs" title={`${t(`categories.${row.category}`)} · ${percent(row.count,c.errors)}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tones[row.category]}`} aria-hidden /><dt className="truncate text-gray-600">{t(`categories.${row.category}`)}</dt><dd className="ml-auto whitespace-nowrap font-mono tabular-nums text-gray-900">{row.count}</dd></div>)}</dl>
    </div> : <p className="text-xs text-gray-500">{t('noErrors')}</p>}
   </div>
   {otherStates.length > 0 && <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-xs">{otherStates.map(status => <Link key={status} className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-950" href={dashboardLogsHref(range,{status})}>{t(status)}<span className="font-mono tabular-nums text-amber-700">{c[status]}</span><ArrowUpRightIcon className="h-3 w-3" aria-hidden /></Link>)}</div>}
  </section>
  {operations.providers.length > 0 && <section className={`${panel} h-full`} aria-label={t('providers')}>
   <div className="flex flex-wrap items-center justify-between gap-2"><h2 title={t('providerHint')} className={heading}><ServerStackIcon className="h-4 w-4 text-rose-600" aria-hidden />{t('providers')}</h2><span className="text-[11px] text-gray-500">{review('providerColumns')}</span></div>
   <div className="mt-3 divide-y divide-gray-100">{operations.providers.map((row,index) => {
    const content = <><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-rose-50 font-mono text-xs text-rose-600">{index+1}</span>
     <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-900" title={row.name || ''}>{row.name || t('unknownProvider')}</p>{row.affectedUsers > 0 && <p className="mt-1 truncate text-[11px] text-gray-500">{t('affected',{count:row.affectedUsers})}</p>}</div>
     <div className="shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums"><p className="text-rose-700">{percent(row.errors,row.requests)}</p><p className="mt-1 text-[11px] text-gray-500">{row.errors} / {row.requests}</p></div>
     {row.id && <ArrowUpRightIcon className="h-3 w-3 shrink-0 text-gray-400 group-hover:text-gray-900" aria-hidden />}</>;
    const rowClass = 'group -mx-2 flex min-w-0 items-center gap-3 rounded-lg px-2 py-3';
    return row.id ? <Link key={row.id} href={dashboardLogsHref(range,{status:'error',provider_id:row.id})} className={`${rowClass} hover:bg-gray-50`} aria-label={t('inspectProvider',{name:row.name || t('unknownProvider')})}>{content}</Link>
     : <div key={`unknown-${index}`} className={rowClass}>{content}</div>;
   })}</div>
  </section>}
 </div>;
}

/** Definitions stay available without turning each panel into a paragraph of instructions. */
export function DashboardMetricDefinitions() {
 const t = useTranslations('dashboard.operations');
 const review = useTranslations('dashboard.review');
 return <details className="text-xs text-gray-500"><summary className="w-fit cursor-pointer rounded py-1 hover:text-gray-900">{review('definitions')}</summary><dl className="mt-3 grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">{[['costEfficiency','costBasis'],['timing','ttftHint'],['duration','latencyHint'],['failoverDefinition','coverageDefinition'],['errorsDefinition','classificationHint'],['providersDefinition','providerBasis']].map(([label,hint]) => <div key={hint}><dt className="font-medium text-gray-700">{review(label)}</dt><dd className="mt-1 leading-5">{hint === 'coverageDefinition' ? review(hint) : hint === 'costBasis' ? `${t(hint)} ${t('factorHint')}` : t(hint)}</dd></div>)}</dl></details>;
}
