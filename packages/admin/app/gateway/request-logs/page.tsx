'use client';

/**
 * 全站请求日志表：多维筛选、分页；Model Route 列展示请求协议、路由分组、模型与供应商路由；展开行为四栏（pricing audit + 三份 JSON）；数据来自 `/api/admin/request-logs`。
 */
import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { readApiJson } from '@/lib/api-json';
import type { GatewayModel, GatewayModelRoute, GatewayProvider, GatewayRequestLog } from '@/lib/types';
import {
  compareRouteGroupsForDisplay,
  normalizeRouteGroup,
  routeGroupBadgeClass,
} from '@/lib/route-group-ui';
import { UPSTREAM_PROTOCOLS } from '@/lib/upstream-protocol';
import { UpstreamProtocolBrandIcon } from '@/components/upstream-brand-logo';
import { GatewayTimeRangeFilter } from '@/components/GatewayTimeRangePicker';
import { rangeToParams } from '@/lib/analytics-range';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode, formatGatewayMoneyCodeSigned, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { summarizePricingAuditJson } from '@/lib/pricing-ui';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';
import { useBillingCurrency } from '@/lib/use-billing-currency';

/** `/api/admin/models` 列表项（tags 解析为数组） */
type ModelListItem = Omit<GatewayModel, 'tags'> & { tags: string[] };

