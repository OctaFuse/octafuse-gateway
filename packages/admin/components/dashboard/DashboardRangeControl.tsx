'use client';

import { AdminContentMark } from '@/components/admin-content-mark';

import { useId, useRef, useState } from 'react';
import { CalendarDaysIcon, ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { createRangeValue, GATEWAY_CALENDAR_PRESETS, GATEWAY_TIME_RANGE_PRESETS, type GatewayTimeRangeValue, type GatewayTimeRangePreset } from '@/lib/analytics-range';
import { formatBusinessTimezoneLabel, utcApiToZonedInput, zonedInputToUtcApi } from '@/lib/business-timezone-client';

export function DashboardRangeControl({ value, label, timeZone, onChange }: {
  value: GatewayTimeRangeValue; label: string; timeZone: string; onChange: (value: GatewayTimeRangeValue) => void;
}) {
  const t = useTranslations('dashboard');
  const c = useTranslations('common');
  const tr = useTranslations('timeRange');
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<GatewayTimeRangePreset>(value.preset);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const startUtc = zonedInputToUtcApi(start, timeZone);
  const endUtc = zonedInputToUtcApi(end, timeZone);
  const valid = preset !== 'custom' || Boolean(startUtc && endUtc && startUtc < endUtc);
  const select = (next: Exclude<GatewayTimeRangePreset, 'custom' | '90d'>) => {
    const range = createRangeValue(next, timeZone);
    setPreset(next); setStart(utcApiToZonedInput(range.start_date, timeZone)); setEnd(utcApiToZonedInput(range.end_date, timeZone));
  };
  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={t('chooseRange', { range: label })}
      onClick={() => {
        setPreset(value.preset); setStart(utcApiToZonedInput(value.start_date, timeZone)); setEnd(utcApiToZonedInput(value.end_date, timeZone));
        ref.current?.showModal(); setOpen(true);
      }} className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100">
      <CalendarDaysIcon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
      <span className="truncate">{label}</span><ChevronDownIcon className="h-3 w-3 shrink-0 text-gray-500" aria-hidden />
    </button>
    <dialog ref={ref} aria-labelledby={headingId} onClose={() => setOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) ref.current?.close(); }}
      className="admin-content-dialog fixed inset-3 m-auto max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] sm:inset-6 sm:max-h-[calc(100dvh-48px)] sm:w-[calc(100vw-48px)] max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-panel backdrop:bg-gray-950/20">
      <div className="admin-dialog-header flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 id={headingId} className="admin-dialog-title text-base font-medium">
          <AdminContentMark />
          {t('analysisWindow')}
        </h2>
        <button type="button" aria-label={c('close')} onClick={() => ref.current?.close()} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><XMarkIcon className="h-4 w-4" aria-hidden /></button>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={t('analysisWindow')}>
          {[...GATEWAY_CALENDAR_PRESETS, ...GATEWAY_TIME_RANGE_PRESETS].map(p => <button key={p} type="button" aria-pressed={preset === p} onClick={() => select(p)}
            className={`min-h-10 rounded-lg px-3 py-2 text-sm transition-colors ${preset === p ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{t(`rangeLabels.${p}`)}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-xs text-gray-500">{tr('start')}<input aria-label={tr('start')} type="datetime-local" value={start} onInput={e => { setStart(e.currentTarget.value); setPreset('custom'); }} className="block w-full min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900" /></label>
          <label className="space-y-2 text-xs text-gray-500">{tr('end')}<input aria-label={tr('end')} type="datetime-local" value={end} onInput={e => { setEnd(e.currentTarget.value); setPreset('custom'); }} className="block w-full min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900" /></label>
        </div>
        {!valid && <p role="alert" className="text-xs text-red-700">{t('invalidRange')}</p>}
        <p className="text-xs text-gray-500">{tr('label', { timezone: formatBusinessTimezoneLabel(timeZone) })}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
        <button type="button" className="admin-secondary px-4 py-2 text-sm" onClick={() => ref.current?.close()}>{c('cancel')}</button>
        <button type="button" disabled={!valid} className="admin-primary px-4 py-2 text-sm" onClick={() => {
          if (!valid) return;
          onChange(preset === 'custom' ? { preset, start_date: startUtc!, end_date: endUtc! } : createRangeValue(preset, timeZone)); ref.current?.close();
        }}>{c('apply')}</button>
      </div>
    </dialog>
  </>;
}
