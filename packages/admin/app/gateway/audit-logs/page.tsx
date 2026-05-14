'use client';

/**
 * 全站用户审计日志（`user_audit_logs`）：筛选、分页；数据来自 `/api/admin/budget-audit-logs`。
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { readApiJson } from '@/lib/api-json';
import {
  API_KEY_BUDGET_AUDIT_ACTOR_TYPES,
  API_KEY_BUDGET_AUDIT_EVENT_TYPES,
  type GatewayApiKeyBudgetAuditLog,
} from '@/lib/types';
import { GatewayTimeRangeFilter } from '@/components/GatewayTimeRangePicker';
import { rangeToParams } from '@/lib/analytics-range';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode, formatGatewayMoneyCodeSigned } from '@/lib/format-gateway-currency';
import { GATEWAY_MONEY_DECIMAL_PLACES } from '@/lib/gateway-money';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { summarizeUserSnapshotDiffLines } from '@/lib/audit-user-snapshot-diff';

function formatSignedMoney(value: number, currency: string): string {
  return formatGatewayMoneyCodeSigned(value, currency, GATEWAY_MONEY_DECIMAL_PLACES);
}

function formatPlainMoney(value: number, currency: string): string {
  return formatGatewayMoneyCode(value, currency, GATEWAY_MONEY_DECIMAL_PLACES);
}

function formatBudgetMax(value: number | null, currency: string): string {
  if (value == null) return 'no limit';
  return formatGatewayMoneyCode(value, currency, GATEWAY_MONEY_DECIMAL_PLACES);
}

function formatTime(iso: string | null | undefined): string {
  if (iso == null || iso === '') return '—';
  return formatGatewayDateTime(iso);
}

function shortId(id: string | null | undefined): string {
  if (id == null || id === '') return '—';
  if (id.length < 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** 折叠进 `metadata` 的扩展字段（与 `@octafuse/core` `mergeUserAuditMetadata` 对齐） */
function auditDisplayExtras(item: GatewayApiKeyBudgetAuditLog) {
  let m: Record<string, unknown> = {};
  try {
    if (item.metadata) m = JSON.parse(item.metadata) as Record<string, unknown>;
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

function formatAuditMetadataValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isAuditObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pushAuditChangeLine(lines: string[], label: string, value: unknown): boolean {
  if (!isAuditObject(value) || !('from' in value) || !('to' in value)) return false;
  lines.push(`${label}: ${formatAuditMetadataValue(value.from)} → ${formatAuditMetadataValue(value.to)}`);
  return true;
}

function summarizeAuditMetadataChanges(raw: string | null | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return ['—'];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isAuditObject(parsed)) {
      return [formatAuditMetadataValue(parsed)];
    }

    const obj = parsed as Record<string, unknown>;
    const lines: string[] = [];
    const status = obj.status;
    if (status && typeof status === 'object' && !Array.isArray(status)) {
      const s = status as Record<string, unknown>;
      lines.push(`status: ${formatAuditMetadataValue(s.from)} → ${formatAuditMetadataValue(s.to)}`);
    }

    const metadata = obj.metadata;
    if (isAuditObject(metadata)) {
      const operation = typeof metadata.operation === 'string' ? ` (${metadata.operation})` : '';
      const changes = metadata.changes;
      if (isAuditObject(changes)) {
        Object.entries(changes).forEach(([key, value]) => {
          if (!pushAuditChangeLine(lines, `metadata.${key}`, value)) {
            lines.push(`metadata.${key}: ${formatAuditMetadataValue(value)}`);
          }
        });
      } else if (!pushAuditChangeLine(lines, `metadata${operation}`, metadata)) {
        lines.push(`metadata${operation}: ${formatAuditMetadataValue(metadata)}`);
      }
    }

    const patchKeys = obj.metadata_patch_keys;
    if (!metadata && Array.isArray(patchKeys) && patchKeys.length > 0) {
      const keys = patchKeys.map((k) => formatAuditMetadataValue(k)).join(', ');
      lines.push(`metadata: ${keys}`);
    }

    Object.entries(obj).forEach(([key, value]) => {
      if (key === 'status' || key === 'metadata' || key === 'metadata_patch_keys') return;
      lines.push(`${key}: ${formatAuditMetadataValue(value)}`);
    });

    return lines.length > 0 ? lines : [trimmed];
  } catch {
    return [trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed];
  }
}