export default function GatewayRequestLogsPage() {
  const [logs, setLogs] = useState<GatewayRequestLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  /** 展开四栏详情：pricing audit / 入口请求体 / 上游请求体 / raw usage */
  const [detailLogId, setDetailLogId] = useState<string | null>(null);
  const [copiedColumn, setCopiedColumn] = useState<'audit' | 'entry' | 'upstream' | 'usage' | null>(null);
  const pageSize = 50;
  const { currency: billingCurrency } = useBillingCurrency();
  const billingCurrencySym = getGatewayCurrencySymbol(billingCurrency);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterUserEmail, setFilterUserEmail] = useState('');
  const [filterApiKeyId, setFilterApiKeyId] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterProviderId, setFilterProviderId] = useState('');
  const [filterRouteGroup, setFilterRouteGroup] = useState('');
  const [filterProtocol, setFilterProtocol] = useState('');

  const [modelCatalog, setModelCatalog] = useState<ModelListItem[]>([]);
  const [providerCatalog, setProviderCatalog] = useState<GatewayProvider[]>([]);
  const [routesCatalog, setRoutesCatalog] = useState<GatewayModelRoute[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mr, pr, rr] = await Promise.all([
          fetch('/api/admin/models'),
          fetch('/api/admin/providers'),
          fetch('/api/admin/routes'),
        ]);
        const [md, pd, rd] = await Promise.all([
          readApiJson<ModelListItem[]>(mr),
          readApiJson<GatewayProvider[]>(pr),
          readApiJson<GatewayModelRoute[]>(rr),
        ]);
        if (cancelled) return;
        if (md.success && md.data) setModelCatalog(md.data);
        if (pd.success && pd.data) setProviderCatalog(pd.data);
        if (rd.success && rd.data) setRoutesCatalog(rd.data);
      } catch (e) {
        console.error('Fetch gateway catalog for filters:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Read filters from URL on mount (e.g. from Model / Provider Usage drill-down)
    const params = new URLSearchParams(window.location.search);
    const apiKeyId = params.get('api_key_id');
    const modelId = params.get('model_id');
    const providerId = params.get('provider_id');
    const userEmail = params.get('user_email');
    const status = params.get('status');
    const startDate = params.get('start_date');
    const endDate = params.get('end_date');
    const routeGroup = params.get('route_group');
    const protocol = params.get('protocol');
    const pageParam = params.get('page');
    if (apiKeyId != null) setFilterApiKeyId(apiKeyId);
    if (modelId != null) setFilterModel(modelId);
    if (providerId != null) setFilterProviderId(providerId);
    if (userEmail != null) setFilterUserEmail(userEmail);
    if (status != null) setFilterStatus(status);
    if (startDate != null) setFilterStartDate(startDate);
    if (endDate != null) setFilterEndDate(endDate);
    const hasStart = startDate != null && startDate !== '';
    const hasEnd = endDate != null && endDate !== '';
    if (!hasStart && !hasEnd) {
      const { start_date, end_date } = rangeToParams('1d');
      setFilterStartDate(start_date);
      setFilterEndDate(end_date);
    }
    if (routeGroup != null) setFilterRouteGroup(routeGroup);
    if (protocol != null) setFilterProtocol(protocol);
    if (pageParam != null) {
      const n = parseInt(pageParam, 10);
      if (!Number.isNaN(n) && n >= 1) setPage(n);
    }
  }, []);

  useReplaceListPageQuery(
    () => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (filterStatus) params.append('status', filterStatus);
      if (filterModel) params.append('model_id', filterModel);
      if (filterProviderId) params.append('provider_id', filterProviderId);
      if (filterUserEmail) params.append('user_email', filterUserEmail);
      if (filterApiKeyId) params.append('api_key_id', filterApiKeyId);
      if (filterStartDate) params.append('start_date', filterStartDate);
      if (filterEndDate) params.append('end_date', filterEndDate);
      if (filterRouteGroup) params.append('route_group', filterRouteGroup);
      if (filterProtocol) params.append('protocol', filterProtocol);
      return params;
    },
    [
      page,
      pageSize,
      filterStatus,
      filterModel,
      filterProviderId,
      filterUserEmail,
      filterApiKeyId,
      filterStartDate,
      filterEndDate,
      filterRouteGroup,
      filterProtocol,
    ]
  );

  const modelSelectOptions = useMemo(() => {
    const rows = [...modelCatalog]
      .sort((a, b) =>
        (a.display_name?.trim() || a.id).localeCompare(b.display_name?.trim() || b.id, undefined, {
          sensitivity: 'base',
        })
      )
      .map((m) => ({
        id: m.id,
        label: m.display_name?.trim() || m.id,
      }));
    const ids = new Set(rows.map((r) => r.id));
    if (filterModel && !ids.has(filterModel)) {
      rows.unshift({ id: filterModel, label: `${filterModel} (not in catalog)` });
    }
    return rows;
  }, [modelCatalog, filterModel]);

  const providerSelectOptions = useMemo(() => {
    const rows = [...providerCatalog]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((p) => ({ id: p.id, label: p.name }));
    const ids = new Set(rows.map((r) => r.id));
    if (filterProviderId && !ids.has(filterProviderId)) {
      rows.unshift({
        id: filterProviderId,
        label: `${filterProviderId} (not in catalog)`,
      });
    }
    return rows;
  }, [providerCatalog, filterProviderId]);

  /** option 的 value 与展示文案均为规范化后的 route_group（与目录一致） */
  const routeGroupSelectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of routesCatalog) {
      set.add(normalizeRouteGroup(r.route_group));
    }
    const sorted = [...set].sort(compareRouteGroupsForDisplay);
    const rows = sorted.map((g) => ({ value: g, label: g }));
    const fg = filterRouteGroup;
    if (fg && !set.has(fg) && !set.has(normalizeRouteGroup(fg))) {
      rows.unshift({ value: fg, label: `${fg} (not in routes)` });
    }
    return rows;
  }, [routesCatalog, filterRouteGroup]);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (filterStatus) params.append('status', filterStatus);
      if (filterModel) params.append('model_id', filterModel);
      if (filterProviderId) params.append('provider_id', filterProviderId);
      if (filterUserEmail) params.append('user_email', filterUserEmail);
      if (filterApiKeyId) params.append('api_key_id', filterApiKeyId);
      if (filterStartDate) params.append('start_date', filterStartDate);
      if (filterEndDate) params.append('end_date', filterEndDate);
      if (filterRouteGroup) params.append('route_group', filterRouteGroup);
      if (filterProtocol) params.append('protocol', filterProtocol);

      const response = await fetch(`/api/admin/request-logs?${params.toString()}`);
      const data = await readApiJson<GatewayRequestLog[]>(response);
      if (data.success) {
        setLogs(data.data || []);
        setTotal(data.total || 0);
      }
    } catch (error) {
      console.error('Fetch logs error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [
    page,
    pageSize,
    filterStatus,
    filterModel,
    filterProviderId,
    filterUserEmail,
    filterApiKeyId,
    filterStartDate,
    filterEndDate,
    filterRouteGroup,
    filterProtocol,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (dateStr: string) => formatGatewayDateTime(dateStr);

  /** 毫秒数用千分位（如 23,332ms），便于扫读秒级量级 */
  const formatLatencyMs = (ms: number | null | undefined) => {
    if (ms == null || !ms) return '-';
    return `${Number(ms).toLocaleString('en-US')}ms`;
  };

  const prettifyLogJson = (raw: string | null | undefined): string => {
    if (raw == null || raw === '') return '';
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

  const formatCostMultiplier = (cost: number, standardCost: number): string | null => {
    if (!Number.isFinite(cost) || !Number.isFinite(standardCost) || standardCost <= 0) {
      return null;
    }
    const ratio = cost / standardCost;
    if (!Number.isFinite(ratio) || ratio < 0) {
      return null;
    }
    return `×${ratio.toLocaleString('en-US', { maximumFractionDigits: 3 })}`;
  };

  const toggleDetail = (logId: string) => {
    setDetailLogId((prev) => (prev === logId ? null : logId));
    setCopiedColumn(null);
  };

  const copyColumn = async (
    raw: string | null | undefined,
    col: 'audit' | 'entry' | 'upstream' | 'usage'
  ) => {
    const text = prettifyLogJson(raw);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedColumn(col);
      setTimeout(() => setCopiedColumn(null), 1500);
    } catch (error) {
      console.error('Copy column failed:', error);
    }
  };

  /** 客户端接入的 Gateway API 协议；旧行缺省时用路由快照 upstream_protocol */
  const logProtocolKey = (log: GatewayRequestLog): string => {
    const r = log.request_protocol?.trim().toLowerCase() ?? '';
    const u = log.upstream_protocol?.trim().toLowerCase() ?? '';
    return r || u || '';
  };

  const protocolIconOrDash = (p: string) =>
    p ? (
      <UpstreamProtocolBrandIcon protocol={p} />
    ) : (
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-[10px] text-gray-400" title="Unknown">
        —
      </span>
    );

  /** 第一行：协议图标 · route_group 彩色 chip · 模型名称（无展示名时回退 model_id） */
  const renderModelRouteLine = (log: GatewayRequestLog) => {
    const protocol = logProtocolKey(log);
    const name = log.model_name?.trim();
    const id = log.model_id?.trim();
    const route = normalizeRouteGroup(log.route_group);
    const display = name || id;
    const title =
      name && id && name !== id ? `Model: ${name} (id: ${id})` : display || undefined;
    return (
      <span className="leading-tight inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5" title={title}>
        <span title={protocol ? `Protocol: ${protocol}` : 'Protocol unknown'}>
          {protocolIconOrDash(protocol)}
        </span>
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold leading-4 ${routeGroupBadgeClass(route)}`}
          title={`route_group: ${route}`}
        >
          @{route}
        </span>
        {display ? (
          <span className="font-medium text-gray-900">{name || id}</span>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </span>
    );
  };

  /** 紧凑一行：仅展示供应商名称（无名称时回退 provider_id）· 上游模型名 */
  const renderProviderInline = (log: GatewayRequestLog) => {
    const pname = log.provider_name?.trim();
    const pid = log.provider_id?.trim();
    const upstream = log.provider_model_name?.trim();
    const display = pname || pid;
    const idOnly = !pname && Boolean(pid);
    const titleParts = [pname, pid, upstream].filter(Boolean);
    const titleHint =
      pname && pid && pname !== pid ? `Provider: ${pname} (id: ${pid})` : titleParts.join(' · ');
    return (
      <div className="flex items-center gap-1 min-w-0 leading-tight mt-0.5">
        <span className="truncate min-w-0" title={titleHint || undefined}>
          <span className={idOnly ? 'font-mono text-gray-800' : 'text-gray-900'}>
            {display || '-'}
          </span>
          {upstream ? (
            <>
              <span className="text-gray-300 mx-0.5">·</span>
              <span className="font-mono text-gray-600">{upstream}</span>
            </>
          ) : null}
        </span>
      </div>
    );
  };

  /** 首列状态色块（实心）；悬停色块见完整 status 文案 */
  const statusSwatchClass = (status: string) => {
    if (status === 'success') return 'bg-emerald-500';
    if (status === 'error') return 'bg-red-500';
    if (status === 'incomplete') return 'bg-amber-500';
    if (status === 'cancelled') return 'bg-violet-500';
    return 'bg-gray-400';
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Request Logs</h1>
        <p className="text-sm text-gray-500 mt-1">View gateway request history</p>
      </div>

      {/* Filters — time range first row */}
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

      <div className="mb-4 flex gap-4 flex-wrap">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="incomplete">Incomplete</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Model</label>
          <select
            value={filterModel}
            onChange={(e) => { setFilterModel(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[12rem] max-w-xs"
          >
            <option value="">All</option>
            {modelSelectOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Provider</label>
          <select
            value={filterProviderId}
            onChange={(e) => { setFilterProviderId(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[12rem] max-w-xs"
          >
            <option value="">All</option>
            {providerSelectOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Protocol</label>
          <select
            value={filterProtocol}
            onChange={(e) => { setFilterProtocol(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[9rem]"
          >
            <option value="">All</option>
            {UPSTREAM_PROTOCOLS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Route group</label>
          <select
            value={filterRouteGroup}
            onChange={(e) => { setFilterRouteGroup(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[10rem] max-w-xs"
          >
            <option value="">All</option>
            {routeGroupSelectOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">User Email</label>
          <input
            type="text"
            value={filterUserEmail}
            onChange={(e) => { setFilterUserEmail(e.target.value); setPage(1); }}
            placeholder="Filter by email..."
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">API Key ID</label>
          <input
            type="text"
            value={filterApiKeyId}
            onChange={(e) => { setFilterApiKeyId(e.target.value); setPage(1); }}
            placeholder="Filter by API key..."
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={() => { setFilterStatus(''); setFilterModel(''); setFilterProviderId(''); setFilterUserEmail(''); setFilterApiKeyId(''); setFilterStartDate(''); setFilterEndDate(''); setFilterRouteGroup(''); setFilterProtocol(''); setPage(1); }}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Stats + status swatch legend */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
        <span className="text-sm">Total: {total} requests</span>
        <span className="hidden sm:inline h-3 w-px bg-gray-200" aria-hidden />
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 shrink-0" aria-hidden />
            success
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500 shrink-0" aria-hidden />
            error
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500 shrink-0" aria-hidden />
            incomplete
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-500 shrink-0" aria-hidden />
            cancelled
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-400 shrink-0" aria-hidden />
            other
          </span>
        </span>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Status · Time</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">User</th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[15rem] max-w-md"
                  title="Protocol, route group, model, provider, and provider model"
                >
                  Model Route
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Tokens</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap">
                  Standard ({billingCurrencySym})
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap">
                  Charged ({billingCurrencySym})
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap">
                  Metered ({billingCurrencySym})
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap"
                  title="Charged − metered (per request)"
                >
                  Profit ({billingCurrencySym})
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {logs.map((log) => {
                const standardCost = Number(log.standard_cost ?? 0);
                const chargedCost = Number(log.charged_cost ?? 0);
                const meteredCost = Number(log.metered_cost ?? 0);
                const profit = chargedCost - meteredCost;
                const profitToneClass =
                  profit > 0 ? 'text-emerald-700' : profit < 0 ? 'text-red-600' : 'text-gray-600';
                const chargedMultiplier = formatCostMultiplier(chargedCost, standardCost);
                const meteredMultiplier = formatCostMultiplier(meteredCost, standardCost);
                return (
                  <Fragment key={log.id}>
                  <tr
                    className={`align-top cursor-pointer transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 ${
                      detailLogId === log.id ? 'bg-slate-50' : ''
                    }`}
                    onClick={() => toggleDetail(log.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleDetail(log.id);
                      }
                    }}
                    tabIndex={0}
                    aria-expanded={detailLogId === log.id}
                    title="Click to show or hide pricing audit and request / usage bodies"
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 leading-tight">
                      <div className="flex items-start gap-2">
                        <span
                          className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 mt-1 ${statusSwatchClass(log.status)}`}
                          title={log.status}
                          role="img"
                          aria-label={`Status: ${log.status}`}
                        />
                        <div className="min-w-0">
                          <div>{formatDate(log.created_at)}</div>
                          <div className="mt-0.5 text-gray-500 tabular-nums">
                            {formatLatencyMs(log.latency_ms)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-900 max-w-[14rem] align-top min-w-0">
                      <div className="min-w-0">
                        <div className="truncate" title={log.user_email || undefined}>
                          {log.user_email || '-'}
                        </div>
                        {log.status === 'error' && log.error_message?.trim() ? (
                          <div
                            className="mt-0.5 text-[11px] text-red-600 leading-snug line-clamp-2 break-words"
                            title={log.error_message}
                          >
                            {log.error_message.trim()}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs align-top max-w-md">
                      <div>{renderModelRouteLine(log)}</div>
                      {renderProviderInline(log)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 leading-tight">
                      <div className="text-gray-900 tabular-nums">
                        {log.input_tokens} / {log.output_tokens}
                      </div>
                      {(log.cache_read_tokens > 0 || log.cache_write_tokens > 0) && (
                        <div className="text-gray-400 tabular-nums mt-0.5">
                          CR {log.cache_read_tokens} / CW {log.cache_write_tokens}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap tabular-nums text-gray-900">
                      {formatGatewayMoneyCode(standardCost, billingCurrency, 6)}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap tabular-nums leading-tight">
                      <div className="text-gray-900 inline-flex items-center gap-1">
                        <span>{formatGatewayMoneyCode(chargedCost, billingCurrency, 6)}</span>
                        <span className="text-gray-500">{chargedMultiplier ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap tabular-nums leading-tight">
                      <div className="text-gray-900 inline-flex items-center gap-1">
                        <span>{formatGatewayMoneyCode(meteredCost, billingCurrency, 6)}</span>
                        <span className="text-gray-500">{meteredMultiplier ?? '—'}</span>
                      </div>
                    </td>
                    <td
                      className={`px-3 py-2 text-xs whitespace-nowrap tabular-nums font-medium ${profitToneClass}`}
                      title="Charged − metered"
                    >
                      {formatGatewayMoneyCodeSigned(profit, billingCurrency, 6)}
                    </td>
                  </tr>
                  {detailLogId === log.id && (
                    <tr className="bg-gray-50">
                      <td colSpan={8} className="px-3 py-2">
                        <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
                          {(() => {
                            const auditLine = summarizePricingAuditJson(log.pricing_audit ?? null);
                            const auditRaw = log.pricing_audit?.trim();
                            const auditDisplay = auditRaw ? prettifyLogJson(auditRaw) : '';
                            const auditEmpty = !auditDisplay;
                            return (
                              <div className="grid min-w-[72rem] grid-cols-4 gap-3 p-3">
                                <div className="min-w-0 flex flex-col min-h-0 border border-violet-200 rounded-md overflow-hidden bg-violet-50/50">
                                  <div className="px-2 py-1.5 border-b border-violet-200 bg-violet-100/40 flex items-center justify-between gap-2 shrink-0">
                                    <span className="text-xs font-medium text-violet-950">Pricing audit</span>
                                    <button
                                      type="button"
                                      disabled={auditEmpty}
                                      onClick={() => copyColumn(log.pricing_audit, 'audit')}
                                      className="px-2 py-0.5 text-[10px] border border-violet-300 rounded text-violet-950 hover:bg-white/80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                    >
                                      {copiedColumn === 'audit' ? 'Copied' : 'Copy'}
                                    </button>
                                  </div>
                                  <div className="flex flex-col flex-1 min-h-0 p-2 gap-2">
                                    {auditLine ? (
                                      <div className="text-[11px] text-violet-950/95 shrink-0">{auditLine}</div>
                                    ) : null}
                                    <pre className="flex-1 min-h-[6rem] max-h-48 overflow-auto rounded border border-violet-100 bg-white/90 p-2 font-mono text-[11px] leading-snug text-gray-800 whitespace-pre-wrap break-words">
                                      {auditEmpty ? 'No data' : auditDisplay}
                                    </pre>
                                  </div>
                                </div>
                                {(
                                  [
                                    {
                                      col: 'entry' as const,
                                      title: 'Entry request body (redacted)',
                                      raw: log.request_body,
                                    },
                                    {
                                      col: 'upstream' as const,
                                      title: 'Upstream request body (redacted)',
                                      raw: log.upstream_request_body,
                                    },
                                    {
                                      col: 'usage' as const,
                                      title: 'Upstream usage (raw)',
                                      raw: log.raw_usage,
                                    },
                                  ] as const
                                ).map(({ col, title, raw }) => {
                                  const display = prettifyLogJson(raw);
                                  const empty = !display;
                                  return (
                                    <div
                                      key={col}
                                      className="min-w-0 flex flex-col min-h-0 border border-gray-200 rounded-md overflow-hidden"
                                    >
                                      <div className="px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-2 shrink-0">
                                        <span className="text-xs font-medium text-gray-700">{title}</span>
                                        <button
                                          type="button"
                                          disabled={empty}
                                          onClick={() => copyColumn(raw, col)}
                                          className="px-2 py-0.5 text-[10px] border border-gray-300 rounded text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                        >
                                          {copiedColumn === col ? 'Copied' : 'Copy'}
                                        </button>
                                      </div>
                                      <pre className="p-2 text-xs text-gray-800 whitespace-pre-wrap break-words min-h-[6rem] max-h-48 overflow-auto font-mono flex-1">
                                        {empty ? 'No data' : display}
                                      </pre>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {logs.length === 0 && !isLoading && (
          <div className="text-center py-12 text-gray-500">No logs found</div>
        )}

        {isLoading && (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          <button
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
