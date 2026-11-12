'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AdjustmentsHorizontalIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  CurrencyDollarIcon,
  KeyIcon,
  UserPlusIcon,
  UserMinusIcon,
  MagnifyingGlassIcon,
  WalletIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { AdaptiveFilterGroup } from '@/components/adaptive-filter-group';
import { useBusinessTimezoneContext } from '@/components/BusinessTimezoneProvider';
import { readApiJson } from '@/lib/api-json';
import {
  auditDiffRows,
  auditDisplayExtras,
  auditEnumLabel,
  parseAuditActorId,
  shortAuditId,
} from '@/lib/audit-log-display';
import {
  API_KEY_BUDGET_AUDIT_ACTOR_TYPES,
  API_KEY_BUDGET_AUDIT_EVENT_TYPES,
  API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS,
  type GatewayApiKeyBudgetAuditLog,
} from '@/lib/types';
import { createRangeValue } from '@/lib/analytics-range';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { LogRangeControl } from '../request-logs/log-range-control';
import { AuditDetailModal, type AuditDetailTab } from './audit-detail-modal';
import { AuditFilterSection } from './audit-filter-section';
import { AuditFinancialView } from './audit-financial-view';
import {
  ACTOR_KINDS,
  DEFAULT_EVENTS,
  auditQuery,
  readAuditFilters,
  sameSelection,
  type AuditFilters,
} from './audit-log-query';
import { auditFinancialRows, auditUserEmail } from './audit-log-presentation';

