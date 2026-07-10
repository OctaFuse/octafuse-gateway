'use client';

/**
 * 全站用户审计日志（`user_audit_logs`）：筛选、分页；数据来自 `/api/admin/budget-audit-logs`。
 */
import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { readApiJson } from '@/lib/api-json';
import {
  API_KEY_BUDGET_AUDIT_ACTOR_TYPES,
  API_KEY_BUDGET_AUDIT_EVENT_TYPES,
  type GatewayApiKeyBudgetAuditLog,
} from '@/lib/types';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { createRangeValue, detectRollingPreset, type GatewayTimeRangeValue } from '@/lib/analytics-range';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode, formatGatewayMoneyCodeSigned } from '@/lib/format-gateway-currency';
import { GATEWAY_MONEY_DECIMAL_PLACES } from '@/lib/gateway-money';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

/** 已在 Spend / Budget plan 列展示的快照字段，不在「User change detail」重复 */
const OMIT_AUDIT_LOG_SNAPSHOT_FIELDS = [
	'budget_spent',
	'budget_max',
	'budget_base',
	'budget_period',
	'budget_reset_at',
] as const;

const DEFAULT_AUDIT_LOG_EVENT_TYPES = API_KEY_BUDGET_AUDIT_EVENT_TYPES.filter((type) => type !== 'usage_charge');
const AUDIT_LOG_EVENT_TYPE_SET = new Set<string>(API_KEY_BUDGET_AUDIT_EVENT_TYPES);
const DEFAULT_AUDIT_LOG_ACTOR_TYPES = [...API_KEY_BUDGET_AUDIT_ACTOR_TYPES];
const AUDIT_LOG_ACTOR_TYPE_SET = new Set<string>(API_KEY_BUDGET_AUDIT_ACTOR_TYPES);

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

function appendAuditEventTypeParams(params: URLSearchParams, eventTypes: string[]): void {
  eventTypes.forEach((eventType) => params.append('event_type', eventType));
}

function appendAuditActorTypeParams(params: URLSearchParams, actorTypes: string[]): void {
  if (actorTypes.length === DEFAULT_AUDIT_LOG_ACTOR_TYPES.length) return;
  actorTypes.forEach((actorType) => params.append('actor_type', actorType));
}

/** change_payload 展开行：去掉已由 Budget plan / Time / Event 列展示的键 */
function shouldOmitChangePayloadDisplayLine(line: string): boolean {
	const colon = line.indexOf(':');
	const key = (colon === -1 ? line : line.slice(0, colon)).trim();
	if (!key) return false;
	if (key.startsWith('before_budget_') || key.startsWith('after_budget_')) return true;
	if (['actor_id', 'reason_code', 'reason_text', 'source', 'correlation_id'].includes(key)) return true;
	return false;
}

function formatSignedMoney(value: number, currency: string): string {
  return formatGatewayMoneyCodeSigned(value, currency, GATEWAY_MONEY_DECIMAL_PLACES);
}

function formatPlainMoney(value: number, currency: string): string {
  return formatGatewayMoneyCode(value, currency, GATEWAY_MONEY_DECIMAL_PLACES);
}

function formatBudgetMax(value: number | null, currency: string, noLimitLabel = 'no limit'): string {
  if (value == null) return noLimitLabel;
  return formatGatewayMoneyCode(value, currency, GATEWAY_MONEY_DECIMAL_PLACES);
}

function formatAuditTime(iso: string | null | undefined, timeZone: string): string {
  if (iso == null || iso === '') return '—';
  return formatGatewayDateTime(iso, timeZone);
}

