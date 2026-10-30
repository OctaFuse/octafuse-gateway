'use client';

/**
 * 全站请求日志表：多维筛选、分页；Route 列按入站 / 上游两行展示协议端点、模型 ID、路由组与上游供应商；展开详情使用交互式请求流程与尝试时间线；数据来自 `/api/admin/request-logs`。
 */
import { PricingInfoHint } from '@/components/PricingInfoHint';
import { FilterDisclosure } from '@/components/FilterDisclosure';
import { FilterGroup, FilterRow, FilterSelect, FilterTextInput } from '../components/filter-controls';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import type { GatewayModel, GatewayModelRoute, GatewayProvider, GatewayRequestLog } from '@/lib/types';
import {
  compareRouteGroupsForDisplay,
  normalizeRouteGroup,
  routeGroupBadgeClass,
} from '@/lib/route-group-ui';
import { GATEWAY_TOOLS_PROVIDER_ID } from '@/lib/gateway-tools';
import { proxyToolPath } from '@/lib/invoke-kind';
import { liveProviderPickerLabel, sortProvidersByKindThenName } from '@/lib/provider-kind';
import { UPSTREAM_PROTOCOLS } from '@/lib/upstream-protocol';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { requestLogProtocolPath, requestSurfacePath } from '../routes/route-utils';
import {
  parseGeminiWireAction,
  requestLogFeatureTags,
  type RequestLogFeatureKind,
  type RequestLogFeatureTag,
} from './request-log-display';
import {
  createRangeValue,
  DEFAULT_GATEWAY_TIME_RANGE_PRESET,
  detectRollingPreset,
  type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { formatGatewayMoneyCode, formatGatewayMoneyCodeSigned, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { RequestLogFlow } from './request-log-flow';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

/** `/api/admin/models` 列表项（tags 解析为数组） */
type ModelListItem = Omit<GatewayModel, 'tags'> & { tags: string[] };

export default function GatewayRequestLogsPage() {
  const t = useTranslations('requestLogs');
  const tCommon = useTranslations('common');
  const tOptions = useTranslations('options');
  const tKind = useTranslations('providers.kind');
  const tToken = useTranslations('oauthAccessTokensPage');
  const locale = useLocale();
  const [logs, setLogs] = useState<GatewayRequestLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  /** 同时展开一个请求流程；环节详情由流程组件按需展示。 */
  const [detailLogId, setDetailLogId] = useState<string | null>(null);
  const [timingHelpLog, setTimingHelpLog] = useState<GatewayRequestLog | null>(null);
  const pageSize = 50;
  const { currency: billingCurrency } = useBillingCurrency();
  const { formatDateTime } = useGatewayDateTime();
  const billingCurrencySym = getGatewayCurrencySymbol(billingCurrency);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterUserEmail, setFilterUserEmail] = useState('');
  const [filterApiKeyId, setFilterApiKeyId] = useState('');
  const [filterLogId, setFilterLogId] = useState('');
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
    const logId = params.get('id');
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
    if (logId != null) setFilterLogId(logId);
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
      if (filterLogId) params.append('id', filterLogId);
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
      filterLogId,
      rangeValue.start_date,
      rangeValue.end_date,
      filterRouteGroup,
      filterProtocol,
    ]
  );

  const modelById = useMemo(() => {
    const map = new Map<string, ModelListItem>();
    for (const model of modelCatalog) {
      map.set(model.id, model);
    }
    return map;
  }, [modelCatalog]);

  const providerById = useMemo(() => {
    const map = new Map<string, GatewayProvider>();
    for (const provider of providerCatalog) {
      map.set(provider.id, provider);
    }
    return map;
  }, [providerCatalog]);

  /** 日志只存账号名快照。类型从当前目录补上，显示「类型 · 别名」；目录里没有的账号仍用快照名。 */
  const providerRouteLabel = useCallback((log: GatewayRequestLog): string => {
    const snapshot = log.provider_name?.trim() || '';
    const providerId = log.provider_id?.trim() || '';
    const provider = providerId && providerId !== GATEWAY_TOOLS_PROVIDER_ID
      ? providerById.get(providerId)
      : undefined;
    if (provider) {
      return liveProviderPickerLabel(
        { ...provider, name: snapshot || provider.name },
        locale,
        tKind('custom'),
        snapshot || providerId,
      );
    }
    return snapshot || providerId;
  }, [providerById, locale, tKind]);

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
    const rows = sortProvidersByKindThenName(providerCatalog, locale, tKind('custom')).map((p) => ({
      id: p.id,
      label: liveProviderPickerLabel(p, locale, tKind('custom'), p.id),
    }));
    const ids = new Set(rows.map((r) => r.id));
    if (filterProviderId && !ids.has(filterProviderId)) {
      rows.unshift({
        id: filterProviderId,
        label: `${filterProviderId} (not in catalog)`,
      });
    }
    return rows;
  }, [providerCatalog, filterProviderId, locale, tKind]);

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
      if (filterLogId) params.append('id', filterLogId);
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
    filterLogId,
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

  const renderUsageValue = (value: string, unit: string, title: string) => (
    <div className="leading-tight" title={title}>
      <div className="inline-flex items-baseline gap-1 text-gray-900">
        <span className="tabular-nums">{value}</span>
        <span className="text-[10px] font-medium text-gray-400">{unit}</span>
      </div>
    </div>
  );

  /** 用量：按计费种类展示 Token / 张数 / 秒 / 字符；Token 行在有 cache 时补第二行。 */
  const renderUsageCell = (log: GatewayRequestLog) => {
    if (log.billing_kind === 'image_per_image') {
      const inN = log.input_image_count ?? 0;
      const outN = log.output_image_count ?? 0;
      const value = inN > 0 && outN > 0 ? `${inN}×${outN}` : `${inN + outN}`;
      return renderUsageValue(value, t('usage.images'), t('titles.imagePerImageUsage'));
    }
    if (log.billing_kind === 'audio_per_second') {
      const secs = log.audio_duration_seconds;
      const value =
        secs != null && Number.isFinite(secs)
          ? Number(secs).toLocaleString('en-US', { maximumFractionDigits: 3 })
          : '—';
      return renderUsageValue(value, t('usage.seconds'), t('titles.audioPerSecondUsage'));
    }
    if (log.billing_kind === 'audio_per_character') {
      const characters = log.audio_characters;
      const value =
        characters != null && Number.isFinite(characters)
          ? Number(characters).toLocaleString()
          : '—';
      return renderUsageValue(value, t('usage.characters'), t('titles.audioPerCharacterUsage'));
    }
    const hasCache = log.cache_read_tokens > 0 || log.cache_write_tokens > 0;
    return (
      <div className="leading-tight space-y-0.5">
        <div className="inline-flex items-baseline gap-1 text-gray-900" title={t('titles.inputOutputTokens')}>
          <span className="tabular-nums">
            {log.input_tokens} / {log.output_tokens}
          </span>
          <span className="text-[10px] font-medium text-gray-400">{t('usage.tokens')}</span>
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
        <span className="text-[10px] font-medium text-gray-500">{t(label === 'C' ? 'titles.chargedUserBudget' : 'titles.meteredSupplierCost')}</span>
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
    labelClass: string;
    path: string;
    pathTitle?: string;
    modelId: string;
    modelTitle?: string;
    provider?: string;
    providerTitle?: string;
    group?: string;
  }) => (
    <>
      <span className={`self-center text-[10px] font-semibold leading-4 ${opts.labelClass}`}>
        {opts.label}
      </span>
      <span
        className="max-w-[11rem] justify-self-start truncate rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-gray-500 ring-1 ring-inset ring-gray-200/80"
        title={opts.pathTitle || opts.path || undefined}
      >
        {opts.path || '—'}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        {opts.modelId ? (
          <span
            className="min-w-0 truncate font-mono text-[11px] font-medium text-gray-900"
            title={opts.modelTitle || opts.modelId}
          >
            {opts.modelId}
          </span>
        ) : (
          <span className="text-[11px] text-gray-300">—</span>
        )}
        {opts.provider ? (
          <span
            className="inline-flex shrink-0 items-center rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-sky-800 ring-1 ring-inset ring-sky-200/90"
            title={opts.providerTitle || opts.provider}
          >
            {opts.provider}
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

  /** Route 列：入站（协议端点 + model_id + 路由组）/ 上游（协议端点 + 上游 model id + provider）。 */
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
    const upstreamProvider = providerRouteLabel(log);
    const upstreamTitle = isAgentTool
      ? (upstreamModelId ? `Tool engine: ${upstreamModelId}` : undefined)
      : (upstreamModelId ? `Upstream model: ${upstreamModelId}` : undefined);
    const upstreamProviderTitle = upstreamProvider
      ? (log.provider_id?.trim() && log.provider_id.trim() !== upstreamProvider
        ? `Provider: ${upstreamProvider} (${log.provider_id.trim()})`
        : `Provider: ${upstreamProvider}`)
      : undefined;

    return (
      <div className="grid w-max max-w-[40rem] grid-cols-[auto_auto_minmax(0,max-content)] items-center gap-x-1.5 gap-y-1 leading-tight">
        {renderRouteLeg({
          label: t('route.inbound'),
          labelClass: 'text-blue-600',
          path: inboundPath,
          pathTitle: inboundPathTitle,
          modelId: inboundModelId,
          modelTitle: inboundTitle || undefined,
          group: route,
        })}
        {renderRouteLeg({
          label: t('route.upstream'),
          labelClass: 'text-amber-600',
          path: upstreamPath,
          pathTitle: upstreamPathTitle,
          modelId: upstreamModelId,
          modelTitle: upstreamTitle,
          provider: upstreamProvider,
          providerTitle: upstreamProviderTitle,
        })}
      </div>
    );
  };

  const featureKindClass = (kind: RequestLogFeatureKind): string => {
    if (kind === 'image') return 'bg-violet-50 text-violet-700 ring-violet-200';
    if (kind === 'tts') return 'bg-amber-50 text-amber-800 ring-amber-200';
    if (kind === 'asr') return 'bg-orange-50 text-orange-800 ring-orange-200';
    if (kind === 'embedding') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    if (kind === 'tool') return 'bg-indigo-50 text-indigo-700 ring-indigo-200';
    if (kind === 'mcp') return 'bg-teal-50 text-teal-800 ring-teal-200';
    return 'bg-slate-50 text-slate-600 ring-slate-200';
  };

  const featureTagClass = (tag: RequestLogFeatureTag): string => {
    if (tag.key === 'kind') return featureKindClass(tag.kind);
    if (tag.key === 'stream') return 'bg-sky-50 text-sky-700 ring-sky-200';
    if (tag.key === 'realtime') return 'bg-cyan-50 text-cyan-800 ring-cyan-200';
    if (tag.key === 'reasoning') return 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200';
    return 'bg-rose-50 text-rose-700 ring-rose-200';
  };

  const featureTagLabel = (tag: RequestLogFeatureTag): string => {
    if (tag.key === 'kind') return t(`tags.kind.${tag.kind}`);
    return t(`tags.${tag.key}`);
  };

  const renderFeatureTags = (log: GatewayRequestLog) => {
    const catalog = log.model_id ? modelById.get(log.model_id) : undefined;
    const tags = requestLogFeatureTags(log, catalog);
    if (tags.length === 0) return <span className="text-gray-400">—</span>;
    return (
      <div className="flex items-center gap-1 whitespace-nowrap">
        {tags.map((tag) => {
          const key = tag.key === 'kind' ? `kind-${tag.kind}` : tag.key;
          return (
            <span
              key={key}
              className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${featureTagClass(tag)}`}
              title={t(`titles.tag.${tag.key === 'kind' ? tag.kind : tag.key}`)}
            >
              {featureTagLabel(tag)}
            </span>
          );
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
    <div className="min-w-0 p-4 sm:p-6 lg:p-8">
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

      <FilterDisclosure className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3" activeCount={[filterStatus, filterModel, filterProviderId, filterProtocol, filterRouteGroup, filterUserEmail, filterApiKeyId, filterLogId].filter(Boolean).length}>
        <FilterRow>
          <FilterGroup>
            <FilterSelect label={tCommon('status')} value={filterStatus} onChange={(v) => { setFilterStatus(v); setPage(1); }} widthClass="w-28">
              <option value="">{tCommon('all')}</option>
              <option value="success">{tOptions('requestStatus.success')}</option>
              <option value="error">{tOptions('requestStatus.error')}</option>
              <option value="incomplete">{tOptions('requestStatus.incomplete')}</option>
              <option value="cancelled">{tOptions('requestStatus.cancelled')}</option>
            </FilterSelect>
            <FilterSelect label={tCommon('model')} value={filterModel} onChange={(v) => { setFilterModel(v); setPage(1); }} widthClass="w-48">
              <option value="">{tCommon('all')}</option>
              {modelSelectOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect label={tCommon('provider')} value={filterProviderId} onChange={(v) => { setFilterProviderId(v); setPage(1); }} widthClass="w-48">
              <option value="">{tCommon('all')}</option>
              {providerSelectOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect label={t('filters.protocol')} value={filterProtocol} onChange={(v) => { setFilterProtocol(v); setPage(1); }} widthClass="w-32">
              <option value="">{tCommon('all')}</option>
              {UPSTREAM_PROTOCOLS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </FilterSelect>
            <FilterSelect label={t('filters.routeGroup')} value={filterRouteGroup} onChange={(v) => { setFilterRouteGroup(v); setPage(1); }} widthClass="w-36">
              <option value="">{tCommon('all')}</option>
              {routeGroupSelectOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </FilterSelect>
          </FilterGroup>
          <FilterGroup>
            <FilterTextInput label={t('filters.userEmail')} value={filterUserEmail} onChange={(v) => { setFilterUserEmail(v); setPage(1); }} placeholder={t('filters.emailPlaceholder')} />
            <FilterTextInput label={t('filters.apiKeyId')} value={filterApiKeyId} onChange={(v) => { setFilterApiKeyId(v); setPage(1); }} placeholder={t('filters.apiKeyPlaceholder')} />
            <FilterTextInput label={t('filters.requestId')} value={filterLogId} onChange={(v) => { setFilterLogId(v); setPage(1); }} placeholder={t('filters.requestIdPlaceholder')} mono />
          </FilterGroup>
          <button
            type="button"
            onClick={() => { setFilterStatus(''); setFilterModel(''); setFilterProviderId(''); setFilterUserEmail(''); setFilterApiKeyId(''); setFilterLogId(''); setRangeValue({ preset: 'custom', start_date: '', end_date: '' }); setFilterRouteGroup(''); setFilterProtocol(''); setPage(1); }}
            className="text-xs font-medium text-slate-500 hover:text-blue-700"
          >
            {tCommon('clearFilters')}
          </button>
        </FilterRow>
      </FilterDisclosure>

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
      <div className="admin-log-table bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-56 max-w-56 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{t('headers.statusTime')}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{t('headers.userSystem')}</th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider max-w-[40rem]"
                  title={t('titles.route')}
                >
                  {t('headers.route')}
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[9.5rem]"
                  title={t('titles.tags')}
                >
                  {t('headers.tags')}
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  title={t('titles.usage')}
                >
                  {t('headers.usage')}
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap"
                  title={t('titles.cost')}
                >
                  <span className="inline-flex items-center gap-1">{t('headers.cost', { currency: billingCurrencySym })}<PricingInfoHint kind="amounts" /></span>
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap"
                  title={t('titles.profit')}
                >
                  <span className="inline-flex items-center gap-1">{t('headers.profit', { currency: billingCurrencySym })}<PricingInfoHint kind="profit" /></span>
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
                    <td className="w-56 max-w-56 px-3 py-2 text-xs text-gray-600 leading-tight">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 ${statusSwatchClass(log.status)}`}
                          title={log.status}
                          role="img"
                          aria-label={`Status: ${log.status}`}
                        />
                        <div className="min-w-0">
                          <div className="truncate tabular-nums" title={formatDate(log.created_at)}>
                            {formatDate(log.created_at)}
                          </div>
                          <div
                            className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-gray-400 tabular-nums"
                            title={formatTtftListLine(log).title ?? (log.first_token_ms != null ? `TTFT ${formatLatencyMs(log.first_token_ms)}` : undefined)}
                          >
                            <span className="shrink-0">{formatLatencyMs(log.latency_ms)}</span>
                            <span aria-hidden>·</span>
                            <span className="truncate">{formatTtftListLine(log).text}</span>
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
                          className="mt-1 truncate text-[11px] leading-snug text-red-600"
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
                    <td className="px-3 py-2 text-xs max-w-[40rem]">
                      {renderRouteCell(log)}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {renderFeatureTags(log)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 leading-tight">
                      {renderUsageCell(log)}
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
                        <div className="admin-log-detail rounded-md border border-gray-200 bg-white">
                          <RequestLogFlow
                            key={log.id}
                            log={log}
                            providerLabel={providerRouteLabel(log)}
                            identityLabel={[
                              log.user_email,
                              log.api_key_id ?? (log.oauth_access_token_id
                                ? log.oauth_access_token_name
                                  ? tToken('logCredential', { name: log.oauth_access_token_name })
                                  : tToken('logCredentialUnknown', { id: log.oauth_access_token_id })
                                : null),
                            ].filter(Boolean).join(' · ')}
                            currency={billingCurrency}
                            onExplainTiming={() => setTimingHelpLog(log)}
                          />
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
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
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
