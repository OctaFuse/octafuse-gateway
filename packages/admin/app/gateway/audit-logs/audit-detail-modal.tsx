'use client';

import { AdminContentMark } from '@/components/admin-content-mark';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ArrowUpRightIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  ListBulletIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAdminDialog } from '@/components/use-admin-dialog';
import { useFeedback } from '@/components/feedback';
import {
  auditDiffRows,
  auditDisplayExtras,
  auditEnumLabel,
  parseAuditActorId,
} from '@/lib/audit-log-display';
import type { GatewayApiKeyBudgetAuditLog } from '@/lib/types';
import { formatGatewayDateTime } from '@/lib/datetime';
import { AuditFinancialView } from './audit-financial-view';
import { auditFinancialRows, auditRequestHref, auditUserEmail } from './audit-log-presentation';

export type AuditDetailTab = 'overview' | 'changes' | 'raw';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-gray-800 [overflow-wrap:anywhere]">
        {children || '—'}
      </dd>
    </div>
  );
}
function RawRecord({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string | null | undefined;
  onCopy: (value: string) => void;
}) {
  const t = useTranslations('common');
  let formatted = value || '';
  try {
    if (formatted) formatted = JSON.stringify(JSON.parse(formatted), null, 2);
  } catch {
    /* Preserve malformed legacy data. */
  }
  return (
    <details className="rounded-lg border border-gray-200">
      <summary className="cursor-pointer px-3 py-3 text-sm text-gray-700">{label}</summary>
      <div className="border-t border-gray-100 p-3">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => onCopy(formatted)}
            disabled={!formatted}
            className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40"
          >
            {t('copy')}
          </button>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-600 [overflow-wrap:anywhere]">
          {formatted || '—'}
        </pre>
      </div>
    </details>
  );
}
export function AuditDetailModal({
  item,
  currency,
  timezone,
  initialTab = 'overview',
  onClose,
}: {
  item: GatewayApiKeyBudgetAuditLog;
  currency: string;
  timezone: string;
  initialTab?: AuditDetailTab;
  onClose: () => void;
}) {
  const t = useTranslations('auditLogs');
  const common = useTranslations('common');
  const { notify } = useFeedback();
  const [tab, setTab] = useState<AuditDetailTab>(initialTab);
  const id = useId();
  const ref = useAdminDialog(true, false, onClose);
  const extra = auditDisplayExtras(item);
  const actor = parseAuditActorId(extra.actor_id);
  const email = auditUserEmail(item);
  const money = auditFinancialRows(item);
  const changes = auditDiffRows(item);
  const requestHref = auditRequestHref(item);
  const tabs = [
    { id: 'overview', icon: ListBulletIcon },
    { id: 'changes', icon: DocumentTextIcon },
    { id: 'raw', icon: CodeBracketIcon },
  ] as const;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify('success', common('copied'));
    } catch {
      notify('error', t('ui.copyFailed'));
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="admin-content-dialog flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white outline-none"
      >
        <header className="admin-dialog-header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="admin-dialog-title text-base font-medium text-gray-900">
              <AdminContentMark />
              {t('ui.detailTitle')}
            </h2>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs text-gray-500" title={item.id}>
                {item.id}
              </span>
              <button
                type="button"
                aria-label={t('ui.copyAuditId')}
                onClick={() => void copy(item.id)}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100"
              >
                <ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label={common('close')}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </header>
        <div className="shrink-0 border-b border-gray-100 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-900">
              {auditEnumLabel(t, 'eventTypes', item.event_type)}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <ClockIcon className="h-3.5 w-3.5" aria-hidden />
              {formatGatewayDateTime(item.created_at, timezone)}
            </span>
          </div>
          <div
            role="tablist"
            aria-label={t('ui.detailTitle')}
            className="mt-3 flex flex-wrap gap-1"
          >
            {tabs.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`${id}-panel-${item.id}`}
                  tabIndex={tab === item.id ? 0 : -1}
                  onClick={() => setTab(item.id)}
                  onKeyDown={(event) => {
                    let next = index;
                    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                    else if (event.key === 'ArrowLeft')
                      next = (index + tabs.length - 1) % tabs.length;
                    else if (event.key === 'Home') next = 0;
                    else if (event.key === 'End') next = tabs.length - 1;
                    else return;
                    event.preventDefault();
                    setTab(tabs[next].id);
                    event.currentTarget.parentElement
                      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                      [next]?.focus();
                  }}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs ${
                    tab === item.id ? 'bg-gray-950 text-white' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {t(`ui.${item.id}`)}
                  {item.id === 'changes' && (
                    <span className="tabular-nums opacity-70">{changes.length}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div
          role="tabpanel"
          id={`${id}-panel-${tab}`}
          aria-labelledby={`${id}-tab-${tab}`}
          className="admin-dialog-body min-h-0 overflow-y-auto overscroll-contain p-5"
        >
          {tab === 'overview' && (
            <div className="space-y-5">
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label={t('ui.user')}>
                  {item.user_id ? (
                    <Link
                      href={`/gateway/users/${encodeURIComponent(item.user_id)}`}
                      className="hover:underline"
                    >
                      {email || '—'}
                      <ArrowUpRightIcon className="ml-1 inline h-3 w-3 text-gray-400" aria-hidden />
                    </Link>
                  ) : (
                    email || t('ui.userUnavailable')
                  )}
                </Field>
                <Field label={t('table.actor')}>
                  {auditEnumLabel(t, 'actorTypes', item.actor_type)}
                  {actor.kind && ` · ${auditEnumLabel(t, 'actorKinds', actor.kind)}`}
                  <p className="mt-1 break-all font-mono text-xs text-gray-500">
                    {actor.identifier || '—'}
                  </p>
                </Field>
                <Field label={t('filters.source')}>
                  {auditEnumLabel(t, 'sourceChannels', extra.source)}
                </Field>
                <Field label={t('filters.reasonCode')}>
                  <span className="font-mono text-xs">{extra.reason_code || '—'}</span>
                </Field>
                <div className="sm:col-span-2">
                  <Field label={t('ui.reasonText')}>{extra.reason_text}</Field>
                </div>
              </dl>
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="min-w-0 rounded-xl border border-gray-200 p-4">
                  <h3 className="mb-3 text-sm font-medium text-gray-900">{t('table.budget')}</h3>
                  <AuditFinancialView rows={money.cycle} currency={currency} timezone={timezone} />
                </section>
                <section className="min-w-0 rounded-xl border border-gray-200 p-4">
                  <h3 className="mb-3 text-sm font-medium text-gray-900">{t('table.wallet')}</h3>
                  <AuditFinancialView rows={money.wallet} currency={currency} timezone={timezone} />
                </section>
              </div>
              <details className="rounded-lg border border-gray-200 p-3">
                <summary className="cursor-pointer text-sm text-gray-700">
                  {t('ui.identifiers')}
                </summary>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label={t('filters.userId')}>
                    <span className="font-mono text-xs">{item.user_id || '—'}</span>
                  </Field>
                  <Field label={t('filters.apiKeyId')}>
                    <span className="font-mono text-xs">{item.api_key_id || '—'}</span>
                  </Field>
                  <Field label={t('ui.requestId')}>
                    <span className="font-mono text-xs">{item.request_log_id || '—'}</span>
                  </Field>
                  <Field label={t('filters.correlationId')}>
                    <span className="font-mono text-xs">{extra.correlation_id || '—'}</span>
                  </Field>
                </dl>
              </details>
            </div>
          )}
          {tab === 'changes' &&
            (changes.length ? (
              <div className="space-y-3">
                {changes.map((row, index) => (
                  <section
                    key={`${row.group}-${row.field}-${index}`}
                    className="grid gap-3 rounded-lg border border-gray-200 p-3 sm:grid-cols-[minmax(0,.7fr)_minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <div className="min-w-0">
                      <h3 className="break-all font-mono text-xs font-medium text-gray-800">
                        {row.field}
                      </h3>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {row.group === 'snapshot'
                          ? t('labels.userSnapshot')
                          : t('labels.extraJson')}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-xs text-gray-500">{t('labels.before')}</p>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-2 font-mono text-xs text-amber-800 [overflow-wrap:anywhere]">
                        {row.before}
                      </pre>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-xs text-gray-500">{t('labels.after')}</p>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-2 font-mono text-xs text-sky-800 [overflow-wrap:anywhere]">
                        {row.after}
                      </pre>
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-gray-500">
                {t('labels.noChangeDetail')}
              </p>
            ))}
          {tab === 'raw' && (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-gray-500">{t('ui.rawHint')}</p>
              <RawRecord
                label={t('ui.beforeSnapshot')}
                value={item.before_user_snapshot}
                onCopy={(value) => void copy(value)}
              />
              <RawRecord
                label={t('ui.afterSnapshot')}
                value={item.after_user_snapshot}
                onCopy={(value) => void copy(value)}
              />
              <RawRecord
                label={t('labels.extraJson')}
                value={item.change_payload}
                onCopy={(value) => void copy(value)}
              />
              <RawRecord
                label={t('ui.changedFields')}
                value={item.changed_fields}
                onCopy={(value) => void copy(value)}
              />
            </div>
          )}
        </div>
        <footer className="admin-dialog-footer flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-5 py-3">
          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
            {requestHref && (
              <Link href={requestHref} className="inline-flex items-center gap-1 hover:underline">
                {t('ui.viewRequest')}
                <ArrowUpRightIcon className="h-3 w-3" aria-hidden />
              </Link>
            )}
            {item.user_id && (
              <Link
                href={`/gateway/users/${encodeURIComponent(item.user_id)}?section=activity`}
                className="inline-flex items-center gap-1 hover:underline"
              >
                {t('ui.userActivity')}
                <ArrowUpRightIcon className="h-3 w-3" aria-hidden />
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-gray-200 bg-white px-4 text-xs text-gray-700"
          >
            {common('close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