function shortId(id: string | null | undefined): string {
  if (id == null || id === '') return '—';
  if (id.length < 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** Reason 行：code / text 并存且不同时压缩为一行「code · text」，否则单行。 */
function auditReasonOneLine(reasonCode: string | null | undefined, reasonText: string | null | undefined): {
	line: string;
	isMono: boolean;
	title: string;
} {
	const rc = (reasonCode ?? '').trim();
	const rt = (reasonText ?? '').trim();
	if (!rc && !rt) return { line: '—', isMono: true, title: '' };
	if (rc && rt && rc !== rt) {
		const line = `${rc} · ${rt}`;
		return { line, isMono: false, title: line };
	}
	const single = rt || rc;
	return { line: single, isMono: !!rc && !rt, title: single };
}

/** 从 `change_payload` 解析的扩展字段（与 `@octafuse/core` `mergeUserAuditChangePayload` 写入结构对齐） */
function auditDisplayExtras(item: GatewayApiKeyBudgetAuditLog) {
  let m: Record<string, unknown> = {};
  try {
    const raw = item.change_payload;
    if (raw) m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* keep empty */
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    reason_text: item.reason_text ?? str(m.reason_text),
    reason_code: item.reason_code ?? str(m.reason_code),
    actor_id: item.actor_id ?? str(m.actor_id),
    source: item.source ?? str(m.source),
    correlation_id: item.correlation_id ?? str(m.correlation_id),
    before_budget_period: item.before_budget_period ?? str(m.before_budget_period),
    after_budget_period: item.after_budget_period ?? str(m.after_budget_period),
    before_budget_reset_at: item.before_budget_reset_at ?? str(m.before_budget_reset_at),
    after_budget_reset_at: item.after_budget_reset_at ?? str(m.after_budget_reset_at),
  };
}

function isAuditObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** 与网关金额精度一致，用于判断 budget_max / budget_base 是否变化 */
function budgetMoneySemanticallyEqual(
  before: number | null | undefined,
  after: number | null | undefined
): boolean {
  if (before == null && after == null) return true;
  if (before == null || after == null) return false;
  return before.toFixed(GATEWAY_MONEY_DECIMAL_PLACES) === after.toFixed(GATEWAY_MONEY_DECIMAL_PLACES);
}

function budgetResetAtSemanticallyEqual(
  before: string | null | undefined,
  after: string | null | undefined
): boolean {
  if ((before == null || before === '') && (after == null || after === '')) return true;
  if (!before || !after) return false;
  const tb = new Date(before).getTime();
  const ta = new Date(after).getTime();
  if (Number.isNaN(tb) || Number.isNaN(ta)) return before === after;
  return tb === ta;
}

const budgetPlanHighlight = {
  before: 'rounded px-0.5 bg-amber-50 text-amber-900',
  after: 'rounded px-0.5 bg-sky-50 text-sky-900',
} as const;

type AuditDiffRow = {
  group: 'snapshot' | 'payload';
  field: string;
  before: string;
  after: string;
};

function parseAuditJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isAuditObject(parsed)) return parsed;
  } catch {
    /* keep null */
  }
  return null;
}

function parseAuditChangedFields(raw: string | null | undefined): string[] | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return null;
  }
}

function formatAuditDiffValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pushAuditDiffRow(rows: AuditDiffRow[], group: AuditDiffRow['group'], field: string, before: unknown, after: unknown) {
  const beforeText = formatAuditDiffValue(before);
  const afterText = formatAuditDiffValue(after);
  if (beforeText === afterText) return;
  rows.push({ group, field, before: beforeText, after: afterText });
}

function pushNestedAuditDiffRows(
  rows: AuditDiffRow[],
  group: AuditDiffRow['group'],
  field: string,
  before: unknown,
  after: unknown,
  depth = 0
) {
  if ((isAuditObject(before) || isAuditObject(after)) && depth < 4) {
    const beforeObject = isAuditObject(before) ? before : {};
    const afterObject = isAuditObject(after) ? after : {};
    const keys = Array.from(new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]));
    keys.forEach((key) => {
      pushNestedAuditDiffRows(
        rows,
        group,
        `${field}.${key}`,
        beforeObject[key],
        afterObject[key],
        depth + 1
      );
    });
    return;
  }
  pushAuditDiffRow(rows, group, field, before, after);
}

function appendSnapshotDiffRows(rows: AuditDiffRow[], item: GatewayApiKeyBudgetAuditLog) {
  const before = parseAuditJsonObject(item.before_user_snapshot ?? null);
  const after = parseAuditJsonObject(item.after_user_snapshot ?? null);
  if (!before && !after) return;

  const fields = parseAuditChangedFields(item.changed_fields ?? null);
  const keys =
    fields && fields.length > 0
      ? fields
      : Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).filter((key) => key !== 'id');
  const omitted = new Set<string>(OMIT_AUDIT_LOG_SNAPSHOT_FIELDS);
  keys.forEach((key) => {
    if (omitted.has(key)) return;
    pushNestedAuditDiffRows(rows, 'snapshot', key, before?.[key], after?.[key]);
  });
}

