'use client';

/**
 * 全站请求日志表：多维筛选、分页；Route 列按入站 / 上游两行展示协议端点、模型 ID 与路由组；展开行为四栏（pricing audit + 三份 JSON）；数据来自 `/api/admin/request-logs`。
 */
import { useTranslations } from 'next-intl';
import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronRightIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import type { GatewayModel, GatewayModelRoute, GatewayProvider, GatewayRequestLog } from '@/lib/types';
import {
  compareRouteGroupsForDisplay,
  normalizeRouteGroup,
  routeGroupBadgeClass,
} from '@/lib/route-group-ui';
import { GATEWAY_TOOLS_PROVIDER_ID } from '@/lib/gateway-tools';
import { proxyToolPath } from '@/lib/invoke-kind';
import { UPSTREAM_PROTOCOLS } from '@/lib/upstream-protocol';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { requestLogProtocolPath, requestSurfacePath } from '../routes/route-utils';
import { isRequestLogStreaming, parseGeminiWireAction } from './request-log-display';
import {
  createRangeValue,
  DEFAULT_GATEWAY_TIME_RANGE_PRESET,
  detectRollingPreset,
  type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { formatGatewayMoneyCode, formatGatewayMoneyCodeSigned, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { summarizePricingAuditJson } from '@/lib/pricing-ui';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

/** `/api/admin/models` 列表项（tags 解析为数组） */
type ModelListItem = Omit<GatewayModel, 'tags'> & { tags: string[] };

export default function GatewayRequestLogsPage() {
  const t = useTranslations('requestLogs');
  const tCommon = useTranslations('common');
  const tOptions = useTranslations('options');
  const [logs, setLogs] = useState<GatewayRequestLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  /** 展开四栏详情：pricing audit / 入口请求体 / 上游请求体 / raw usage */
  const [detailLogId, setDetailLogId] = useState<string | null>(null);
  const [timingHelpLog, setTimingHelpLog] = useState<GatewayRequestLog | null>(null);
  const [copiedColumn, setCopiedColumn] = useState<
    'audit' | 'entry' | 'upstream' | 'usage' | 'timing' | 'upstream_request_id' | 'upstream_message_id' | null
  >(null);
  const pageSize = 50;
  const { currency: billingCurrency } = useBillingCurrency();
  const { formatDateTime } = useGatewayDateTime();
  const billingCurrencySym = getGatewayCurrencySymbol(billingCurrency);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterUserEmail, setFilterUserEmail] = useState('');
  const [filterApiKeyId, setFilterApiKeyId] = useState('');
  const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue(DEFAULT_GATEWAY_TIME_RANGE_PRESET));
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
      if (rangeValue.start_date) params.append('start_date', rangeValue.start_date);
      if (rangeValue.end_date) params.append('end_date', rangeValue.end_date);
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
      rangeValue.start_date,
      rangeValue.end_date,
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
      if (rangeValue.start_date) params.append('start_date', rangeValue.start_date);
      if (rangeValue.end_date) params.append('end_date', rangeValue.end_date);
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
    rangeValue.start_date,
    rangeValue.end_date,
    filterRouteGroup,
    filterProtocol,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (dateStr: string) => formatDateTime(dateStr);

  /** 毫秒数用千分位（如 23,332ms），便于扫读秒级量级 */
  const formatLatencyMs = (ms: number | null | undefined) => {
    if (ms == null) return '-';
    return `${Number(ms).toLocaleString('en-US')}ms`;
  };

  const timingDiagram = (log: GatewayRequestLog): string => {
    const gateway = formatLatencyMs(log.gateway_overhead_ms);
    const upstream = formatLatencyMs(log.upstream_response_ms);
    const headers = formatLatencyMs(log.final_upstream_headers_ms);
    const reasoningTtft = formatLatencyMs(log.first_reasoning_token_ms);
    const contentTtft = formatLatencyMs(log.first_token_ms);
    const stream = formatLatencyMs(log.stream_duration_ms);
    const reasoningPhaseMs =
      log.first_reasoning_token_ms != null &&
      log.first_token_ms != null &&
      log.first_token_ms >= log.first_reasoning_token_ms
        ? formatLatencyMs(log.first_token_ms - log.first_reasoning_token_ms)
        : null;
    const hasReasoning = log.first_reasoning_token_ms != null;
    const lines = [
      'Start',
      '  |',
      `  | Gateway ${gateway}`,
      '  |<-- preflight -->|',
      '                    |',
      `                    | Upstream ${upstream}`,
      '                    |<------ dispatch + provider headers ------>|',
      `                    | Headers(final attempt) ${headers}`,
      '                    |<---------- final fetch headers ---------->|',
    ];
    if (hasReasoning) {
      lines.push(
        '                                                                  |',
        `                                                                  | Reasoning ${reasoningPhaseMs ?? reasoningTtft}`,
        `                                                                  |<---- ${t('timing.reasoningPhase')} ---->|`,
      );
    } else {
      lines.push('                                                                  |');
    }
    lines.push(
      `                                                                  | Stream ${stream}`,
      `                                                                  |<------ ${t('timing.contentPhase')} ------>|`,
    );
    if (hasReasoning) {
      lines.push(`  |<-------- ${t('timing.ttftReasoningBracket')} ${reasoningTtft} -------->|`);
    }
    if (log.first_token_ms != null) {
      lines.push(`  |<--------------------- ${t('timing.ttftContent')} ${contentTtft} --------------------->|`);
    } else if (!hasReasoning) {
      lines.push(`  |<------------------------- TTFT ${contentTtft} ---------------------->|`);
    }
    lines.push('', `Attempts: ${log.upstream_attempt_count ?? '-'} / failover ${log.upstream_failover_count ?? '-'}`);
    return lines.join('\n');
  };

  const formatTtftListLine = (log: GatewayRequestLog): { text: string; title?: string } => {
    if (log.first_reasoning_token_ms != null) {
      const text = t('timing.listReasoning', { ms: formatLatencyMs(log.first_reasoning_token_ms) });
      const title =
        log.first_token_ms != null
          ? t('timing.listContentTtftTitle', { ms: formatLatencyMs(log.first_token_ms) })
          : undefined;
      return { text, title };
    }
    if (log.first_token_ms != null) {
      return { text: `TTFT ${formatLatencyMs(log.first_token_ms)}` };
    }
    if (log.upstream_response_ms != null) {
      return { text: `Up ${formatLatencyMs(log.upstream_response_ms)}` };
    }
    return { text: '\u00A0' };
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

  /** Tokens：默认一行 input/output；存在 cache 时补充第二行；按张/按秒保持单行。 */
  const renderTokensCell = (log: GatewayRequestLog) => {
    if (log.billing_kind === 'image_per_image') {
      const inN = log.input_image_count ?? 0;
      const outN = log.output_image_count ?? 0;
      const line =
        inN > 0 && outN > 0
          ? `${inN}×${outN} img`
          : `${inN + outN} ${inN + outN === 1 ? 'image' : 'images'}`;
      return (
        <div className="leading-tight">
          <div className="text-gray-900 tabular-nums" title={t('titles.imagePerImageUsage')}>
            {line}
          </div>
        </div>
      );
    }
    if (log.billing_kind === 'audio_per_second') {
      const secs = log.audio_duration_seconds;
      const line =
        secs != null && Number.isFinite(secs)
          ? `${Number(secs).toLocaleString('en-US', { maximumFractionDigits: 3 })} s`
          : '—';
      return (
        <div className="leading-tight">
          <div className="text-gray-900 tabular-nums" title={t('titles.audioPerSecondUsage')}>
            {line}
          </div>
        </div>
      );
    }
    if (log.billing_kind === 'audio_per_character') {
      const characters = log.audio_characters;
      const line =
        characters != null && Number.isFinite(characters)
          ? `${Number(characters).toLocaleString()} chars`
          : '—';
      return (
        <div className="leading-tight">
          <div className="text-gray-900 tabular-nums" title={t('titles.audioPerCharacterUsage')}>
            {line}
          </div>
        </div>
      );
    }
    const hasCache = log.cache_read_tokens > 0 || log.cache_write_tokens > 0;
    return (
      <div className="leading-tight space-y-0.5">
        <div className="text-gray-900 tabular-nums" title={t('titles.inputOutputTokens')}>
          {log.input_tokens} / {log.output_tokens}
        </div>
        {hasCache ? (
          <div className="text-gray-400 tabular-nums" title={t('titles.cacheTokens')}>
            CR {log.cache_read_tokens} / CW {log.cache_write_tokens}
          </div>
        ) : null}
      </div>
    );
  };

  /** 列表只展示 Charged / Metered 两行；Standard 与倍率保留在悬停及展开审计中。 */
  const renderCostCell = (
    standardCost: number,
    chargedCost: number,
    meteredCost: number
  ) => {
    const chargedMultiplier = formatCostMultiplier(chargedCost, standardCost);
    const meteredMultiplier = formatCostMultiplier(meteredCost, standardCost);
    const costLine = (label: 'C' | 'M', amount: number, multiplier: string | null) => (
      <div className="inline-flex items-baseline gap-1 tabular-nums">
        <span className="w-3 text-[10px] font-semibold text-gray-400">{label}</span>
        <span>{formatGatewayMoneyCode(amount, billingCurrency, 6)}</span>
        {multiplier ? <span className="text-[10px] text-gray-400">{multiplier}</span> : null}
      </div>
    );
    return (
      <div
        className="leading-tight space-y-0.5"
        title={`${t('titles.standardCatalogPrice')}: ${formatGatewayMoneyCode(standardCost, billingCurrency, 6)}`}
      >
        <div className="text-gray-900" title={t('titles.chargedUserBudget')}>
          {costLine('C', chargedCost, chargedMultiplier)}
        </div>
        <div className="text-gray-700" title={t('titles.meteredSupplierCost')}>
          {costLine('M', meteredCost, meteredMultiplier)}
        </div>
      </div>
    );
  };

  const toggleDetail = (logId: string) => {
    setDetailLogId((prev) => (prev === logId ? null : logId));
    setTimingHelpLog(null);
    setCopiedColumn(null);
  };

  const copyPlainText = async (
    raw: string | null | undefined,
    col: 'upstream_request_id' | 'upstream_message_id'
  ) => {
    const text = raw?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedColumn(col);
      setTimeout(() => setCopiedColumn(null), 1500);
    } catch (error) {
      console.error('Copy plain text failed:', error);
    }
  };

  const copyColumn = async (
    raw: string | null | undefined,
    col: 'audit' | 'entry' | 'upstream' | 'usage' | 'timing'
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

  /** 将协议 + operation 映射为客户端路径；缺省时回退空串。Gemini 用紧凑端点。 */
  const protocolEndpointPath = (
    protocol: string | null | undefined,
    operation: string | null | undefined
  ): string => {
    const p = protocol?.trim().toLowerCase() ?? '';
    const op = operation?.trim() ?? '';
    if (!p && !op) return '';
    if (!p) return op;
    return requestLogProtocolPath(p, op || '*');
  };

  const renderRouteLeg = (opts: {
    label: string;
    path: string;
    pathTitle?: string;
    modelId: string;
    modelTitle?: string;
    group?: string;
  }) => (
    <>
      <span className="shrink-0 text-[10px] font-semibold text-slate-400">
        {opts.label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="shrink-0 max-w-[55%] truncate font-mono text-[11px] text-gray-700"
          title={opts.pathTitle || opts.path || undefined}
        >
          {opts.path || '—'}
        </span>
        {opts.modelId ? (
          <span
            className="min-w-0 truncate font-mono text-[11px] font-medium text-gray-900"
            title={opts.modelTitle || opts.modelId}
          >
            {opts.modelId}
          </span>
        ) : null}
        {opts.group ? (
          <span
            className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-4 ${routeGroupBadgeClass(opts.group)}`}
            title={`route_group: ${opts.group}`}
          >
            @{opts.group}
          </span>
        ) : null}
      </div>
    </>
  );

  /** Route 列：入站（协议端点 + model_id + 路由组）/ 上游（协议端点 + 上游 model id）。 */
  const renderRouteCell = (log: GatewayRequestLog) => {
    const inboundModelId = log.model_id?.trim() ?? '';
    const upstreamModelId = log.provider_model_name?.trim() ?? '';
    const route = normalizeRouteGroup(log.route_group);
    const isAgentTool = log.provider_id === GATEWAY_TOOLS_PROVIDER_ID;
    const geminiAction = parseGeminiWireAction(log.route_trace);
    const inboundProtocol = (log.request_protocol || log.upstream_protocol)?.trim().toLowerCase() ?? '';
    const inboundOperation = (log.request_operation || log.upstream_operation)?.trim() ?? '';
    const upstreamProtocol = log.upstream_protocol?.trim().toLowerCase() ?? '';
    const upstreamOperation = log.upstream_operation?.trim() ?? '';
    const inboundPath = isAgentTool
      ? (inboundModelId ? proxyToolPath(inboundModelId) : '')
      : protocolEndpointPath(inboundProtocol, inboundOperation);
    const upstreamPath = isAgentTool
      ? ''
      : protocolEndpointPath(upstreamProtocol, upstreamOperation);
    const inboundPathTitle =
      inboundProtocol === 'gemini' && inboundOperation
        ? requestSurfacePath(inboundProtocol, geminiAction || inboundOperation, inboundModelId || undefined)
        : inboundPath;
    const upstreamPathTitle =
      upstreamProtocol === 'gemini' && upstreamOperation
        ? requestSurfacePath(upstreamProtocol, geminiAction || upstreamOperation, upstreamModelId || inboundModelId || undefined)
        : upstreamPath;
    const inboundTitle = [
      log.model_name?.trim(),
      inboundModelId ? `model_id: ${inboundModelId}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const upstreamTitle = isAgentTool
      ? (upstreamModelId ? `Tool engine: ${upstreamModelId}` : undefined)
      : (upstreamModelId ? `Upstream model: ${upstreamModelId}` : undefined);

    return (
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-0.5 leading-tight">
        {renderRouteLeg({
          label: t('route.inbound'),
          path: inboundPath,
          pathTitle: inboundPathTitle,
          modelId: inboundModelId,
          modelTitle: inboundTitle || undefined,
          group: route,
        })}
        {renderRouteLeg({
          label: t('route.upstream'),
          path: upstreamPath,
          pathTitle: upstreamPathTitle,
          modelId: upstreamModelId,
          modelTitle: upstreamTitle,
        })}
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
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
      </div>

      {/* Filters — time range first row */}
      <div className="mb-4 w-full min-w-0">
        <GatewayTimeRangePicker
          value={rangeValue}
          onChange={(v) => {
            setRangeValue(v);
            setPage(1);
          }}
        />
      </div>

      <div className="mb-4 flex gap-4 flex-wrap">
        <div>
          <label className="block text-sm text-gray-500 mb-1">{tCommon('status')}</label>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">{tCommon('all')}</option>
            <option value="success">{tOptions('requestStatus.success')}</option>
            <option value="error">{tOptions('requestStatus.error')}</option>
            <option value="incomplete">{tOptions('requestStatus.incomplete')}</option>
            <option value="cancelled">{tOptions('requestStatus.cancelled')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">{tCommon('model')}</label>
          <select
            value={filterModel}
            onChange={(e) => { setFilterModel(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[12rem] max-w-xs"
          >
            <option value="">{tCommon('all')}</option>
            {modelSelectOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">{tCommon('provider')}</label>
          <select
            value={filterProviderId}
            onChange={(e) => { setFilterProviderId(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[12rem] max-w-xs"
          >
            <option value="">{tCommon('all')}</option>
            {providerSelectOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">{t('filters.protocol')}</label>
          <select
            value={filterProtocol}
            onChange={(e) => { setFilterProtocol(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[9rem]"
          >
            <option value="">{tCommon('all')}</option>
            {UPSTREAM_PROTOCOLS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">{t('filters.routeGroup')}</label>
          <select
            value={filterRouteGroup}
            onChange={(e) => { setFilterRouteGroup(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[10rem] max-w-xs"
          >
            <option value="">{tCommon('all')}</option>
            {routeGroupSelectOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">{t('filters.userEmail')}</label>
          <input
            type="text"
            value={filterUserEmail}
            onChange={(e) => { setFilterUserEmail(e.target.value); setPage(1); }}
            placeholder={t('filters.emailPlaceholder')}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">{t('filters.apiKeyId')}</label>
          <input
            type="text"
            value={filterApiKeyId}
            onChange={(e) => { setFilterApiKeyId(e.target.value); setPage(1); }}
            placeholder={t('filters.apiKeyPlaceholder')}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={() => { setFilterStatus(''); setFilterModel(''); setFilterProviderId(''); setFilterUserEmail(''); setFilterApiKeyId(''); setRangeValue({ preset: 'custom', start_date: '', end_date: '' }); setFilterRouteGroup(''); setFilterProtocol(''); setPage(1); }}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            {tCommon('clearFilters')}
          </button>
        </div>
      </div>

      {/* Stats + status swatch legend */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
        <span className="text-sm">{t('totalRequests', { count: total })}</span>
        <span className="hidden sm:inline h-3 w-px bg-gray-200" aria-hidden />
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 shrink-0" aria-hidden />
            {tOptions('requestStatus.success')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500 shrink-0" aria-hidden />
            {tOptions('requestStatus.error')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500 shrink-0" aria-hidden />
            {tOptions('requestStatus.incomplete')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-500 shrink-0" aria-hidden />
            {tOptions('requestStatus.cancelled')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-400 shrink-0" aria-hidden />
            {t('statusOther')}
          </span>
        </span>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{t('headers.statusTime')}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{t('headers.userSystem')}</th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[16rem] max-w-md"
                  title={t('titles.route')}
                >
                  {t('headers.route')}
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  title={t('titles.stream')}
                >
                  {t('headers.stream')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  {t('headers.tokens')}
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap"
                  title={t('titles.cost')}
                >
                  {t('headers.cost', { currency: billingCurrencySym })}
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap"
                  title={t('titles.profit')}
                >
                  {t('headers.profit', { currency: billingCurrencySym })}
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
                return (
                  <Fragment key={log.id}>
                  <tr
                    className={`align-middle cursor-pointer transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 ${
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
                    title={t('titles.rowDetail')}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 leading-tight">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 ${statusSwatchClass(log.status)}`}
                          title={log.status}
                          role="img"
                          aria-label={`Status: ${log.status}`}
                        />
                        <div className="min-w-0">
                          <div>{formatDate(log.created_at)}</div>
                          <div
                            className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400 tabular-nums"
                            title={formatTtftListLine(log).title ?? (log.first_token_ms != null ? `TTFT ${formatLatencyMs(log.first_token_ms)}` : undefined)}
                          >
                            <span>{formatLatencyMs(log.latency_ms)}</span>
                            <span aria-hidden>·</span>
                            <span>{formatTtftListLine(log).text}</span>
                          </div>
                        </div>
                        <ChevronRightIcon
                          className={`h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform ${
                            detailLogId === log.id ? 'rotate-90 text-blue-500' : ''
                          }`}
                          aria-hidden
                        />
                      </div>
                      {log.status === 'error' && log.error_message?.trim() ? (
                        <div
                          className="mt-1 max-w-[18rem] truncate text-[11px] leading-snug text-red-600"
                          title={log.error_message}
                        >
                          {log.error_message.trim()}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[14rem] min-w-0">
                      <div className="min-w-0 space-y-0.5 leading-snug">
                        <div className="truncate text-gray-900" title={log.user_email || undefined}>
                          {log.user_email || '-'}
                        </div>
                        <div
                          className="truncate font-mono text-[11px] text-gray-500"
                          title={log.external_system?.trim() || undefined}
                        >
                          {log.external_system?.trim() || '-'}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs max-w-md">
                      {renderRouteCell(log)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      {isRequestLogStreaming(log) ? (
                        <span
                          className="inline-flex items-center rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200"
                          title={t('titles.stream')}
                        >
                          {t('stream.yes')}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 leading-tight">
                      {renderTokensCell(log)}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {renderCostCell(standardCost, chargedCost, meteredCost)}
                    </td>
                    <td
                      className={`px-3 py-2 text-xs whitespace-nowrap tabular-nums font-medium ${profitToneClass}`}
                      title={t('titles.profit')}
                    >
                      {formatGatewayMoneyCodeSigned(profit, billingCurrency, 6)}
                    </td>
                  </tr>
                  {detailLogId === log.id && (
                    <tr className="bg-gray-50">
                      <td colSpan={7} className="px-3 py-2">
                        <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
                          {(() => {
                            const auditLine = summarizePricingAuditJson(log.pricing_audit ?? null);
                            const auditRaw = log.pricing_audit?.trim();
                            const auditDisplay = auditRaw ? prettifyLogJson(auditRaw) : '';
                            const auditEmpty = !auditDisplay;
                            const timingDisplay = prettifyLogJson(log.timing_metadata ?? null);
                            const timingRows = [
                              ['Gateway', log.gateway_overhead_ms],
                              ['Upstream', log.upstream_response_ms],
                              ['Headers', log.final_upstream_headers_ms],
                              [t('timing.reasoning'), log.first_reasoning_token_ms],
                              [t('timing.ttftContent'), log.first_token_ms],
                              ['Stream', log.stream_duration_ms],
                            ] as const;
                            const upstreamRequestId = log.upstream_request_id?.trim() ?? '';
                            const upstreamMessageId = log.upstream_message_id?.trim() ?? '';
                            const providerKey = [
                              log.provider_key_label?.trim(),
                              log.provider_key_fingerprint?.trim(),
                              log.provider_key_id?.trim(),
                            ].filter(Boolean).join(' · ');
                            const protocolMapping = [
                              [log.request_protocol, log.request_operation].filter(Boolean).join('.'),
                              [log.upstream_protocol, log.upstream_operation].filter(Boolean).join('.'),
                            ].filter(Boolean).join(' → ');
                            const routeTarget = [
                              log.model_surface_id ? `surface ${log.model_surface_id}` : '',
                              log.route_pool_id ? `pool ${log.route_pool_id}` : '',
                              log.route_target_id ? `target ${log.route_target_id}` : '',
                            ].filter(Boolean).join(' · ');
                            const summaryFields = [
                              { label: t('detail.requestId'), value: log.id },
                              {
                                label: t('detail.identity'),
                                value: [log.user_email, log.api_key_id].filter(Boolean).join(' · '),
                              },
                              { label: t('detail.modelId'), value: log.model_id ?? '' },
                              {
                                label: t('detail.routeGroup'),
                                value: normalizeRouteGroup(log.route_group),
                              },
                              {
                                label: t('detail.providerRoute'),
                                value: [log.provider_name || log.provider_id, log.provider_model_name]
                                  .filter(Boolean)
                                  .join(' · '),
                              },
                              { label: t('detail.protocolMapping'), value: protocolMapping },
                              { label: t('detail.providerKey'), value: providerKey },
                              { label: t('detail.routeTarget'), value: routeTarget },
                            ];
                            return (
                              <div className="min-w-[110rem]">
                                <div className="border-b border-gray-200 bg-slate-50/70 p-3">
                                  <div className="grid grid-cols-4 gap-x-4 gap-y-2">
                                    {summaryFields.map(({ label, value }) => (
                                      <div key={label} className="min-w-0">
                                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                          {label}
                                        </div>
                                        <div
                                          className="mt-0.5 truncate font-mono text-[11px] text-slate-700"
                                          title={value || undefined}
                                        >
                                          {value || '-'}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  {log.error_message?.trim() ? (
                                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                                      <div className="text-[10px] font-semibold uppercase tracking-wide text-red-500">
                                        {t('detail.error')}
                                      </div>
                                      <div className="mt-0.5 whitespace-pre-wrap break-words text-xs text-red-800">
                                        {log.error_message.trim()}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                                {upstreamMessageId || upstreamRequestId ? (
                                  <div className="grid grid-cols-2 gap-3 border-b border-gray-200 bg-gray-50/70 p-3">
                                    {[
                                      {
                                        id: 'upstream_message_id' as const,
                                        label: t('detail.upstreamMessageId'),
                                        value: upstreamMessageId,
                                        tone: 'emerald',
                                      },
                                      {
                                        id: 'upstream_request_id' as const,
                                        label: t('detail.upstreamRequestId'),
                                        value: upstreamRequestId,
                                        tone: 'sky',
                                      },
                                    ].map(({ id, label, value, tone }) => (
                                      <div
                                        key={id}
                                        className={`min-w-0 rounded border px-3 py-2 ${
                                          tone === 'emerald'
                                            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
                                            : 'border-sky-200 bg-sky-50/70 text-sky-950'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="text-[11px] font-medium">{label}</div>
                                            <div
                                              className="mt-0.5 truncate font-mono text-xs"
                                              title={value || undefined}
                                            >
                                              {value || '-'}
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            disabled={!value}
                                            onClick={() => copyPlainText(value, id)}
                                            className={`px-2 py-0.5 text-[10px] border rounded hover:bg-white/80 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                                              tone === 'emerald'
                                                ? 'border-emerald-300 text-emerald-950'
                                                : 'border-sky-300 text-sky-950'
                                            }`}
                                          >
                                            {copiedColumn === id ? tCommon('copied') : tCommon('copy')}
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              <div className="grid min-w-[110rem] grid-cols-5 items-start gap-3 p-3">
                                <div className="min-w-0 flex h-[28rem] flex-col overflow-hidden rounded-md border border-sky-200 bg-sky-50/50">
                                  <div className="px-2 py-1.5 border-b border-sky-200 bg-sky-100/50 flex items-center justify-between gap-2 shrink-0">
                                    <span className="text-xs font-medium text-sky-950">{t('detail.timing')}</span>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setTimingHelpLog(log)}
                                        title={t('timing.explain')}
                                        className="inline-flex h-5 w-5 items-center justify-center rounded border border-sky-300 text-sky-900 hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
                                      >
                                        <QuestionMarkCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span className="sr-only">{t('timing.explain')}</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!timingDisplay}
                                        onClick={() => copyColumn(log.timing_metadata, 'timing')}
                                        className="px-2 py-0.5 text-[10px] border border-sky-300 rounded text-sky-950 hover:bg-white/80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                      >
                                        {copiedColumn === 'timing' ? tCommon('copied') : tCommon('copy')}
                                      </button>
                                    </div>
                                  </div>
                                  <div className="p-2 text-[11px] text-sky-950 space-y-1 shrink-0">
                                    {timingRows.map(([label, value]) => (
                                      <div key={label} className="flex items-center justify-between gap-3">
                                        <span>{label}</span>
                                        <span className="font-mono tabular-nums">{formatLatencyMs(value)}</span>
                                      </div>
                                    ))}
                                    <div className="flex items-center justify-between gap-3 border-t border-sky-100 pt-1">
                                      <span>{t('timing.attempts')}</span>
                                      <span className="font-mono tabular-nums">
                                        {log.upstream_attempt_count ?? '-'} / failover {log.upstream_failover_count ?? '-'}
                                      </span>
                                    </div>
                                  </div>
                                  <pre className="mx-2 mb-2 flex-1 min-h-0 overflow-auto rounded border border-sky-100 bg-white/90 p-2 font-mono text-[11px] leading-snug text-gray-800 whitespace-pre-wrap break-words">
                                    {timingDisplay || tCommon('noDataFound')}
                                  </pre>
                                </div>
                                <div className="min-w-0 flex h-[28rem] flex-col overflow-hidden rounded-md border border-violet-200 bg-violet-50/50">
                                  <div className="px-2 py-1.5 border-b border-violet-200 bg-violet-100/40 flex items-center justify-between gap-2 shrink-0">
                                    <span className="text-xs font-medium text-violet-950">{t('detail.pricingAudit')}</span>
                                    <button
                                      type="button"
                                      disabled={auditEmpty}
                                      onClick={() => copyColumn(log.pricing_audit, 'audit')}
                                      className="px-2 py-0.5 text-[10px] border border-violet-300 rounded text-violet-950 hover:bg-white/80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                    >
                                      {copiedColumn === 'audit' ? tCommon('copied') : tCommon('copy')}
                                    </button>
                                  </div>
                                  <div className="flex flex-col flex-1 min-h-0 p-2 gap-2">
                                    {auditLine ? (
                                      <div className="text-[11px] text-violet-950/95 shrink-0">{auditLine}</div>
                                    ) : null}
                                    <pre className="flex-1 min-h-0 overflow-auto rounded border border-violet-100 bg-white/90 p-2 font-mono text-[11px] leading-snug text-gray-800 whitespace-pre-wrap break-words">
                                      {auditEmpty ? tCommon('noDataFound') : auditDisplay}
                                    </pre>
                                  </div>
                                </div>
                                {(
                                  [
                                    {
                                      col: 'entry' as const,
                                      title: t('detail.entryRequestBody'),
                                      raw: log.request_body,
                                    },
                                    {
                                      col: 'upstream' as const,
                                      title: t('detail.upstreamRequestBody'),
                                      raw: log.upstream_request_body,
                                    },
                                    {
                                      col: 'usage' as const,
                                      title: t('detail.upstreamUsageRaw'),
                                      raw: log.raw_usage,
                                    },
                                  ] as const
                                ).map(({ col, title, raw }) => {
                                  const display = prettifyLogJson(raw);
                                  const empty = !display;
                                  return (
                                    <div
                                      key={col}
                                      className="min-w-0 flex h-[28rem] flex-col overflow-hidden rounded-md border border-gray-200"
                                    >
                                      <div className="px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-2 shrink-0">
                                        <span className="text-xs font-medium text-gray-700">{title}</span>
                                        <button
                                          type="button"
                                          disabled={empty}
                                          onClick={() => copyColumn(raw, col)}
                                          className="px-2 py-0.5 text-[10px] border border-gray-300 rounded text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                        >
                                          {copiedColumn === col ? tCommon('copied') : tCommon('copy')}
                                        </button>
                                      </div>
                                      <pre className="p-2 text-xs text-gray-800 whitespace-pre-wrap break-words min-h-0 overflow-auto font-mono flex-1">
                                        {empty ? tCommon('noDataFound') : display}
                                      </pre>
                                    </div>
                                  );
                                })}
                              </div>
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
          <div className="text-center py-12 text-gray-500">{tCommon('noLogsFound')}</div>
        )}

        {isLoading && (
          <div className="text-center py-12 text-gray-500">{tCommon('loading')}</div>
        )}
      </div>

      {timingHelpLog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="timing-help-title"
          onClick={() => setTimingHelpLog(null)}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-lg border border-sky-200 bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-sky-100 bg-sky-50 px-4 py-3">
              <h2 id="timing-help-title" className="text-sm font-semibold text-sky-950">
                {t('timing.helpTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setTimingHelpLog(null)}
                className="rounded border border-sky-300 px-2 py-1 text-xs text-sky-950 hover:bg-white"
              >
                {tCommon('close')}
              </button>
            </div>
            <div className="max-h-[80vh] overflow-auto p-4">
              <div className="grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
                <div><span className="font-medium text-gray-950">{t('timing.gateway')}</span>: {t('timing.gatewayDesc')}</div>
                <div><span className="font-medium text-gray-950">{t('timing.upstream')}</span>: {t('timing.upstreamDesc')}</div>
                <div><span className="font-medium text-gray-950">{t('timing.headers')}</span>: {t('timing.headersDesc')}</div>
                <div><span className="font-medium text-gray-950">{t('timing.reasoning')}</span>: {t('timing.reasoningDesc')}</div>
                <div><span className="font-medium text-gray-950">{t('timing.ttftContent')}</span>: {t('timing.ttftContentDesc')}</div>
                <div><span className="font-medium text-gray-950">{t('timing.stream')}</span>: {t('timing.streamDesc')}</div>
                <div><span className="font-medium text-gray-950">{t('timing.attempts')}</span>: {t('timing.attemptsDesc')}</div>
              </div>
              <pre className="mt-4 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-sky-50 whitespace-pre">
                {timingDiagram(timingHelpLog)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          <button
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