/** `metadata` 非空时的补充展示（无快照旧行、密钥侧 JSON 等）；与快照 diff 合并到同一列。 */
function extraMetadataDisplayLines(raw: string | null | undefined): string[] {
  if (raw == null || raw.trim() === '') return [];
  return summarizeAuditMetadataChanges(raw).filter((l) => l !== '—');
}

/** 与网关金额精度一致，用于判断 budget_max 是否变化 */
function budgetMaxSemanticallyEqual(
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

export default function GatewayAuditLogsPage() {
  const [logs, setLogs] = useState<GatewayApiKeyBudgetAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const pageSize = 50;
  const { currency: billingCurrency } = useBillingCurrency();

  const [filterApiKeyId, setFilterApiKeyId] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterUserEmail, setFilterUserEmail] = useState('');
  const [filterEventType, setFilterEventType] = useState('');
  const [filterActorType, setFilterActorType] = useState('');
  const [filterReasonCode, setFilterReasonCode] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterCorrelationId, setFilterCorrelationId] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const apiKeyId = params.get('api_key_id');
    const userId = params.get('user_id');
    const userEmail = params.get('user_email');
    const eventType = params.get('event_type');
    const actorType = params.get('actor_type');
    const reasonCode = params.get('reason_code');
    const source = params.get('source');
    const correlationId = params.get('correlation_id');
    const startDate = params.get('start_date');
    const endDate = params.get('end_date');
    const p = params.get('page');
    if (apiKeyId != null) setFilterApiKeyId(apiKeyId);
    if (userId != null) setFilterUserId(userId);
    if (userEmail != null) setFilterUserEmail(userEmail);
    if (eventType != null) setFilterEventType(eventType);
    if (actorType != null) setFilterActorType(actorType);
    if (reasonCode != null) setFilterReasonCode(reasonCode);
    if (source != null) setFilterSource(source);
    if (correlationId != null) setFilterCorrelationId(correlationId);
    if (startDate != null) setFilterStartDate(startDate);
    if (endDate != null) setFilterEndDate(endDate);
    const hasStart = startDate != null && startDate !== '';
    const hasEnd = endDate != null && endDate !== '';
    if (!hasStart && !hasEnd) {
      const { start_date, end_date } = rangeToParams('1d');
      setFilterStartDate(start_date);
      setFilterEndDate(end_date);
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
      if (filterEventType) params.append('event_type', filterEventType);
      if (filterActorType) params.append('actor_type', filterActorType);
      if (filterReasonCode) params.append('reason_code', filterReasonCode);
      if (filterSource) params.append('source', filterSource);
      if (filterCorrelationId) params.append('correlation_id', filterCorrelationId);
      if (filterStartDate) params.append('start_date', filterStartDate);
      if (filterEndDate) params.append('end_date', filterEndDate);
      return params;
    },
    [
      page,
      pageSize,
      filterApiKeyId,
      filterUserId,
      filterUserEmail,
      filterEventType,
      filterActorType,
      filterReasonCode,
      filterSource,
      filterCorrelationId,
      filterStartDate,
      filterEndDate,
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
      if (filterEventType) params.append('event_type', filterEventType);
      if (filterActorType) params.append('actor_type', filterActorType);
      if (filterReasonCode) params.append('reason_code', filterReasonCode);
      if (filterSource) params.append('source', filterSource);
      if (filterCorrelationId) params.append('correlation_id', filterCorrelationId);
      if (filterStartDate) params.append('start_date', filterStartDate);
      if (filterEndDate) params.append('end_date', filterEndDate);

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
    filterEventType,
    filterActorType,
    filterReasonCode,
    filterSource,
    filterCorrelationId,
    filterStartDate,
    filterEndDate,
    pageSize,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Audit Logs</h1>
        <p className="text-sm text-gray-500 mt-1">
          User audit trail (<code className="text-xs bg-gray-100 px-1 rounded">user_audit_logs</code>) — budget columns plus one
          column for <span className="text-gray-600">user row snapshot Δ</span>
          {'; '}
          <span className="text-gray-600">legacy / extra JSON</span> from <code className="text-xs bg-gray-100 px-1 rounded">metadata</code> is
          appended below when present (no separate Metadata column).
        </p>
      </div>

      <div className="mb-4 w-full min-w-0">
        <label className="block text-sm text-gray-500 mb-1">Time range (UTC)</label>
        <GatewayTimeRangeFilter
          startDate={filterStartDate}
          endDate={filterEndDate}
          onCommit={(start_date, end_date) => {
            setFilterStartDate(start_date);
            setFilterEndDate(end_date);
            setPage(1);
          }}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-4">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Event type</label>
          <select
            value={filterEventType}
            onChange={(e) => { setFilterEventType(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[11rem]"
          >
            <option value="">All</option>
            {API_KEY_BUDGET_AUDIT_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Actor</label>
          <select
            value={filterActorType}
            onChange={(e) => { setFilterActorType(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[8rem]"
          >
            <option value="">All</option>
            {API_KEY_BUDGET_AUDIT_ACTOR_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">User ID</label>
          <input
            type="text"
            value={filterUserId}
            onChange={(e) => { setFilterUserId(e.target.value); setPage(1); }}
            placeholder="Gateway users.id (uuid)"
            className="px-3 py-2 border border-gray-300 rounded-md text-sm w-72 font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">User email</label>
          <input
            type="text"
            value={filterUserEmail}
            onChange={(e) => { setFilterUserEmail(e.target.value); setPage(1); }}
            placeholder="Exact match"
            className="px-3 py-2 border border-gray-300 rounded-md text-sm w-56"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">API key ID</label>
          <input
            type="text"
            value={filterApiKeyId}
            onChange={(e) => { setFilterApiKeyId(e.target.value); setPage(1); }}
            placeholder="UUID"
            className="px-3 py-2 border border-gray-300 rounded-md w-64 font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Reason code</label>
          <input
            type="text"
            value={filterReasonCode}
            onChange={(e) => { setFilterReasonCode(e.target.value); setPage(1); }}
            placeholder="e.g. request_usage_charged_cost"
            className="px-3 py-2 border border-gray-300 rounded-md text-sm w-56 font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Source</label>
          <input
            type="text"
            value={filterSource}
            onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
            placeholder="usage_charge, period_reset…"
            className="px-3 py-2 border border-gray-300 rounded-md text-sm w-44 font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Correlation ID</label>
          <input
            type="text"
            value={filterCorrelationId}
            onChange={(e) => { setFilterCorrelationId(e.target.value); setPage(1); }}
            placeholder="request_log_id / 业务单号"
            className="px-3 py-2 border border-gray-300 rounded-md text-sm w-64 font-mono text-xs"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              setFilterEventType('');
              setFilterActorType('');
              setFilterReasonCode('');
              setFilterSource('');
              setFilterCorrelationId('');
              setFilterUserEmail('');
              setFilterUserId('');
              setFilterApiKeyId('');
              setFilterStartDate('');
              setFilterEndDate('');
              setPage(1);
            }}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className="mb-3 text-sm text-gray-500">
        Total: {total} records
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-600">Loading...</div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap min-w-[11rem]">Event / Actor</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap min-w-[12rem]">User / Key</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Spend</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase min-w-[14rem]">Budget plan</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase min-w-[16rem]">
                    User change detail
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No audit logs match the filters.
                    </td>
                  </tr>
                ) : (
                  logs.map((item) => {
                    const ex = auditDisplayExtras(item);
                    const maxChanged = !budgetMaxSemanticallyEqual(
                      item.before_budget_max,
                      item.after_budget_max
                    );
                    const periodChanged =
                      (ex.before_budget_period ?? '') !== (ex.after_budget_period ?? '');
                    const resetChanged = !budgetResetAtSemanticallyEqual(
                      ex.before_budget_reset_at,
                      ex.after_budget_reset_at
                    );
                    const reason = ex.reason_text || ex.reason_code || '—';
                    const snapLines = summarizeUserSnapshotDiffLines({
                      before_user_snapshot: item.before_user_snapshot ?? null,
                      after_user_snapshot: item.after_user_snapshot ?? null,
                      changed_fields: item.changed_fields ?? null,
                    });
                    const metaExtraLines = extraMetadataDisplayLines(item.metadata);
                    return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 align-top">
                        <div className="text-gray-700 whitespace-nowrap">{formatTime(item.created_at)}</div>
                        <div
                          className="mt-0.5 font-mono text-xs text-gray-600 whitespace-nowrap"
                          title={item.request_log_id || undefined}
                        >
                          req: {item.request_log_id ? shortId(item.request_log_id) : '—'}
                        </div>
                        {ex.correlation_id ? (
                          <div
                            className="mt-0.5 font-mono text-xs text-gray-500 whitespace-nowrap"
                            title={ex.correlation_id}
                          >
                            corr: {shortId(ex.correlation_id)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="text-sm text-gray-900 font-medium leading-snug">{item.event_type}</div>
                        <div className="mt-0.5 text-xs text-gray-500 leading-snug">
                          {item.actor_type}
                          {ex.actor_id ? ` (${shortId(ex.actor_id)})` : ''}
                        </div>
                        <div className="mt-1 text-xs text-gray-600 line-clamp-2 leading-snug" title={reason}>
                          {reason}
                        </div>
                        {ex.source ? (
                          <div className="mt-1 font-mono text-[11px] text-violet-700" title={ex.source}>
                            {ex.source}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top min-w-0 max-w-[18rem]">
                        <div className="text-sm text-gray-900 truncate leading-snug" title={item.user_email || ''}>
                          {item.user_email || '—'}
                        </div>
                        <Link
                          href={`/gateway/users/${encodeURIComponent(item.user_id)}`}
                          className="mt-0.5 block font-mono text-xs text-blue-600 hover:underline truncate"
                          title={item.user_id}
                        >
                          {shortId(item.user_id)}
                        </Link>
                        <div className="mt-0.5 font-mono text-xs text-gray-500 truncate leading-snug" title={item.api_key_id ?? ''}>
                          key: {item.api_key_id ? shortId(item.api_key_id) : '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-600">
                        <div className="space-y-1 leading-snug">
                          <div className="grid grid-cols-[3rem_1fr] gap-x-2 items-baseline">
                            <span className="text-right font-medium text-gray-700">before</span>
                            <span>{formatPlainMoney(item.before_spent, billingCurrency)}</span>
                          </div>
                          <div className="grid grid-cols-[3rem_1fr] gap-x-2 items-baseline">
                            <span className="text-right font-medium text-gray-700">after</span>
                            <span>{formatPlainMoney(item.after_spent, billingCurrency)}</span>
                          </div>
                          <div className="grid grid-cols-[3rem_1fr] gap-x-2 items-baseline">
                            <span className="text-right font-medium text-gray-700">delta</span>
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
                            <span className="font-medium text-gray-700">budget_max:</span>{' '}
                            <span className={maxChanged ? budgetPlanHighlight.before : undefined}>
                              {formatBudgetMax(item.before_budget_max, billingCurrency)}
                            </span>
                            <span className="text-gray-400"> → </span>
                            <span className={maxChanged ? budgetPlanHighlight.after : undefined}>
                              {formatBudgetMax(item.after_budget_max, billingCurrency)}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">budget_period:</span>{' '}
                            <span className={periodChanged ? budgetPlanHighlight.before : undefined}>
                              {ex.before_budget_period ?? '—'}
                            </span>
                            <span className="text-gray-400"> → </span>
                            <span className={periodChanged ? budgetPlanHighlight.after : undefined}>
                              {ex.after_budget_period ?? '—'}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">budget_reset_at:</span>{' '}
                            <span className="whitespace-nowrap">
                              <span className={resetChanged ? budgetPlanHighlight.before : undefined}>
                                {formatTime(ex.before_budget_reset_at)}
                              </span>
                              <span className="text-gray-400"> → </span>
                              <span className={resetChanged ? budgetPlanHighlight.after : undefined}>
                                {formatTime(ex.after_budget_reset_at)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600 min-w-[14rem] max-w-lg align-top">
                        <div className="space-y-1 text-xs leading-snug">
                          {snapLines.length > 0 ? (
                            <>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                                User snapshot
                              </div>
                              {snapLines.slice(0, 6).map((line, index) => (
                                <div key={`${item.id}-snap-${index}`} className="line-clamp-2 font-mono" title={line}>
                                  {line}
                                </div>
                              ))}
                              {snapLines.length > 6 ? (
                                <div className="text-gray-400">+{snapLines.length - 6} more</div>
                              ) : null}
                            </>
                          ) : null}
                          {metaExtraLines.length > 0 ? (
                            <div className={snapLines.length > 0 ? 'mt-2 pt-2 border-t border-gray-100' : ''}>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                                Extra (metadata JSON)
                              </div>
                              {metaExtraLines.slice(0, 5).map((line, index) => (
                                <div key={`${item.id}-meta-${index}`} className="line-clamp-2" title={line}>
                                  {line}
                                </div>
                              ))}
                              {metaExtraLines.length > 5 ? (
                                <div className="text-gray-400">+{metaExtraLines.length - 5} more</div>
                              ) : null}
                            </div>
                          ) : null}
                          {snapLines.length === 0 && metaExtraLines.length === 0 ? (
                            <span className="text-gray-400">—</span>
                          ) : null}
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

      {totalPages > 1 && !isLoading && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
