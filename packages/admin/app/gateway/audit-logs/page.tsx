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
import { summarizeUserSnapshotDiffLines } from '@/lib/audit-user-snapshot-diff';

/** 已在 Spend / Budget plan 列展示的快照字段，不在「User change detail」重复 */
const OMIT_AUDIT_LOG_SNAPSHOT_FIELDS = [
	'budget_spent',
	'budget_max',
	'budget_base',
	'budget_period',
	'budget_reset_at',
] as const;

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

/** `change_payload` 非空时的补充展示（与其它列去重后） */
function extraMetadataDisplayLines(raw: string | null | undefined): string[] {
	if (raw == null || raw.trim() === '') return [];
	return summarizeAuditMetadataChanges(raw)
		.filter((l) => l !== '—')
		.filter((l) => !shouldOmitChangePayloadDisplayLine(l));
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
  const [filterEventType, setFilterEventType] = useState('');
  const [filterActorType, setFilterActorType] = useState('');
  const [filterReasonCode, setFilterReasonCode] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterCorrelationId, setFilterCorrelationId] = useState('');
  const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue('1d'));

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
      if (filterEventType) params.append('event_type', filterEventType);
      if (filterActorType) params.append('actor_type', filterActorType);
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
      filterEventType,
      filterActorType,
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
      if (filterEventType) params.append('event_type', filterEventType);
      if (filterActorType) params.append('actor_type', filterActorType);
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
    filterEventType,
    filterActorType,
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

      <div className="mb-4 flex flex-wrap gap-4">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Event type</label>
          <select
            value={filterEventType}
            onChange={(e) => { setFilterEventType(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[11rem]"
          >
            <option value="">{tCommon('all')}</option>
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
            <option value="">{tCommon('all')}</option>
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
            className="px-3 py-2 border border-gray-300 rounded-md w-72 font-mono text-xs"
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
            className="px-3 py-2 border border-gray-300 rounded-md w-56 font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Source</label>
          <input
            type="text"
            value={filterSource}
            onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
            placeholder="usage_charge, period_reset…"
            className="px-3 py-2 border border-gray-300 rounded-md w-44 font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Correlation ID</label>
          <input
            type="text"
            value={filterCorrelationId}
            onChange={(e) => { setFilterCorrelationId(e.target.value); setPage(1); }}
            placeholder="request_log_id / business reference"
            className="px-3 py-2 border border-gray-300 rounded-md w-64 font-mono text-xs"
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
              setRangeValue({ preset: 'custom', start_date: '', end_date: '' });
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
        <div className="flex items-center justify-center py-16 text-gray-600">{tCommon('loading')}</div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap min-w-[11rem] max-w-[15rem]">Event</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap min-w-[8.5rem] max-w-[12rem]">Actor</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap min-w-[14rem]">Email / User / Key</th>
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
                    const snapLines = summarizeUserSnapshotDiffLines({
                      before_user_snapshot: item.before_user_snapshot ?? null,
                      after_user_snapshot: item.after_user_snapshot ?? null,
                      changed_fields: item.changed_fields ?? null,
                      omitSnapshotFields: OMIT_AUDIT_LOG_SNAPSHOT_FIELDS,
                    });
                    const metaExtraLines = extraMetadataDisplayLines(item.change_payload);
                    return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 align-top">
                        <div className="text-gray-700 whitespace-nowrap">{formatAuditTime(item.created_at, businessTimezone)}</div>
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
                      <td className="px-3 py-2 align-top min-w-0 max-w-[15rem]">
                        <div className="text-xs space-y-1.5 leading-snug">
                          <div className="min-w-0">
                            <span className="text-gray-500">Type: </span>
                            <span className="font-mono text-sm font-medium text-gray-900">{item.event_type}</span>
                          </div>
                          <div className="min-w-0 truncate font-mono text-[11px]" title={ex.source || undefined}>
                            <span className="text-gray-500 font-sans">From: </span>
                            <span className="text-violet-800">{ex.source ?? '—'}</span>
                          </div>
                          <div className="min-w-0 line-clamp-3 text-gray-800" title={reasonDisplay.title || undefined}>
                            <span className="text-gray-500">Reason: </span>
                            <span className={reasonDisplay.isMono ? 'font-mono text-[11px] text-gray-900' : 'text-[11px]'}>
                              {reasonDisplay.line}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top min-w-0 max-w-[12rem]">
                        <div className="text-xs space-y-1.5 leading-snug">
                          <div>
                            <span className="text-gray-500">Kind: </span>
                            <span className="text-sm text-gray-900">{item.actor_type}</span>
                          </div>
                          <div className="min-w-0">
                            <span className="text-gray-500">Principal: </span>
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
                            <span className="shrink-0 text-gray-600">User:</span>
                            <Link
                              href={`/gateway/users/${encodeURIComponent(item.user_id)}`}
                              className="min-w-0 truncate text-blue-600 hover:underline"
                              title={item.user_id}
                            >
                              {shortId(item.user_id)}
                            </Link>
                          </div>
                        ) : (
                          <div className="mt-0.5 font-mono text-xs text-gray-400 truncate" title="User removed; see snapshot / change_payload">
                            User: —
                          </div>
                        )}
                        <div className="mt-0.5 font-mono text-xs text-gray-500 truncate leading-snug" title={item.api_key_id ?? ''}>
                          Key: {item.api_key_id ? shortId(item.api_key_id) : '—'}
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
                            <span className="font-medium text-gray-700">max:</span>{' '}
                            <span className={maxChanged ? budgetPlanHighlight.before : undefined}>
                              {formatBudgetMax(item.before_budget_max, billingCurrency)}
                            </span>
                            <span className="text-gray-400"> → </span>
                            <span className={maxChanged ? budgetPlanHighlight.after : undefined}>
                              {formatBudgetMax(item.after_budget_max, billingCurrency)}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">base:</span>{' '}
                            <span className={baseChanged ? budgetPlanHighlight.before : undefined}>
                              {formatGatewayMoneyCode(item.before_budget_base, billingCurrency, GATEWAY_MONEY_DECIMAL_PLACES)}
                            </span>
                            <span className="text-gray-400"> → </span>
                            <span className={baseChanged ? budgetPlanHighlight.after : undefined}>
                              {formatGatewayMoneyCode(item.after_budget_base, billingCurrency, GATEWAY_MONEY_DECIMAL_PLACES)}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">period:</span>{' '}
                            <span className={periodChanged ? budgetPlanHighlight.before : undefined}>
                              {ex.before_budget_period ?? '—'}
                            </span>
                            <span className="text-gray-400"> → </span>
                            <span className={periodChanged ? budgetPlanHighlight.after : undefined}>
                              {ex.after_budget_period ?? '—'}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">reset_at:</span>{' '}
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
                                Extra (change_payload JSON)
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
