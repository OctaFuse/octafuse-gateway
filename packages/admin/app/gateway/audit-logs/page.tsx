'use client';

/**
 * 全站用户审计日志（`user_audit_logs`）：筛选、分页；数据来自 `/api/admin/budget-audit-logs`。
 */
import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback, useRef } from 'react';
import { readApiJson } from '@/lib/api-json';
import {
  API_KEY_BUDGET_AUDIT_ACTOR_TYPES,
  API_KEY_BUDGET_AUDIT_EVENT_TYPES,
  API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS,
  type GatewayApiKeyBudgetAuditLog,
} from '@/lib/types';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import {
  createRangeValue,
  DEFAULT_GATEWAY_TIME_RANGE_PRESET,
  detectRollingPreset,
  type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';
import { MultiSelectDropdown } from '@/components/MultiSelectDropdown';
import { AuditChangeDetailModal, AuditLogSharedCells } from '@/components/AuditLogSharedCells';
import { auditEnumLabel } from '@/lib/audit-log-display';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

const DEFAULT_AUDIT_LOG_EVENT_TYPES = API_KEY_BUDGET_AUDIT_EVENT_TYPES.filter((type) => type !== 'usage_charge');
const AUDIT_LOG_EVENT_TYPE_SET = new Set<string>(API_KEY_BUDGET_AUDIT_EVENT_TYPES);
const DEFAULT_AUDIT_LOG_ACTOR_TYPES = [...API_KEY_BUDGET_AUDIT_ACTOR_TYPES];
const AUDIT_LOG_ACTOR_TYPE_SET = new Set<string>(API_KEY_BUDGET_AUDIT_ACTOR_TYPES);
const DEFAULT_AUDIT_LOG_SOURCE_CHANNELS = [...API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS];
const AUDIT_LOG_SOURCE_CHANNEL_SET = new Set<string>(API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS);
/** 筛选 UI 不含历史 Master Key；全选时不传 `actor_kind`，默认列表仍含老 `admin:` 行。 */
const AUDIT_LOG_ACTOR_KIND_FILTERS = ['console', 'admin_key', 'system', 'service'] as const;
const AUDIT_LOG_ACTOR_KIND_FILTER_SET = new Set<string>(AUDIT_LOG_ACTOR_KIND_FILTERS);

type AuditLogFilterOptions = {
  reasonCodes: string[];
};

function normalizeAuditEventTypes(values: string[]): string[] {
  const normalized: string[] = [];
  values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .forEach((value) => {
      if (AUDIT_LOG_EVENT_TYPE_SET.has(value) && !normalized.includes(value)) normalized.push(value);
    });
  return normalized;
}

function normalizeAuditActorTypes(values: string[]): string[] {
  const normalized: string[] = [];
  values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .forEach((value) => {
      if (AUDIT_LOG_ACTOR_TYPE_SET.has(value) && !normalized.includes(value)) normalized.push(value);
    });
  return normalized;
}

function normalizeAuditActorKinds(values: string[]): string[] {
  const normalized: string[] = [];
  values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .forEach((value) => {
      if (AUDIT_LOG_ACTOR_KIND_FILTER_SET.has(value) && !normalized.includes(value)) normalized.push(value);
    });
  return normalized;
}

function normalizeAuditSourceChannels(values: string[]): string[] {
  const normalized: string[] = [];
  values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .forEach((value) => {
      if (AUDIT_LOG_SOURCE_CHANNEL_SET.has(value) && !normalized.includes(value)) normalized.push(value);
    });
  return normalized;
}

function normalizeAuditReasonCodes(values: string[]): string[] {
  const normalized: string[] = [];
  values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .forEach((value) => {
      if (value !== '' && !normalized.includes(value)) normalized.push(value);
    });
  return normalized;
}

function isSameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

/** 浏览器 URL：Default（8 种，不含 usage_charge）省略参数，短链刷新仍还原为 Default UI。 */
function appendAuditEventTypeUrlParams(params: URLSearchParams, eventTypes: string[]): void {
  if (isSameStringSet(eventTypes, DEFAULT_AUDIT_LOG_EVENT_TYPES)) return;
  eventTypes.forEach((eventType) => params.append('event_type', eventType));
}

/** API 查询：仅全选 9 种时省略（不过滤）；Default 必须带上 8 个 event_type。 */
function appendAuditEventTypeQueryParams(params: URLSearchParams, eventTypes: string[]): void {
  if (isSameStringSet(eventTypes, API_KEY_BUDGET_AUDIT_EVENT_TYPES)) return;
  eventTypes.forEach((eventType) => params.append('event_type', eventType));
}

function appendAuditActorTypeParams(params: URLSearchParams, actorTypes: string[]): void {
  if (actorTypes.length === DEFAULT_AUDIT_LOG_ACTOR_TYPES.length) return;
  actorTypes.forEach((actorType) => params.append('actor_type', actorType));
}

function appendAuditActorKindParams(params: URLSearchParams, actorKinds: string[]): void {
  if (actorKinds.length === AUDIT_LOG_ACTOR_KIND_FILTERS.length) return;
  actorKinds.forEach((actorKind) => params.append('actor_kind', actorKind));
}

function appendAuditSourceParams(params: URLSearchParams, sources: string[]): void {
  if (sources.length === DEFAULT_AUDIT_LOG_SOURCE_CHANNELS.length) return;
  sources.forEach((source) => params.append('source', source));
}

function appendAuditReasonCodeParams(params: URLSearchParams, reasonCodes: string[], allReasonCodes: string[]): void {
  const selectedSet = new Set(reasonCodes);
  const isAllSelected = allReasonCodes.length > 0 && allReasonCodes.every((reasonCode) => selectedSet.has(reasonCode));
  if (reasonCodes.length === 0 || isAllSelected) return;
  reasonCodes.forEach((reasonCode) => params.append('reason_code', reasonCode));
}

export default function GatewayAuditLogsPage() {
  const t = useTranslations('auditLogs');
  const tCommon = useTranslations('common');
  const [logs, setLogs] = useState<GatewayApiKeyBudgetAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const pageSize = 50;
  const { currency: billingCurrency } = useBillingCurrency();
  const { businessTimezone } = useGatewayDateTime();

  const [filterApiKeyId, setFilterApiKeyId] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterUserEmail, setFilterUserEmail] = useState('');
  const [filterEventTypes, setFilterEventTypes] = useState<string[]>(() => [...DEFAULT_AUDIT_LOG_EVENT_TYPES]);
  const [filterActorTypes, setFilterActorTypes] = useState<string[]>(() => [...DEFAULT_AUDIT_LOG_ACTOR_TYPES]);
  const [filterActorKinds, setFilterActorKinds] = useState<string[]>(() => [...AUDIT_LOG_ACTOR_KIND_FILTERS]);
  const [filterActorId, setFilterActorId] = useState('');
  const [filterReasonCodes, setFilterReasonCodes] = useState<string[]>([]);
  const [filterSources, setFilterSources] = useState<string[]>(() => [...DEFAULT_AUDIT_LOG_SOURCE_CHANNELS]);
  const [reasonCodeOptions, setReasonCodeOptions] = useState<string[]>([]);
  const [filterCorrelationId, setFilterCorrelationId] = useState('');
  const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue(DEFAULT_GATEWAY_TIME_RANGE_PRESET));
  const [detailLog, setDetailLog] = useState<GatewayApiKeyBudgetAuditLog | null>(null);
  const reasonCodeUrlFilterRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const apiKeyId = params.get('api_key_id');
    const userId = params.get('user_id');
    const userEmail = params.get('user_email');
    const eventTypes = normalizeAuditEventTypes(params.getAll('event_type'));
    const actorTypes = normalizeAuditActorTypes(params.getAll('actor_type'));
    const actorKinds = normalizeAuditActorKinds(params.getAll('actor_kind'));
    const actorId = params.get('actor_id');
    const reasonCodes = normalizeAuditReasonCodes(params.getAll('reason_code'));
    const sources = normalizeAuditSourceChannels(params.getAll('source'));
    const correlationId = params.get('correlation_id');
    const startDate = params.get('start_date');
    const endDate = params.get('end_date');
    const p = params.get('page');
    if (apiKeyId != null) setFilterApiKeyId(apiKeyId);
    if (userId != null) setFilterUserId(userId);
    if (userEmail != null) setFilterUserEmail(userEmail);
    if (eventTypes.length > 0) setFilterEventTypes(eventTypes);
    if (actorTypes.length > 0) setFilterActorTypes(actorTypes);
    if (actorKinds.length > 0) setFilterActorKinds(actorKinds);
    if (actorId != null) setFilterActorId(actorId);
    if (reasonCodes.length > 0) {
      reasonCodeUrlFilterRef.current = true;
      setFilterReasonCodes(reasonCodes);
    }
    if (sources.length > 0) setFilterSources(sources);
    if (correlationId != null) setFilterCorrelationId(correlationId);
    const hasStart = startDate != null && startDate !== '';
    const hasEnd = endDate != null && endDate !== '';
    if (hasStart || hasEnd) {
      const s = hasStart ? startDate! : '';
      const e = hasEnd ? endDate! : '';
      setRangeValue({
        preset: hasStart && hasEnd ? detectRollingPreset(s, e) ?? 'custom' : 'custom',
        start_date: s,
        end_date: e,
      });
    } else if (startDate == null && endDate == null) {
      setRangeValue(createRangeValue(DEFAULT_GATEWAY_TIME_RANGE_PRESET));
    }
    if (p != null) {
      const n = parseInt(p, 10);
      if (!Number.isNaN(n) && n >= 1) setPage(n);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchFilterOptions() {
      try {
        const response = await fetch('/api/admin/budget-audit-logs/filters');
        const data = await readApiJson<AuditLogFilterOptions>(response);
        if (!data.success || cancelled) return;
        const options = data.data?.reasonCodes ?? [];
        setReasonCodeOptions(options);
        if (!reasonCodeUrlFilterRef.current) {
          setFilterReasonCodes(options);
        }
      } catch (e) {
        console.error('Fetch audit log filter options error:', e);
      }
    }
    fetchFilterOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useReplaceListPageQuery(
    () => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (filterApiKeyId) params.append('api_key_id', filterApiKeyId);
      if (filterUserId) params.append('user_id', filterUserId);
      if (filterUserEmail) params.append('user_email', filterUserEmail);
      appendAuditEventTypeUrlParams(params, filterEventTypes);
      appendAuditActorTypeParams(params, filterActorTypes);
      appendAuditActorKindParams(params, filterActorKinds);
      if (filterActorId) params.append('actor_id', filterActorId);
      appendAuditReasonCodeParams(params, filterReasonCodes, reasonCodeOptions);
      appendAuditSourceParams(params, filterSources);
      if (filterCorrelationId) params.append('correlation_id', filterCorrelationId);
      if (rangeValue.start_date) params.append('start_date', rangeValue.start_date);
      if (rangeValue.end_date) params.append('end_date', rangeValue.end_date);
      return params;
    },
    [
      page,
      pageSize,
      filterApiKeyId,
      filterUserId,
      filterUserEmail,
      filterEventTypes,
      filterActorTypes,
      filterActorKinds,
      filterActorId,
      filterReasonCodes,
      filterSources,
      reasonCodeOptions,
      filterCorrelationId,
      rangeValue.start_date,
      rangeValue.end_date,
    ]
  );

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (filterApiKeyId) params.append('api_key_id', filterApiKeyId);
      if (filterUserId) params.append('user_id', filterUserId);
      if (filterUserEmail) params.append('user_email', filterUserEmail);
      appendAuditEventTypeQueryParams(params, filterEventTypes);
      appendAuditActorTypeParams(params, filterActorTypes);
      appendAuditActorKindParams(params, filterActorKinds);
      if (filterActorId) params.append('actor_id', filterActorId);
      appendAuditReasonCodeParams(params, filterReasonCodes, reasonCodeOptions);
      appendAuditSourceParams(params, filterSources);
      if (filterCorrelationId) params.append('correlation_id', filterCorrelationId);
      if (rangeValue.start_date) params.append('start_date', rangeValue.start_date);
      if (rangeValue.end_date) params.append('end_date', rangeValue.end_date);

      const response = await fetch(`/api/admin/budget-audit-logs?${params.toString()}`);
      const data = await readApiJson<GatewayApiKeyBudgetAuditLog[]>(response);
      if (data.success) {
        setLogs(data.data || []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      console.error('Fetch budget audit logs error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [
    page,
    filterApiKeyId,
    filterUserId,
    filterUserEmail,
    filterEventTypes,
    filterActorTypes,
    filterActorKinds,
    filterActorId,
    filterReasonCodes,
    filterSources,
    reasonCodeOptions,
    filterCorrelationId,
    rangeValue.start_date,
    rangeValue.end_date,
    pageSize,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / pageSize);
  const setEventTypeChecked = (eventType: string, checked: boolean) => {
    setFilterEventTypes((current) => {
      if (checked) return current.includes(eventType) ? current : [...current, eventType];
      if (current.length <= 1) return current;
      return current.filter((value) => value !== eventType);
    });
    setPage(1);
  };
  const setActorTypeChecked = (actorType: string, checked: boolean) => {
    setFilterActorTypes((current) => {
      if (checked) return current.includes(actorType) ? current : [...current, actorType];
      if (current.length <= 1) return current;
      return current.filter((value) => value !== actorType);
    });
    setPage(1);
  };
  const setActorKindChecked = (actorKind: string, checked: boolean) => {
    setFilterActorKinds((current) => {
      if (checked) return current.includes(actorKind) ? current : [...current, actorKind];
      if (current.length <= 1) return current;
      return current.filter((value) => value !== actorKind);
    });
    setPage(1);
  };
  const setSourceChecked = (source: string, checked: boolean) => {
    setFilterSources((current) => {
      if (checked) return current.includes(source) ? current : [...current, source];
      if (current.length <= 1) return current;
      return current.filter((value) => value !== source);
    });
    setPage(1);
  };
  const setReasonCodeChecked = (reasonCode: string, checked: boolean) => {
    setFilterReasonCodes((current) => {
      if (checked) return current.includes(reasonCode) ? current : [...current, reasonCode];
      if (current.length <= 1) return current;
      return current.filter((value) => value !== reasonCode);
    });
    setPage(1);
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
      </div>

      <div className="mb-4 w-full min-w-0">
        <GatewayTimeRangePicker
          value={rangeValue}
          onChange={(v) => {
            setRangeValue(v);
            setPage(1);
          }}
        />
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MultiSelectDropdown
            label={t('filters.eventType')}
            options={API_KEY_BUDGET_AUDIT_EVENT_TYPES.map((eventType) => ({
              value: eventType,
              label: auditEnumLabel(t, 'eventTypes', eventType),
              title: eventType,
            }))}
            selected={filterEventTypes}
            onToggle={setEventTypeChecked}
            headerActions={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFilterEventTypes([...API_KEY_BUDGET_AUDIT_EVENT_TYPES]);
                    setPage(1);
                  }}
                  className="text-blue-600 hover:underline"
                >
                  {tCommon('selectAll')}
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={() => {
                    setFilterEventTypes([...DEFAULT_AUDIT_LOG_EVENT_TYPES]);
                    setPage(1);
                  }}
                  className="text-blue-600 hover:underline"
                >
                  {t('filters.defaultEventTypes')}
                </button>
              </div>
            }
          />
          <MultiSelectDropdown
            label={t('filters.source')}
            options={API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS.map((source) => ({
              value: source,
              label: auditEnumLabel(t, 'sourceChannels', source),
              title: source,
            }))}
            selected={filterSources}
            onToggle={setSourceChecked}
            headerActions={
              <button
                type="button"
                onClick={() => {
                  setFilterSources([...DEFAULT_AUDIT_LOG_SOURCE_CHANNELS]);
                  setPage(1);
                }}
                className="text-blue-600 hover:underline"
              >
                {tCommon('selectAll')}
              </button>
            }
          />
          <MultiSelectDropdown
            label={t('filters.reasonCode')}
            options={reasonCodeOptions.map((reasonCode) => ({
              value: reasonCode,
              label: reasonCode,
              mono: true,
            }))}
            selected={filterReasonCodes}
            onToggle={setReasonCodeChecked}
            emptyText={t('filters.noReasonCodes')}
            headerActions={
              <button
                type="button"
                onClick={() => {
                  setFilterReasonCodes([...reasonCodeOptions]);
                  setPage(1);
                }}
                className="text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"
                disabled={reasonCodeOptions.length === 0}
              >
                {tCommon('selectAll')}
              </button>
            }
          />
          <MultiSelectDropdown
            label={t('filters.actor')}
            options={API_KEY_BUDGET_AUDIT_ACTOR_TYPES.map((actorType) => ({
              value: actorType,
              label: auditEnumLabel(t, 'actorTypes', actorType),
              title: actorType,
            }))}
            selected={filterActorTypes}
            onToggle={setActorTypeChecked}
            align="end"
            headerActions={
              <button
                type="button"
                onClick={() => {
                  setFilterActorTypes([...DEFAULT_AUDIT_LOG_ACTOR_TYPES]);
                  setPage(1);
                }}
                className="text-blue-600 hover:underline"
              >
                {tCommon('selectAll')}
              </button>
            }
          />
          <MultiSelectDropdown
            label={t('filters.actorKind')}
            options={AUDIT_LOG_ACTOR_KIND_FILTERS.map((actorKind) => ({
              value: actorKind,
              label: auditEnumLabel(t, 'actorKinds', actorKind),
              title: actorKind,
            }))}
            selected={filterActorKinds}
            onToggle={setActorKindChecked}
            align="end"
            headerActions={
              <button
                type="button"
                onClick={() => {
                  setFilterActorKinds([...AUDIT_LOG_ACTOR_KIND_FILTERS]);
                  setPage(1);
                }}
                className="text-blue-600 hover:underline"
              >
                {tCommon('selectAll')}
              </button>
            }
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_minmax(12rem,1fr)_minmax(14rem,1fr)_auto]">
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t('filters.actorId')}</label>
            <input
              type="text"
              value={filterActorId}
              onChange={(e) => { setFilterActorId(e.target.value); setPage(1); }}
              placeholder={t('filters.actorIdPlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t('filters.userEmail')}</label>
            <input
              type="text"
              value={filterUserEmail}
              onChange={(e) => { setFilterUserEmail(e.target.value); setPage(1); }}
              placeholder={t('filters.exactMatch')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t('filters.correlationId')}</label>
            <input
              type="text"
              value={filterCorrelationId}
              onChange={(e) => { setFilterCorrelationId(e.target.value); setPage(1); }}
              placeholder={t('filters.correlationPlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setFilterEventTypes([...DEFAULT_AUDIT_LOG_EVENT_TYPES]);
                setFilterActorTypes([...DEFAULT_AUDIT_LOG_ACTOR_TYPES]);
                setFilterActorKinds([...AUDIT_LOG_ACTOR_KIND_FILTERS]);
                setFilterActorId('');
                setFilterReasonCodes([...reasonCodeOptions]);
                setFilterSources([...DEFAULT_AUDIT_LOG_SOURCE_CHANNELS]);
                setFilterCorrelationId('');
                setFilterUserEmail('');
                setFilterUserId('');
                setFilterApiKeyId('');
                setRangeValue({ preset: 'custom', start_date: '', end_date: '' });
                setPage(1);
              }}
              className="h-10 whitespace-nowrap px-4 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
            >
              {tCommon('clearFiltersLower')}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-3 text-sm text-gray-500">
        {t('totalRecords', { count: total })}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-600">{tCommon('loading')}</div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{t('table.time')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap min-w-[11rem] max-w-[15rem]">{t('table.event')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap min-w-[8.5rem] max-w-[12rem]">{t('table.actor')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap min-w-[14rem]">{t('table.identity')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase min-w-[14rem]">{t('table.budget')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase min-w-[12rem]">{t('table.periodPlan')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase min-w-[14rem]">{t('table.wallet')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase min-w-[16rem]">
                    {t('table.userChangeDetail')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  logs.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <AuditLogSharedCells
                        item={item}
                        currency={billingCurrency}
                        timezone={businessTimezone}
                        onViewDetail={setDetailLog}
                      />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailLog ? (
        <AuditChangeDetailModal
          item={detailLog}
          timezone={businessTimezone}
          onClose={() => setDetailLog(null)}
        />
      ) : null}

      {totalPages > 1 && !isLoading && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            {tCommon('previous')}
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            {tCommon('pageOf', { page, totalPages })}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            {tCommon('next')}
          </button>
        </div>
      )}
    </div>
  );
}