function appendPayloadDiffRows(rows: AuditDiffRow[], raw: string | null | undefined) {
  const payload = parseAuditJsonObject(raw);
  if (!payload) return;

  const handled = new Set<string>();
  const status = payload.status;
  if (isAuditObject(status) && ('from' in status || 'to' in status)) {
    pushAuditDiffRow(rows, 'payload', 'status', status.from, status.to);
    handled.add('status');
  }

  const metadata = payload.metadata;
  if (isAuditObject(metadata)) {
    handled.add('metadata');
    const changes = metadata.changes;
    if (isAuditObject(changes)) {
      Object.entries(changes).forEach(([key, value]) => {
        if (isAuditObject(value) && ('from' in value || 'to' in value)) {
          pushAuditDiffRow(rows, 'payload', `metadata.${key}`, value.from, value.to);
        } else {
          pushAuditDiffRow(rows, 'payload', `metadata.${key}`, '—', value);
        }
      });
    } else if ('from' in metadata || 'to' in metadata) {
      pushAuditDiffRow(rows, 'payload', 'metadata', metadata.from, metadata.to);
      pushNestedAuditDiffRows(rows, 'payload', 'metadata', metadata.from, metadata.to);
    } else {
      Object.entries(metadata).forEach(([key, value]) => {
        if (key === 'operation') return;
        pushAuditDiffRow(rows, 'payload', `metadata.${key}`, '—', value);
      });
    }
  }

  Object.entries(payload).forEach(([key, value]) => {
    if (handled.has(key)) return;
    if (key.startsWith('before_') || key.startsWith('after_')) return;
    if (key === 'metadata_patch_keys' || shouldOmitChangePayloadDisplayLine(`${key}:`)) return;
    if (isAuditObject(value) && ('from' in value || 'to' in value)) {
      pushAuditDiffRow(rows, 'payload', key, value.from, value.to);
    }
  });

  Object.keys(payload)
    .filter((key) => key.startsWith('before_'))
    .forEach((beforeKey) => {
      const suffix = beforeKey.slice('before_'.length);
      const afterKey = `after_${suffix}`;
      if (!(afterKey in payload)) return;
      if (shouldOmitChangePayloadDisplayLine(beforeKey) || shouldOmitChangePayloadDisplayLine(afterKey)) return;
      pushAuditDiffRow(rows, 'payload', suffix, payload[beforeKey], payload[afterKey]);
    });
}

function auditDiffRows(item: GatewayApiKeyBudgetAuditLog): AuditDiffRow[] {
  const rows: AuditDiffRow[] = [];
  appendSnapshotDiffRows(rows, item);
  appendPayloadDiffRows(rows, item.change_payload);
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.field}:${row.before}:${row.after}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSerializedAuditObject(value: string): boolean {
  return isAuditObject(parseAuditJsonObject(value));
}