export default function GatewayAuditLogsPage() {
  const t = useTranslations('auditLogs');
  const common = useTranslations('common');
  const router = useRouter();
  const { businessTimezone, formatDate, formatTime } = useGatewayDateTime();
  const { isLoading: timezoneLoading } = useBusinessTimezoneContext();
  const { currency } = useBillingCurrency();
  const [filters, setFilters] = useState<AuditFilters>(() =>
    readAuditFilters('', businessTimezone)
  );
  const [ready, setReady] = useState(false);
  const [logs, setLogs] = useState<GatewayApiKeyBudgetAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reasonOptions, setReasonOptions] = useState<string[]>([]);
  const [optionsError, setOptionsError] = useState('');
  const [detail, setDetail] = useState<{
    item: GatewayApiKeyBudgetAuditLog;
    tab: AuditDetailTab;
  } | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    if (timezoneLoading || ready) return;
    setFilters(readAuditFilters(window.location.search, businessTimezone));
    setReady(true);
  }, [timezoneLoading, ready, businessTimezone]);
  const urlQuery = useMemo(() => auditQuery(filters, 'url'), [filters]);
  const apiQuery = useMemo(() => auditQuery(filters, 'api'), [filters]);
  useEffect(() => {
    if (ready) router.replace(`/gateway/audit-logs?${urlQuery}`, { scroll: false });
  }, [urlQuery, ready, router]);
  const fetchLogs = useCallback(async () => {
    if (!ready) return;
    const request = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/budget-audit-logs?${apiQuery}`);
      const data = await readApiJson<GatewayApiKeyBudgetAuditLog[]>(response);
      if (request !== sequence.current) return;
      if (!data.success) {
        setError(data.message || t('ui.loadFailed'));
        return;
      }
      setLogs(data.data || []);
      setTotal(data.total || 0);
    } catch (err) {
      if (request === sequence.current)
        setError(err instanceof Error ? err.message : t('ui.loadFailed'));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [apiQuery, ready, t]);
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);
  const fetchOptions = useCallback(async () => {
    setOptionsError('');
    try {
      const res = await fetch('/api/admin/budget-audit-logs/filters');
      const data = await readApiJson<{ reasonCodes: string[] }>(res);
      if (!data.success) throw new Error(data.message || t('ui.loadFailed'));
      setReasonOptions(data.data?.reasonCodes || []);
    } catch {
      setOptionsError(t('ui.optionsFailed'));
    }
  }, [t]);
  useEffect(() => {
    void fetchOptions();
  }, [fetchOptions]);
  const update = <K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === 'page' ? Number(value) : 1,
    }));
  const reasonCodes = [...new Set([...reasonOptions, ...(filters.reasons || [])])].sort();
  const scope = sameSelection(filters.events, DEFAULT_EVENTS)
    ? 'changes'
    : sameSelection(filters.events, ['usage_charge'])
    ? 'usage'
    : sameSelection(filters.events, API_KEY_BUDGET_AUDIT_EVENT_TYPES)
    ? 'all'
    : 'custom';
  const advanced = [
    {
      key: 'userId',
      label: t('filters.userId'),
      value: filters.userId,
      reset: () => update('userId', ''),
    },
    {
      key: 'apiKeyId',
      label: t('filters.apiKeyId'),
      value: filters.apiKeyId,
      reset: () => update('apiKeyId', ''),
    },
    {
      key: 'actorId',
      label: t('filters.actorId'),
      value: filters.actorId,
      reset: () => update('actorId', ''),
    },
    {
      key: 'correlationId',
      label: t('filters.correlationId'),
      value: filters.correlationId,
      reset: () => update('correlationId', ''),
    },
    {
      key: 'sources',
      label: t('filters.source'),
      value: !sameSelection(filters.sources, API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS)
        ? filters.sources.map((value) => auditEnumLabel(t, 'sourceChannels', value)).join(', ')
        : '',
      reset: () => update('sources', [...API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS]),
    },
    {
      key: 'actors',
      label: t('filters.actor'),
      value: !sameSelection(filters.actors, API_KEY_BUDGET_AUDIT_ACTOR_TYPES)
        ? filters.actors.map((value) => auditEnumLabel(t, 'actorTypes', value)).join(', ')
        : '',
      reset: () => update('actors', [...API_KEY_BUDGET_AUDIT_ACTOR_TYPES]),
    },
    {
      key: 'kinds',
      label: t('filters.actorKind'),
      value: !sameSelection(filters.kinds, ACTOR_KINDS)
        ? filters.kinds.map((value) => auditEnumLabel(t, 'actorKinds', value)).join(', ')
        : '',
      reset: () => update('kinds', [...ACTOR_KINDS]),
    },
    {
      key: 'reasons',
      label: t('filters.reasonCode'),
      value: filters.reasons?.join(', ') || '',
      reset: () => update('reasons', null),
    },
  ].filter((item) => item.value);
  const inputClass =
    'h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700';
  const hasFilters = Boolean(filters.email || scope !== 'changes' || advanced.length);
  const totalPages = Math.ceil(total / 50);
  return (
    <div className="admin-content-workspace content-tone-inference min-h-full min-w-0 p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <AdminPageTitle>{t('title')}</AdminPageTitle>
          <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
        </div>
        <div className="flex max-w-full items-center gap-2">
          <LogRangeControl
            value={filters.range}
            timeZone={businessTimezone}
            onChange={(range) => update('range', range)}
          />
          <button
            type="button"
            onClick={() => {
              if (filters.range.preset !== 'custom')
                update('range', createRangeValue(filters.range.preset, businessTimezone));
              else void fetchLogs();
            }}
            disabled={loading}
            aria-label={t('ui.refresh')}
            title={t('ui.refresh')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-40"
          >
            <ArrowPathIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <section aria-label={t('ui.filters')} className="admin-filter-surface mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-60 sm:max-w-xs">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
            <input
              type="search"
              value={filters.email}
              onChange={(event) => update('email', event.target.value)}
              aria-label={t('filters.userEmail')}
              placeholder={t('ui.searchEmail')}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select
            aria-label={t('ui.eventScope')}
            value={scope}
            onChange={(event) =>
              update(
                'events',
                event.target.value === 'changes'
                  ? [...DEFAULT_EVENTS]
                  : event.target.value === 'usage'
                  ? ['usage_charge']
                  : [...API_KEY_BUDGET_AUDIT_EVENT_TYPES]
              )
            }
            className="h-10 w-44 max-w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700"
          >
            <option value="changes">{t('ui.changeRecords')}</option>
            <option value="usage">{t('eventTypes.usage_charge')}</option>
            <option value="all">{t('ui.allEvents')}</option>
            <option value="custom" disabled>
              {t('ui.customEvents')}
            </option>
          </select>
          <AdaptiveFilterGroup
            label={t('ui.moreFilters')}
            activeCount={advanced.length + Number(scope === 'custom')}
            extraCount={advanced.filter(item => !['userId', 'apiKeyId', 'actorId', 'correlationId'].includes(item.key)).length + Number(scope === 'custom')}
            inlineClassName="order-1 basis-full w-full"
            size="lg"
            extra={<>
            <AuditFilterSection
              label={t('filters.eventType')}
              options={API_KEY_BUDGET_AUDIT_EVENT_TYPES.map((value) => ({
                value,
                label: auditEnumLabel(t, 'eventTypes', value),
              }))}
              selected={filters.events}
              defaultValue={[...DEFAULT_EVENTS]}
              onChange={(values) =>
                update('events', values || [...API_KEY_BUDGET_AUDIT_EVENT_TYPES])
              }
            />
            <AuditFilterSection
              label={t('filters.source')}
              options={API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS.map((value) => ({
                value,
                label: auditEnumLabel(t, 'sourceChannels', value),
              }))}
              selected={filters.sources}
              onChange={(values) =>
                update('sources', values || [...API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS])
              }
            />
            <AuditFilterSection
              label={t('filters.actor')}
              options={API_KEY_BUDGET_AUDIT_ACTOR_TYPES.map((value) => ({
                value,
                label: auditEnumLabel(t, 'actorTypes', value),
              }))}
              selected={filters.actors}
              onChange={(values) =>
                update('actors', values || [...API_KEY_BUDGET_AUDIT_ACTOR_TYPES])
              }
            />
            <AuditFilterSection
              label={t('filters.actorKind')}
              options={ACTOR_KINDS.map((value) => ({
                value,
                label: auditEnumLabel(t, 'actorKinds', value),
              }))}
              selected={filters.kinds}
              onChange={(values) => update('kinds', values || [...ACTOR_KINDS])}
            />
            <AuditFilterSection
              label={t('filters.reasonCode')}
              options={reasonCodes.map((value) => ({ value, label: value }))}
              selected={filters.reasons || reasonCodes}
              onChange={(values) => update('reasons', values)}
            />
            {optionsError && (
              <p role="alert" className="text-xs text-amber-700">
                {optionsError}{' '}
                <button type="button" onClick={() => void fetchOptions()} className="underline">
                  {t('ui.retry')}
                </button>
              </p>
            )}
            </>}
          >
            <div className="admin-audit-identities grid gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    key: 'userId',
                    label: t('filters.userId'),
                    placeholder: t('filters.userIdPlaceholder'),
                  },
                  {
                    key: 'apiKeyId',
                    label: t('filters.apiKeyId'),
                    placeholder: t('filters.apiKeyPlaceholder'),
                  },
                  {
                    key: 'actorId',
                    label: t('filters.actorId'),
                    placeholder: t('filters.actorIdPlaceholder'),
                  },
                  {
                    key: 'correlationId',
                    label: t('filters.correlationId'),
                    placeholder: t('filters.correlationPlaceholder'),
                  },
                ] as const
              ).map((field) => (
                <label key={field.key} className="block space-y-2 text-xs text-gray-500">
                  {field.label}
                  <input
                    value={filters[field.key]}
                    onChange={(event) => update(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    className={`${inputClass} font-mono text-xs`}
                  />
                </label>
              ))}
            </div>
          </AdaptiveFilterGroup>
          {hasFilters && (
            <button
              type="button"
              onClick={() =>
                setFilters({
                  ...readAuditFilters('', businessTimezone),
                  range: { preset: 'custom', start_date: '', end_date: '' },
                })
              }
              className="text-xs text-gray-500 hover:text-gray-900"
            >
              {common('clearFilters')}
            </button>
          )}
          <span
            role="status"
            aria-live="polite"
            className="ml-auto text-xs tabular-nums text-gray-500"
          >
            {t('totalRecords', { count: total })}
          </span>
        </div>
        {advanced.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {advanced.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-label={t('ui.removeFilter', { name: item.label })}
                title={`${item.label}: ${item.value}`}
                onClick={item.reset}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500"
              >
                <span className="max-w-64 truncate">
                  {item.label}: {item.value}
                </span>
                <XMarkIcon className="h-3 w-3 shrink-0" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </section>
      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <span>{error}</span>
          <button type="button" onClick={() => void fetchLogs()} className="text-xs underline">
            {t('ui.retry')}
          </button>
        </div>
      )}
      <div className="admin-content-panel admin-table-surface overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div
          aria-busy={loading}
          className={`overflow-x-auto ${loading && logs.length ? 'opacity-60' : ''}`}
        >
          <table className="admin-data-table w-full min-w-[60rem] table-fixed">
            <colgroup>
              {['20%', '18%', '16%', '18%', '18%', '10%'].map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <thead className="border-b border-gray-200 bg-gray-50/80">
              <tr>
                {[
                  'ui.eventTime',
                  'ui.user',
                  'table.actor',
                  'table.budget',
                  'table.wallet',
                  'ui.changes',
                ].map((key) => (
                  <th key={key} className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading &&
                logs.length === 0 &&
                Array.from({ length: 6 }, (_, row) => (
                  <tr key={row}>
                    {Array.from({ length: 6 }, (_, cell) => (
                      <td key={cell} className="px-4 py-5">
                        <div className="h-4 w-24 max-w-full animate-pulse rounded bg-gray-100" />
                      </td>
                    ))}
                  </tr>
                ))}
              {logs.map((item) => {
                const extra = auditDisplayExtras(item);
                const actor = parseAuditActorId(extra.actor_id);
                const email = auditUserEmail(item);
                const money = auditFinancialRows(item);
                const changes = auditDiffRows(item);
                const count =
                  money.cycle.filter((row) => row.changed).length +
                  money.wallet.filter((row) => row.changed).length +
                  changes.length;
                const Icon =
                  item.event_type === 'user_created'
                    ? UserPlusIcon
                    : item.event_type === 'user_deleted'
                    ? UserMinusIcon
                    : item.event_type === 'key_created'
                    ? KeyIcon
                    : item.event_type === 'wallet_credit'
                    ? WalletIcon
                    : item.event_type === 'usage_charge'
                    ? CurrencyDollarIcon
                    : item.event_type === 'period_reset'
                    ? ArrowPathIcon
                    : ['key_deleted', 'key_revoked', 'user_deleted'].includes(item.event_type)
                    ? ArchiveBoxIcon
                    : AdjustmentsHorizontalIcon;
                const tone =
                  item.event_type === 'wallet_credit'
                    ? 'bg-emerald-50 text-emerald-600'
                    : item.event_type === 'period_reset'
                    ? 'bg-amber-50 text-amber-600'
                    : item.event_type === 'usage_charge'
                    ? 'bg-gray-100 text-gray-500'
                    : ['key_deleted', 'key_revoked', 'user_deleted'].includes(item.event_type)
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-sky-50 text-sky-600';
                return (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={() => setDetail({ item, tab: 'overview' })}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === 'Enter' || event.key === ' ')
                      ) {
                        event.preventDefault();
                        setDetail({ item, tab: 'overview' });
                      }
                    }}
                    className="cursor-pointer align-middle hover:bg-gray-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-500"
                  >
                    <td className="overflow-hidden px-4 py-3.5">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <p
                            className="truncate text-sm font-medium text-gray-900"
                            title={item.event_type}
                          >
                            {auditEnumLabel(t, 'eventTypes', item.event_type)}
                          </p>
                          <p
                            className="mt-1 truncate text-xs text-gray-500"
                            title={extra.source || undefined}
                          >
                            {auditEnumLabel(t, 'sourceChannels', extra.source)}
                          </p>
                          <p className="mt-1 flex flex-wrap gap-x-2 text-xs tabular-nums text-gray-500">
                            <span>{formatDate(item.created_at)}</span>
                            <span>{formatTime(item.created_at)}</span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="overflow-hidden px-4 py-3.5 text-sm text-gray-800">
                      <p className="truncate" title={email || undefined}>
                        {item.user_id ? (
                          <Link
                            href={`/gateway/users/${encodeURIComponent(item.user_id)}`}
                            onClick={(event) => event.stopPropagation()}
                            className="hover:underline"
                          >
                            {email || shortAuditId(item.user_id)}
                          </Link>
                        ) : (
                          email || t('ui.userUnavailable')
                        )}
                      </p>
                      {!item.user_id && (
                        <span className="mt-1 block text-xs text-gray-400">
                          {t('ui.userArchived')}
                        </span>
                      )}
                    </td>
                    <td className="overflow-hidden px-4 py-3.5">
                      <p className="truncate text-xs text-gray-800">
                        {actor.kind
                          ? auditEnumLabel(t, 'actorKinds', actor.kind)
                          : auditEnumLabel(t, 'actorTypes', item.actor_type)}
                      </p>
                      <p
                        className="mt-1 truncate font-mono text-xs text-gray-500"
                        title={extra.actor_id || undefined}
                      >
                        {actor.identifier ? shortAuditId(actor.identifier) : '—'}
                      </p>
                    </td>
                    <td className="overflow-hidden px-4 py-3.5">
                      <AuditFinancialView
                        rows={money.cycle}
                        currency={currency}
                        timezone={businessTimezone}
                        summary
                      />
                    </td>
                    <td className="overflow-hidden px-4 py-3.5">
                      <AuditFinancialView
                        rows={money.wallet}
                        currency={currency}
                        timezone={businessTimezone}
                        summary
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDetail({ item, tab: changes.length ? 'changes' : 'overview' });
                        }}
                        className="inline-flex max-w-full items-center gap-1 text-xs text-gray-500 hover:text-gray-950"
                      >
                        <span>
                          {count ? t('ui.changeCount', { count }) : t('labels.viewChangeDetail')}
                        </span>
                        <ChevronRightIcon className="h-3 w-3 shrink-0" aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && !logs.length && !error && (
          <p className="py-16 text-center text-sm text-gray-500">{t('empty')}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
          <span className="text-xs text-gray-500">
            {scope === 'changes' ? t('ui.defaultHint') : t('ui.detailHint')}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loading || filters.page <= 1}
                onClick={() => update('page', filters.page - 1)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-40"
              >
                {common('previous')}
              </button>
              <span className="text-xs tabular-nums text-gray-500">
                {common('pageOf', { page: filters.page, totalPages })}
              </span>
              <button
                type="button"
                disabled={loading || filters.page >= totalPages}
                onClick={() => update('page', filters.page + 1)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-40"
              >
                {common('next')}
              </button>
            </div>
          )}
        </div>
      </div>
      {detail && (
        <AuditDetailModal
          key={detail.item.id}
          item={detail.item}
          initialTab={detail.tab}
          currency={currency}
          timezone={businessTimezone}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
