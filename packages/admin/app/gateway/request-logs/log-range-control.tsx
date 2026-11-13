'use client';

import { AdminContentMark } from '@/components/admin-content-mark';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDaysIcon, ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  createRangeValue,
  formatGatewayRangeSummary,
  GATEWAY_CALENDAR_PRESETS,
  GATEWAY_TIME_RANGE_PRESETS,
  type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { formatBusinessTimezoneLabel, utcApiToZonedInput } from '@/lib/business-timezone-client';
import { useAdminDialog } from '@/components/use-admin-dialog';
import { customLogRange } from './request-log-query';

export function LogRangeControl({
  value,
  timeZone,
  onChange, onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
  value: GatewayTimeRangeValue;
  timeZone: string;
  onChange: (value: GatewayTimeRangeValue) => void;
}) {
  const t = useTranslations('requestLogs.ui');
  const tr = useTranslations('timeRange');
  const common = useTranslations('common');
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => { setOpenState(next); onOpenChange?.(next); };
  const [draft, setDraft] = useState(value);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const ref = useAdminDialog(open, false, () => setOpen(false));
  const label =
    !value.start_date && !value.end_date
      ? t('allTime')
      : formatGatewayRangeSummary(
          value,
          (preset) =>
            tr(
              `${
                ['today', 'this_week', 'this_month'].includes(preset) ? 'calendar' : 'presets'
              }.${preset}`
            ),
          tr('custom'),
          timeZone
        );
  const custom = customLogRange(start, end, timeZone);
  const valid = draft.preset !== 'custom' || custom !== null;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('chooseRange', { range: label })}
        title={label}
        onClick={() => {
          setDraft(value);
          setStart(utcApiToZonedInput(value.start_date, timeZone));
          setEnd(utcApiToZonedInput(value.end_date, timeZone));
          setOpen(true);
        }}
        className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600 hover:bg-gray-50"
      >
        <CalendarDaysIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="max-w-64 truncate">{label}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0" aria-hidden />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6">
          <div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="log-range-title"
            className="admin-content-dialog flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white outline-none"
          >
            <header className="admin-dialog-header flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <h2 id="log-range-title" className="admin-dialog-title text-base font-medium">
                <AdminContentMark />
                {t('rangeTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={common('close')}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <XMarkIcon className="h-4 w-4" aria-hidden />
              </button>
            </header>
            <div className="admin-dialog-body min-h-0 space-y-5 overflow-y-auto p-5">
              <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('presets')}>
                {[...GATEWAY_CALENDAR_PRESETS, ...GATEWAY_TIME_RANGE_PRESETS].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={draft.preset === preset}
                    onClick={() => {
                      const next = createRangeValue(preset, timeZone);
                      setDraft(next);
                      setStart(utcApiToZonedInput(next.start_date, timeZone));
                      setEnd(utcApiToZonedInput(next.end_date, timeZone));
                    }}
                    className={`min-h-9 rounded-lg px-2 py-2 text-xs ${
                      draft.preset === preset
                        ? 'bg-gray-950 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {tr(
                      `${
                        GATEWAY_CALENDAR_PRESETS.includes(
                          preset as (typeof GATEWAY_CALENDAR_PRESETS)[number]
                        )
                          ? 'calendar'
                          : 'presets'
                      }.${preset}`
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={draft.preset === 'custom' && !start && !end}
                  onClick={() => {
                    setDraft({ preset: 'custom', start_date: '', end_date: '' });
                    setStart('');
                    setEnd('');
                  }}
                  className={`min-h-9 rounded-lg px-2 py-2 text-xs ${
                    draft.preset === 'custom' && !start && !end
                      ? 'bg-gray-950 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t('allTime')}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2 text-xs text-gray-500">
                  {tr('start')}
                  <input
                    type="datetime-local"
                    value={start}
                    aria-label={tr('start')}
                    onInput={(e) => {
                      setStart(e.currentTarget.value);
                      setDraft({ ...draft, preset: 'custom' });
                    }}
                    className="block w-full min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                  />
                </label>
                <label className="space-y-2 text-xs text-gray-500">
                  {tr('end')}
                  <input
                    type="datetime-local"
                    value={end}
                    aria-label={tr('end')}
                    onInput={(e) => {
                      setEnd(e.currentTarget.value);
                      setDraft({ ...draft, preset: 'custom' });
                    }}
                    className="block w-full min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                  />
                </label>
              </div>
              {!valid && (
                <p role="alert" className="text-xs text-red-600">
                  {t('invalidRange')}
                </p>
              )}
              <p className="text-xs leading-5 text-gray-500">
                {tr('label', { timezone: formatBusinessTimezoneLabel(timeZone) })} ·{' '}
                {t('openRangeHint')}
              </p>
            </div>
            <footer className="admin-dialog-footer flex shrink-0 justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-lg border border-gray-200 bg-white px-4 text-xs"
              >
                {common('cancel')}
              </button>
              <button
                type="button"
                disabled={!valid}
                onClick={() => {
                  if (!valid) return;
                  onChange(
                    draft.preset === 'custom' ? custom! : createRangeValue(draft.preset, timeZone)
                  );
                  setOpen(false);
                }}
                className="h-9 rounded-lg admin-primary px-4 text-xs disabled:opacity-50"
              >
                {common('apply')}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