function auditSummaryDiffRows(rows: AuditDiffRow[]): AuditDiffRow[] {
  return rows.filter((row) => {
    if (row.field === 'metadata') return false;
    if (isSerializedAuditObject(row.before) || isSerializedAuditObject(row.after)) return false;
    return true;
  });
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
  const [filterReasonCode, setFilterReasonCode] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterCorrelationId, setFilterCorrelationId] = useState('');
  const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue('1d'));
  const [detailLog, setDetailLog] = useState<GatewayApiKeyBudgetAuditLog | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const apiKeyId = params.get('api_key_id');
    const userId = params.get('user_id');
    const userEmail = params.get('user_email');
    const eventTypes = normalizeAuditEventTypes(params.getAll('event_type'));
    const actorTypes = normalizeAuditActorTypes(params.getAll('actor_type'));
    const reasonCode = params.get('reason_code');
    const source = params.get('source');
    const correlationId = params.get('correlation_id');
    const startDate = params.get('start_date');
    const endDate = params.get('end_date');
    const p = params.get('page');
    if (apiKeyId != null) setFilterApiKeyId(apiKeyId);
    if (userId != null) setFilterUserId(userId);
    if (userEmail != null) setFilterUserEmail(userEmail);
    if (eventTypes.length > 0) setFilterEventTypes(eventTypes);
    if (actorTypes.length > 0) setFilterActorTypes(actorTypes);
    if (reasonCode != null) setFilterReasonCode(reasonCode);
    if (source != null) setFilterSource(source);
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
      setRangeValue(createRangeValue('1d'));
    }
    if (p != null) {
      const n = parseInt(p, 10);
      if (!Number.isNaN(n) && n >= 1) setPage(n);
    }
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
      appendAuditEventTypeParams(params, filterEventTypes);
      appendAuditActorTypeParams(params, filterActorTypes);
      if (filterReasonCode) params.append('reason_code', filterReasonCode);
      if (filterSource) params.append('source', filterSource);
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
      filterReasonCode,
      filterSource,
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
      appendAuditEventTypeParams(params, filterEventTypes);
      appendAuditActorTypeParams(params, filterActorTypes);
      if (filterReasonCode) params.append('reason_code', filterReasonCode);
      if (filterSource) params.append('source', filterSource);
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
    filterReasonCode,
    filterSource,
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
  const detailRows = detailLog ? auditDiffRows(detailLog) : [];

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
        <div className="grid gap-4 xl:grid-cols-[minmax(28rem,1.5fr)_minmax(18rem,0.8fr)]">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-gray-600">{t('filters.eventType')}</label>
              <div className="flex shrink-0 items-center gap-2 text-xs">
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
                <span className="text-gray-500">{tCommon('selected', { count: filterEventTypes.length })}</span>
              </div>
            </div>
            <div className="flex min-h-12 flex-wrap gap-2 rounded-md border border-gray-300 bg-gray-50/60 p-2">
              {API_KEY_BUDGET_AUDIT_EVENT_TYPES.map((eventType) => {
                const checked = filterEventTypes.includes(eventType);
                return (
                  <label
                    key={eventType}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                      checked ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={checked && filterEventTypes.length === 1}
                      onChange={(e) => setEventTypeChecked(eventType, e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-mono">{eventType}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-gray-600">{t('filters.actor')}</label>
              <div className="flex shrink-0 items-center gap-2 text-xs">
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
                <span className="text-gray-500">{tCommon('selected', { count: filterActorTypes.length })}</span>
              </div>
            </div>
            <div className="flex min-h-12 flex-wrap gap-2 rounded-md border border-gray-300 bg-gray-50/60 p-2">
              {API_KEY_BUDGET_AUDIT_ACTOR_TYPES.map((actorType) => {
                const checked = filterActorTypes.includes(actorType);
                return (
                  <label
                    key={actorType}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                      checked ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={checked && filterActorTypes.length === 1}
                      onChange={(e) => setActorTypeChecked(actorType, e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-mono">{actorType}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_minmax(12rem,0.9fr)_minmax(14rem,1fr)_auto]">
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
            <label className="block text-sm text-gray-500 mb-1">{t('filters.reasonCode')}</label>
            <input
              type="text"
              value={filterReasonCode}
              onChange={(e) => { setFilterReasonCode(e.target.value); setPage(1); }}
              placeholder={t('filters.reasonPlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t('filters.source')}</label>
            <input
              type="text"
              value={filterSource}
              onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
              placeholder={t('filters.sourcePlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
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
                setFilterReasonCode('');
                setFilterSource('');
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
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{t('table.spend')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase min-w-[14rem]">{t('table.budgetPlan')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase min-w-[16rem]">
                    {t('table.userChangeDetail')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  logs.map((item) => {
                    const ex = auditDisplayExtras(item);
                    const maxChanged = !budgetMoneySemanticallyEqual(
                      item.before_budget_max,
                      item.after_budget_max
                    );
                    const baseChanged = !budgetMoneySemanticallyEqual(
                      item.before_budget_base,
                      item.after_budget_base
                    );
                    const periodChanged =
                      (ex.before_budget_period ?? '') !== (ex.after_budget_period ?? '');
                    const resetChanged = !budgetResetAtSemanticallyEqual(
                      ex.before_budget_reset_at,
                      ex.after_budget_reset_at
                    );
                    const reasonDisplay = auditReasonOneLine(ex.reason_code, ex.reason_text);
                    const diffRows = auditDiffRows(item);
                    const summaryDiffRows = auditSummaryDiffRows(diffRows);
                    return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 align-top">
                        <div className="text-gray-700 whitespace-nowrap">{formatAuditTime(item.created_at, businessTimezone)}</div>
                        <div
                          className="mt-0.5 font-mono text-xs text-gray-600 whitespace-nowrap"
                          title={item.request_log_id || undefined}
                        >
                          {t('labels.req')}: {item.request_log_id ? shortId(item.request_log_id) : '—'}
                        </div>
                        {ex.correlation_id ? (
                          <div
                            className="mt-0.5 font-mono text-xs text-gray-500 whitespace-nowrap"
                            title={ex.correlation_id}
                          >
                            {t('labels.corr')}: {shortId(ex.correlation_id)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top min-w-0 max-w-[15rem]">
                        <div className="text-xs space-y-1.5 leading-snug">
                          <div className="min-w-0">
                            <span className="text-gray-500">{t('labels.type')}</span>
                            <span className="font-mono text-sm font-medium text-gray-900">{item.event_type}</span>
                          </div>
                          <div className="min-w-0 truncate font-mono text-[11px]" title={ex.source || undefined}>
                            <span className="text-gray-500 font-sans">{t('labels.from')}</span>
                            <span className="text-violet-800">{ex.source ?? '—'}</span>
                          </div>
                          <div className="min-w-0 line-clamp-3 text-gray-800" title={reasonDisplay.title || undefined}>
                            <span className="text-gray-500">{t('labels.reason')}</span>
                            <span className={reasonDisplay.isMono ? 'font-mono text-[11px] text-gray-900' : 'text-[11px]'}>
                              {reasonDisplay.line}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top min-w-0 max-w-[12rem]">
                        <div className="text-xs space-y-1.5 leading-snug">
                          <div>
                            <span className="text-gray-500">{t('labels.kind')}</span>
                            <span className="text-sm text-gray-900">{item.actor_type}</span>
                          </div>
                          <div className="min-w-0">
                            <span className="text-gray-500">{t('labels.principal')}</span>
                            {ex.actor_id ? (
                              <span className="font-mono text-[11px] text-gray-700 break-all" title={ex.actor_id}>
                                {shortId(ex.actor_id)}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top min-w-0 max-w-[18rem]">
                        <div className="text-sm text-gray-900 truncate leading-snug" title={item.user_email || ''}>
                          {item.user_email || '—'}
                        </div>
                        {item.user_id ? (
                          <div className="mt-0.5 flex items-baseline gap-1 min-w-0 font-mono text-xs">
                            <span className="shrink-0 text-gray-600">{t('labels.user')}</span>
                            <Link
                              href={`/gateway/users/${encodeURIComponent(item.user_id)}`}
                              className="min-w-0 truncate text-blue-600 hover:underline"
                              title={item.user_id}
                            >
                              {shortId(item.user_id)}
                            </Link>
                          </div>
                        ) : (
                          <div className="mt-0.5 font-mono text-xs text-gray-400 truncate" title={t('userRemovedTitle')}>
                            {t('labels.user')} —
                          </div>
                        )}
                        <div className="mt-0.5 font-mono text-xs text-gray-500 truncate leading-snug" title={item.api_key_id ?? ''}>
                          {t('labels.key')}{item.api_key_id ? shortId(item.api_key_id) : '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-600">
                        <div className="space-y-1 leading-snug">
                          <div className="grid grid-cols-[3rem_1fr] gap-x-2 items-baseline">
                            <span className="text-right font-medium text-gray-700">{t('labels.before')}</span>
                            <span>{formatPlainMoney(item.before_spent, billingCurrency)}</span>
                          </div>
                          <div className="grid grid-cols-[3rem_1fr] gap-x-2 items-baseline">
                            <span className="text-right font-medium text-gray-700">{t('labels.after')}</span>
                            <span>{formatPlainMoney(item.after_spent, billingCurrency)}</span>
                          </div>
                          <div className="grid grid-cols-[3rem_1fr] gap-x-2 items-baseline">
                            <span className="text-right font-medium text-gray-700">{t('labels.delta')}</span>
                            <span
                              className={
                                item.delta_spent > 0
                                  ? 'text-red-600'
                                  : item.delta_spent < 0
                                    ? 'text-green-600'
                                    : 'text-gray-600'
                              }
                            >
                              {formatSignedMoney(item.delta_spent, billingCurrency)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-600">
                        <div className="space-y-1 leading-snug">
                          <div>
                            <span className="font-medium text-gray-700">{t('labels.max')}</span>{' '}
                            <span className={maxChanged ? budgetPlanHighlight.before : undefined}>
                              {formatBudgetMax(item.before_budget_max, billingCurrency)}
                            </span>
                            <span className="text-gray-400"> → </span>
                            <span className={maxChanged ? budgetPlanHighlight.after : undefined}>
                              {formatBudgetMax(item.after_budget_max, billingCurrency)}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">{t('labels.base')}</span>{' '}
                            <span className={baseChanged ? budgetPlanHighlight.before : undefined}>
                              {formatGatewayMoneyCode(item.before_budget_base, billingCurrency, GATEWAY_MONEY_DECIMAL_PLACES)}
                            </span>
                            <span className="text-gray-400"> → </span>
                            <span className={baseChanged ? budgetPlanHighlight.after : undefined}>
                              {formatGatewayMoneyCode(item.after_budget_base, billingCurrency, GATEWAY_MONEY_DECIMAL_PLACES)}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">{t('labels.period')}</span>{' '}
                            <span className={periodChanged ? budgetPlanHighlight.before : undefined}>
                              {ex.before_budget_period ?? '—'}
                            </span>
                            <span className="text-gray-400"> → </span>
                            <span className={periodChanged ? budgetPlanHighlight.after : undefined}>
                              {ex.after_budget_period ?? '—'}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">{t('labels.resetAt')}</span>{' '}
                            <span className="whitespace-nowrap">
                              <span className={resetChanged ? budgetPlanHighlight.before : undefined}>
                                {formatAuditTime(ex.before_budget_reset_at, businessTimezone)}
                              </span>
                              <span className="text-gray-400"> → </span>
                              <span className={resetChanged ? budgetPlanHighlight.after : undefined}>
                                {formatAuditTime(ex.after_budget_reset_at, businessTimezone)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600 min-w-[14rem] max-w-lg align-top">
                        <div className="space-y-1 text-xs leading-snug">
                          {summaryDiffRows.length > 0 ? (
                            <>
                              {summaryDiffRows.slice(0, 3).map((row, index) => (
                                <div key={`${item.id}-diff-${index}`} className="grid grid-cols-[minmax(5rem,8rem)_1fr] gap-x-2">
                                  <span className="truncate font-mono text-gray-700" title={row.field}>
                                    {row.field}
                                  </span>
                                  <span className="min-w-0 truncate" title={`${row.before} → ${row.after}`}>
                                    <span className="text-amber-700">{row.before}</span>
                                    <span className="px-1 text-gray-400">→</span>
                                    <span className="text-sky-700">{row.after}</span>
                                  </span>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => setDetailLog(item)}
                                className="mt-1 text-xs text-blue-600 hover:underline"
                              >
                                {t('labels.viewChangeDetail')}
                                {summaryDiffRows.length > 3 ? ` · ${t('labels.more', { count: summaryDiffRows.length - 3 })}` : ''}
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-gray-400">—</span>
                              {diffRows.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setDetailLog(item)}
                                  className="ml-2 text-xs text-blue-600 hover:underline"
                                >
                                  {t('labels.viewChangeDetail')}
                                </button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailLog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-change-detail-title"
        >
          <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
              <div className="min-w-0">
                <h2 id="audit-change-detail-title" className="text-lg font-semibold text-gray-900">
                  {t('labels.changeDetailTitle')}
                </h2>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span className="font-mono">{detailLog.event_type}</span>
                  <span>{formatAuditTime(detailLog.created_at, businessTimezone)}</span>
                  <span className="truncate">{detailLog.user_email ?? '—'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailLog(null)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                {tCommon('close')}
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {detailRows.length > 0 ? (
                <div className="space-y-3">
                  {detailRows.map((row, index) => (
                    <div key={`${row.group}-${row.field}-${index}`} className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {row.group === 'snapshot' ? t('labels.userSnapshot') : t('labels.extraJson')}
                        </span>
                        <span className="min-w-0 break-all font-mono text-sm font-medium text-gray-900">
                          {row.field}
                        </span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="min-w-0">
                          <div className="mb-1 text-xs font-medium uppercase text-gray-500">{t('labels.originalValue')}</div>
                          <pre className="max-w-full whitespace-pre-wrap break-all rounded bg-amber-50 px-3 py-2 font-mono text-xs leading-relaxed text-amber-900">{row.before}</pre>
                        </div>
                        <div className="min-w-0">
                          <div className="mb-1 text-xs font-medium uppercase text-gray-500">{t('labels.changedValue')}</div>
                          <pre className="max-w-full whitespace-pre-wrap break-all rounded bg-sky-50 px-3 py-2 font-mono text-xs leading-relaxed text-sky-900">{row.after}</pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-gray-500">{t('labels.noChangeDetail')}</div>
              )}
            </div>
          </div>
        </div>
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
