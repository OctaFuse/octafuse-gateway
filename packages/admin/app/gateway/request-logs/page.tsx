'use client';

import { MultiplierBadge } from '@/components/financial-value';

import { AdminContentMark } from '@/components/admin-content-mark';

import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * 全站请求日志表：模型请求与工具调用（REST 工具、MCP）共用一张表，按类型等多维筛选、分页；Route 列按入站 / 上游两行展示协议端点、模型 ID、路由组与上游供应商；展开详情使用交互式请求流程与尝试时间线，工具调用另显示查询与响应摘要；数据来自 `/api/admin/request-logs`。
 */
import { PricingInfoHint } from '@/components/PricingInfoHint';
import Link from 'next/link';
import { AdaptiveFilterGroup } from '@/components/adaptive-filter-group';
import {
	GroupedFilterPicker,
	groupedFilterCatalog,
	groupedFilterLabeler,
	type GroupedFilterGroup,
} from '@/components/grouped-filter-picker';
import { useAdminDialog } from '@/components/use-admin-dialog';
import { useFeedback } from '@/components/feedback';
import { useBusinessTimezoneContext } from '@/components/BusinessTimezoneProvider';
import { LogRangeControl } from './log-range-control';
import { readRequestLogFilters, requestLogDuration, requestLogQuery } from './request-log-query';
import { dashboardErrorSummary } from '@/components/dashboard/dashboard-presentation';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
	ArrowUpIcon,
	ArrowDownLeftIcon,
	ArrowUpRightIcon,
	ArrowPathRoundedSquareIcon,
	BoltIcon,
	ChatBubbleLeftRightIcon,
	CheckCircleIcon,
	CircleStackIcon,
	CpuChipIcon,
	ExclamationCircleIcon,
	MicrophoneIcon,
	NoSymbolIcon,
	PhotoIcon,
	SignalIcon,
	SpeakerWaveIcon,
	Squares2X2Icon,
	WrenchScrewdriverIcon,
	XCircleIcon,
	ChevronRightIcon,
	ClipboardDocumentIcon,
	ClockIcon,
	MagnifyingGlassIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import type { GatewayModel, GatewayModelRoute, GatewayProvider, GatewayRequestLog } from '@/lib/types';
import { compareRouteGroupsForDisplay, normalizeRouteGroup } from '@/lib/route-group-ui';
import { findGatewayToolById, GATEWAY_TOOLS_PROVIDER_ID } from '@/lib/gateway-tools';
import {
	EMPTY_GROUPED_SELECTION,
	groupedSelectionNodes,
	isEmptyGroupedSelection,
	toggleGroupedGroup,
	toggleGroupedItem,
	type GroupedSelection,
	type GroupedSelectionNode,
} from '@/lib/grouped-selection';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import {
	isInvocationModelId,
	MAX_REQUEST_LOG_FILTER_IDS,
	modelFilterFitsKinds,
	requestLogKindDisplayNodes,
	requestLogKindScope,
	selectedModelKinds,
	toggleRequestLogKind,
} from '@/lib/request-log-kind';
import { resolveModelKind } from '@octafuse/core/db/model-kind';
import {
	parseMcpInvocationSummary,
	parseToolRequestSummary,
	resolveInvocationSource,
	resolveToolEngineProvider,
} from '@/lib/tool-invocation-detail';
import {
	liveProviderPickerLabel,
	providerKindDisplayLabel,
	providerKindFilterKey,
	sortProvidersByKindThenName,
	UNCLASSIFIED_PROVIDER_KIND_FILTER,
} from '@/lib/provider-kind';
import { UPSTREAM_PROTOCOLS } from '@/lib/upstream-protocol';
import { requestLogProtocolPath, requestSurfacePath } from '../routes/route-utils';
import {
	parseGeminiWireAction,
	requestLogFeatureTags,
	type RequestLogFeatureTag,
} from './request-log-display';
import {
	createRangeValue,
	DEFAULT_GATEWAY_TIME_RANGE_PRESET,
	type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { formatGatewayMoneyCode, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { RequestLogFlow } from './request-log-flow';
import { RequestLogInvocation } from './request-log-invocation';
import { RequestLogKindPicker, useRequestLogKindTree } from './request-log-kind-picker';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { AutoRefreshControl } from '@/components/AutoRefreshControl';
import { REQUEST_LOG_REFRESH_INTERVAL_OPTIONS, requestLogRefreshPreference } from '@/lib/auto-refresh-preference';
import { useRequestLogFeed } from './use-request-log-feed';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import tableStyles from './request-log-table.module.css';
import { formatRequestCostMultiplier, requestLogUsageMetrics, type UsageMetric } from './request-log-values';

/** `/api/admin/models` 列表项（tags 解析为数组） */
type ModelListItem = Omit<GatewayModel, 'tags'> & { tags: string[] };

const byLabel = (a: { label: string }, b: { label: string }) =>
	a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

/**
 * 「模型」筛选的两级目录：厂商 → 模型。`kinds` 给了就只列这几类模型（类型筛选只选了某几类模型时）。
 * 厂商按名称排序，「其他」排最后。
 */
function buildModelGroups(catalog: readonly ModelListItem[], kinds: readonly string[] | null): GroupedFilterGroup[] {
	const byVendor = new Map<string, GroupedFilterGroup['items']>();
	for (const model of catalog) {
		if (kinds !== null && !kinds.includes(resolveModelKind(model))) continue;
		const vendor = normalizeModelVendorInput(model.vendor);
		const label = model.display_name?.trim() || model.id;
		const items = byVendor.get(vendor) ?? [];
		items.push({ id: model.id, label, title: label === model.id ? undefined : model.id });
		byVendor.set(vendor, items);
	}
	return [...byVendor.entries()]
		.map(([id, items]) => ({ id, label: getModelVendorLabel(id), items: items.sort(byLabel) }))
		.sort((a, b) => Number(a.id === 'other') - Number(b.id === 'other') || byLabel(a, b));
}

export default function GatewayRequestLogsPage() {
	const t = useTranslations('requestLogs');
	const tCommon = useTranslations('common');
	const tDashboard = useTranslations('dashboard');
	const tOptions = useTranslations('options');
	const tKind = useTranslations('providers.kind');
	const tToolCatalog = useTranslations('tools.catalog');
	const tToken = useTranslations('oauthAccessTokensPage');
	const locale = useLocale();
	const [page, setPage] = useState(1);
	/** 同时展开一个请求流程；环节详情由流程组件按需展示。 */
	const [detailLog, setDetailLog] = useState<GatewayRequestLog | null>(null);
	const [timingHelpLog, setTimingHelpLog] = useState<GatewayRequestLog | null>(null);
	const [rangeDialogOpen, setRangeDialogOpen] = useState(false);
	const [filterDialogOpen, setFilterDialogOpen] = useState(false);
	const pageSize = 50;
	const { currency: billingCurrency } = useBillingCurrency();
	const { businessTimezone, formatDate: formatShortDate, formatTime } = useGatewayDateTime();
	const { isLoading: timezoneLoading } = useBusinessTimezoneContext();
	const { notify } = useFeedback();
	const [filtersReady, setFiltersReady] = useState(false);
	const detailRef = useAdminDialog(Boolean(detailLog), false, () => setDetailLog(null));
	const timingRef = useAdminDialog(Boolean(timingHelpLog), false, () => setTimingHelpLog(null));
	const billingCurrencySym = getGatewayCurrencySymbol(billingCurrency);

	// Filters
	/** 类型多选（`kinds`）。空数组表示不限类型。 */
	const [filterKinds, setFilterKinds] = useState<string[]>([]);
	const [filterStatus, setFilterStatus] = useState('');
	/** 模型多选：`groups` 是厂商，`items` 是模型。 */
	const [filterModels, setFilterModels] = useState<GroupedSelection>(EMPTY_GROUPED_SELECTION);
	/** 供应商多选：`groups` 是供应商类型，`items` 是供应商。 */
	const [filterProviders, setFilterProviders] = useState<GroupedSelection>(EMPTY_GROUPED_SELECTION);
	/** 链接带来的具体工具（`tool:*` / `mcp:{slug}/{tool}`），筛选栏里没有对应的选择框，用标签显示。 */
	const [filterInvocationModel, setFilterInvocationModel] = useState('');
	const [filterUserEmail, setFilterUserEmail] = useState('');
	const [filterApiKeyId, setFilterApiKeyId] = useState('');
	const [filterLogId, setFilterLogId] = useState('');
	const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() =>
		createRangeValue(DEFAULT_GATEWAY_TIME_RANGE_PRESET, businessTimezone)
	);
	const [filterModelPrefix, setFilterModelPrefix] = useState('');
	const remaining = useTranslations('remainingUi');
	const [filterRouteGroup, setFilterRouteGroup] = useState('');
	const [filterProtocol, setFilterProtocol] = useState('');

	const [modelCatalog, setModelCatalog] = useState<ModelListItem[]>([]);
	const [providerCatalog, setProviderCatalog] = useState<GatewayProvider[]>([]);
	const [routesCatalog, setRoutesCatalog] = useState<GatewayModelRoute[]>([]);
	/** MCP 服务只在类型面板里用到：打开面板或已选了某个 MCP 服务时再取。`null` 表示还没取到。 */
	const [mcpServers, setMcpServers] = useState<{ slug: string; name: string }[] | null>(null);
	const mcpServersRequested = useRef(false);
	const [kindPickerOpened, setKindPickerOpened] = useState(false);
	const wantMcpServers = kindPickerOpened || filterKinds.some((term) => term.startsWith('mcp:'));

	useEffect(() => {
		if (!wantMcpServers || mcpServersRequested.current) return;
		mcpServersRequested.current = true;
		let cancelled = false;
		(async () => {
			try {
				const data = await readApiJson<{ slug: string; name: string }[]>(await fetch('/api/admin/mcp-servers'));
				if (cancelled) return;
				setMcpServers(data.success && data.data ? data.data.map(({ slug, name }) => ({ slug, name })) : []);
			} catch (e) {
				console.error('Fetch MCP servers for filters:', e);
				if (!cancelled) setMcpServers([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [wantMcpServers]);

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
		if (timezoneLoading || filtersReady) return;
		let cancelled = false;
		// Restore external URL state after hydration, once the business timezone is available.
		queueMicrotask(() => {
			if (cancelled) return;
			const filters = readRequestLogFilters(window.location.search, businessTimezone);
			setPage(filters.page);
			setFilterKinds(filters.kinds);
			setFilterStatus(filters.status);
			setFilterModels(filters.models);
			setFilterProviders(filters.providers);
			setFilterInvocationModel(filters.invocationModel);
			setFilterModelPrefix(filters.modelPrefix ?? '');
			setFilterUserEmail(filters.email);
			setFilterApiKeyId(filters.apiKey);
			setFilterLogId(filters.requestId);
			setFilterRouteGroup(filters.routeGroup);
			setFilterProtocol(filters.protocol);
			setRangeValue(filters.range);
			setFiltersReady(true);
		});
		return () => { cancelled = true; };
	}, [timezoneLoading, filtersReady, businessTimezone]);

	const query = useMemo(
		() =>
			requestLogQuery({
				page,
				kinds: filterKinds,
				status: filterStatus,
				models: filterModels,
				providers: filterProviders,
				invocationModel: filterInvocationModel,
				modelPrefix: filterModelPrefix,
				email: filterUserEmail,
				apiKey: filterApiKeyId,
				requestId: filterLogId,
				routeGroup: filterRouteGroup,
				protocol: filterProtocol,
				range: rangeValue,
			}),
		[
			page,
			filterKinds,
			filterStatus,
			filterModels,
			filterProviders,
			filterInvocationModel,
			filterModelPrefix,
			filterUserEmail,
			filterApiKeyId,
			filterLogId,
			filterRouteGroup,
			filterProtocol,
			rangeValue,
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
	const providerRouteLabel = useCallback(
		(log: GatewayRequestLog): string => {
			const snapshot = log.provider_name?.trim() || '';
			const providerId = log.provider_id?.trim() || '';
			const provider =
				providerId && providerId !== GATEWAY_TOOLS_PROVIDER_ID ? providerById.get(providerId) : undefined;
			if (provider) {
				return liveProviderPickerLabel(
					{ ...provider, name: snapshot || provider.name },
					locale,
					tKind('custom'),
					snapshot || providerId
				);
			}
			return snapshot || providerId;
		},
		[providerById, locale, tKind]
	);

	const kindTree = useRequestLogKindTree(filterKinds, mcpServers);
	const kindScope = requestLogKindScope(filterKinds);

	const staleLabel = useCallback((value: string) => t('ui.notInCatalog', { value }), [t]);

	/** 厂商 → 模型。类型只选了某几类模型时，只列这几类。 */
	const modelGroups = useMemo(
		() => buildModelGroups(modelCatalog, selectedModelKinds(filterKinds)),
		[modelCatalog, filterKinds],
	);

	/** 供应商类型 → 供应商。类型按名称排序，未分类排最后。 */
	const providerGroups = useMemo(() => {
		const groups = new Map<string, GroupedFilterGroup>();
		for (const provider of sortProvidersByKindThenName(providerCatalog, locale, tKind('custom'))) {
			const key = providerKindFilterKey(provider.kind);
			const group = groups.get(key) ?? {
				id: key,
				label:
					key === UNCLASSIFIED_PROVIDER_KIND_FILTER
						? tKind('unclassified')
						: providerKindDisplayLabel(provider, locale, tKind('custom')) || key,
				items: [],
			};
			const label = provider.name?.trim() || provider.id;
			group.items.push({ id: provider.id, label, title: label === provider.id ? undefined : provider.id });
			groups.set(key, group);
		}
		return [...groups.values()];
	}, [providerCatalog, locale, tKind]);

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
			rows.unshift({ value: fg, label: t('ui.notInRoutes', { value: fg }) });
		}
		return rows;
	}, [routesCatalog, filterRouteGroup, t]);

	const pausedHint = page > 1 ? t('live.pausedPage')
		: detailLog || timingHelpLog || rangeDialogOpen || filterDialogOpen ? t('live.pausedDialog')
		: rangeValue.preset === 'custom' && rangeValue.end_date ? t('live.pausedRange') : undefined;
	const { logs, total, isLoading, error: listError, tableRef, intervalMs, refreshState, fetchLogs,
		applyPending, pendingCount, newCount } = useRequestLogFeed({ query: query.toString(), preset: rangeValue.preset,
		timeZone: businessTimezone, ready: filtersReady, paused: Boolean(pausedHint), errorMessage: t('ui.loadFailed') });

	const totalPages = Math.ceil(total / pageSize);

	const formatLatencyMs = requestLogDuration;

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
				`                                                                  | Reasoning ${
					reasoningPhaseMs ?? reasoningTtft
				}`,
				`                                                                  |<---- ${t(
					'timing.reasoningPhase'
				)} ---->|`
			);
		} else {
			lines.push('                                                                  |');
		}
		lines.push(
			`                                                                  | Stream ${stream}`,
			`                                                                  |<------ ${t(
				'timing.contentPhase'
			)} ------>|`
		);
		if (hasReasoning) {
			lines.push(`  |<-------- ${t('timing.ttftReasoningBracket')} ${reasoningTtft} -------->|`);
		}
		if (log.first_token_ms != null) {
			lines.push(
				`  |<--------------------- ${t('timing.ttftContent')} ${contentTtft} --------------------->|`
			);
		} else if (!hasReasoning) {
			lines.push(`  |<------------------------- TTFT ${contentTtft} ---------------------->|`);
		}
		lines.push(
			'',
			`Attempts: ${log.upstream_attempt_count ?? '-'} / failover ${log.upstream_failover_count ?? '-'}`
		);
		return lines.join('\n');
	};

	const formatTtftListLine = (log: GatewayRequestLog): { text: string; title?: string } => {
		if (log.first_reasoning_token_ms != null) {
			const text = t('timing.listReasoning', { ms: formatLatencyMs(log.first_reasoning_token_ms) });
			const title =
				log.first_token_ms != null
					? t('timing.listContentTtftTitle', { ms: formatLatencyMs(log.first_token_ms) })
					: undefined;
			return { text, title: [t('timing.reasoningDesc'), title].filter(Boolean).join(' · ') };
		}
		if (log.first_token_ms != null) {
			return {
				text: `TTFT ${formatLatencyMs(log.first_token_ms)}`,
				title: t('timing.ttftContentDesc'),
			};
		}
		if (log.upstream_response_ms != null) {
			return {
				text: t('ui.upstreamLatency', { time: formatLatencyMs(log.upstream_response_ms) }),
				title: t('timing.upstreamDesc'),
			};
		}
		return { text: '\u00A0' };
	};

	const formatCostMultiplier = (cost: number, standardCost: number) =>
		formatRequestCostMultiplier(cost, standardCost, locale);

	const usagePresentation = (key: UsageMetric['key']) => {
		switch (key) {
			case 'input': case 'inputImages': return { Icon: ArrowDownLeftIcon, tone: tableStyles.input };
			case 'output': case 'outputImages': return { Icon: ArrowUpRightIcon, tone: tableStyles.output };
			case 'cacheRead': return { Icon: CircleStackIcon, tone: tableStyles.cacheRead };
			case 'cacheWrite': return { Icon: ArrowUpIcon, tone: tableStyles.cacheWrite };
			case 'reasoning': return { Icon: CpuChipIcon, tone: tableStyles.cacheWrite };
			case 'seconds': return { Icon: MicrophoneIcon, tone: 'text-gray-500' };
			case 'characters': return { Icon: SpeakerWaveIcon, tone: 'text-gray-500' };
			default: return { Icon: Squares2X2Icon, tone: 'text-gray-500' };
		}
	};

	const renderUsageCell = (log: GatewayRequestLog) => {
		const metrics = requestLogUsageMetrics(log, {
			catalogModel: log.model_id ? modelById.get(log.model_id) : undefined,
		});
		if (!metrics.length) return (
			<span className="inline-flex items-center gap-1.5 text-gray-400" title={t('usage.noTokens')} aria-label={t('usage.noTokens')}>
				<WrenchScrewdriverIcon className="h-3.5 w-3.5" aria-hidden="true" />—
			</span>
		);
		return (
			<div className={tableStyles.usage}>
				<div className={metrics.length === 1 ? tableStyles.singleMetric : tableStyles.tokenGrid}>
					{metrics.map(({ key, field, value, unit, inputTotal }) => {
						const { Icon, tone } = usagePresentation(key);
						const valid = value != null && Number.isFinite(value);
						const exact = valid ? value.toLocaleString(locale, { maximumFractionDigits: 3 }) : '—';
						const label = field === 'uncachedInputTokens'
							? `${t('flow.uncachedInputTokens')}: ${exact}\n${t('titles.billableInput', {
								input: inputTotal == null ? '—' : inputTotal.toLocaleString(locale),
								read: (log.cache_read_tokens ?? 0).toLocaleString(locale),
								write: (log.cache_write_tokens ?? 0).toLocaleString(locale),
							})}`
							: `${t(`flow.${field}`)}: ${exact}`;
						const display = valid ? unit === 'tokens'
							? value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
							: exact : '—';
						return (
							<span key={key} className={`${tableStyles.metric} ${tone}`} style={key === 'cacheWrite' ? { gridColumn: 2 } : undefined} title={label} aria-label={label}>
								<Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
								{unit !== 'seconds' && unit !== 'characters' && <span className={tableStyles.metricLabel}>{t(`usage.${key}`)}</span>}
								<span className={tableStyles.value}>{display}</span>
								{unit !== 'tokens' && <span className="text-[10px] text-gray-400">{t(`usage.${unit}`)}</span>}
							</span>
						);
					})}
				</div>
			</div>
		);
	};

	const renderCostCell = (standardCost: number, chargedCost: number, meteredCost: number) => (
		<div
			className="grid grid-cols-[auto_auto_auto] justify-end gap-x-1.5 gap-y-1 text-right text-xs tabular-nums"
			title={[
				`${t('titles.standardCatalogPrice')}: ${formatGatewayMoneyCode(standardCost, billingCurrency, 6)}`,
				`${t('titles.chargedUserBudget')}: ${formatCostMultiplier(chargedCost, standardCost) || '—'}`,
				`${t('titles.meteredSupplierCost')}: ${formatCostMultiplier(meteredCost, standardCost) || '—'}`,
			].join('\n')}
		>
			{[
				{
					id: 'charged',
					amount: chargedCost,
					label: t('ui.charged'),
					tone: 'text-gray-900',
					hint: t('ui.chargedFactor'),
				},
				{
					id: 'metered',
					amount: meteredCost,
					label: t('ui.metered'),
					tone: 'text-gray-500',
					hint: t('ui.meteredFactor'),
				},
			].map((row) => (
				<Fragment key={row.id}>
					<span className="self-baseline text-gray-500">{row.label}</span>
					<span className={`self-baseline whitespace-nowrap font-mono font-medium ${row.tone}`}>
						{formatGatewayMoneyCode(row.amount, billingCurrency, 6)}
					</span>
					<span
						className="min-w-12 self-baseline whitespace-nowrap text-right text-[11px] text-gray-400"
						title={row.hint}
					>
						{formatCostMultiplier(row.amount, standardCost) ? (
							<MultiplierBadge compact title={row.hint}>
								{formatCostMultiplier(row.amount, standardCost)}
							</MultiplierBadge>
						) : (
							'—'
						)}
					</span>
				</Fragment>
			))}
		</div>
	);

	/** 工具调用没有模型路由：第一行是工具名，第二行是引擎与查询（MCP 为参数摘要）。 */
	const renderInvocationCell = (log: GatewayRequestLog, source: 'rest' | 'mcp') => {
		let name: string;
		let detail: string;
		if (source === 'mcp') {
			const summary = parseMcpInvocationSummary(log);
			name = summary.label;
			detail = summary.argumentSummary ?? '';
		} else {
			const tool = findGatewayToolById(log.model_id);
			name = tool ? tToolCatalog(tool.nameKey) : log.model_name?.trim() || log.model_id || '—';
			detail = [resolveToolEngineProvider(log), parseToolRequestSummary(log.request_body).query]
				.filter(Boolean)
				.join(' · ');
		}
		return (
			<div className="min-w-0 space-y-1">
				<div className="truncate text-sm font-medium text-gray-900" title={log.model_id || undefined}>
					{name}
				</div>
				<div className="truncate text-xs text-gray-500" title={detail || undefined}>
					{detail || '—'}
				</div>
				{renderFeatureTags(log)}
			</div>
		);
	};

	const renderRouteCell = (log: GatewayRequestLog) => {
		const invocationSource = resolveInvocationSource(log);
		if (invocationSource) return renderInvocationCell(log, invocationSource);
		const name = log.model_name?.trim() || log.model_id || '—';
		const route = normalizeRouteGroup(log.route_group);
		const protocol = log.request_protocol || log.upstream_protocol;
		const operation = log.request_operation || log.upstream_operation;
		const endpoint = protocol ? requestLogProtocolPath(protocol, operation || '*') : '';
		const upstream = log.upstream_protocol
			? requestLogProtocolPath(log.upstream_protocol, log.upstream_operation || '*')
			: '';
		const geminiAction = parseGeminiWireAction(log.route_trace);
		const title = [
			log.model_id,
			endpoint,
			log.provider_model_name,
			upstream,
			protocol === 'gemini' && geminiAction
				? requestSurfacePath(protocol, geminiAction, log.model_id || undefined)
				: '',
		]
			.filter(Boolean)
			.join(' · ');
		return (
			<div className="min-w-0 space-y-1">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-sm font-medium text-gray-900" title={title}>
						{name}
					</span>
					<span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500">
						{route}
					</span>
				</div>
				<div className="truncate text-xs text-gray-500" title={title}>
					{providerRouteLabel(log) || '—'}
					{log.provider_model_name && log.provider_model_name !== log.model_id
						? ` · ${log.provider_model_name}`
						: ''}
				</div>
				{renderFeatureTags(log)}
			</div>
		);
	};

	const featureTagPresentation = (tag: RequestLogFeatureTag) => {
		if (tag.key === 'failover')
			return {
				Icon: ArrowPathRoundedSquareIcon,
				tone: 'bg-amber-50 text-amber-700 ring-amber-200/70',
			};
		if (tag.key === 'reasoning')
			return { Icon: CpuChipIcon, tone: 'bg-violet-50 text-violet-700 ring-violet-200/60' };
		if (tag.key === 'stream' || tag.key === 'realtime')
			return {
				Icon: tag.key === 'stream' ? SignalIcon : BoltIcon,
				tone: 'bg-blue-50 text-blue-700 ring-blue-200/60',
			};
		const icons = {
			llm: ChatBubbleLeftRightIcon,
			image: PhotoIcon,
			tts: SpeakerWaveIcon,
			asr: MicrophoneIcon,
			embedding: CircleStackIcon,
			tool: WrenchScrewdriverIcon,
			mcp: Squares2X2Icon,
		};
		return {
			Icon: icons[tag.kind],
			tone:
				tag.kind === 'tool' || tag.kind === 'mcp'
					? 'bg-teal-50 text-teal-700 ring-teal-200/60'
					: 'bg-gray-50 text-gray-600 ring-gray-200/70',
		};
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
			<div className="flex flex-wrap items-center gap-1">
				{tags.map((tag) => {
					const key = tag.key === 'kind' ? `kind-${tag.kind}` : tag.key;
					const { Icon, tone } = featureTagPresentation(tag);
					return (
						<span
							key={key}
							className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
							title={t(`titles.tag.${tag.key === 'kind' ? tag.kind : tag.key}`)}
						>
							<Icon className="h-3 w-3" aria-hidden="true" />
							{featureTagLabel(tag)}
						</span>
					);
				})}
			</div>
		);
	};

	const statusPresentation = (status: string) => {
		if (status === 'success')
			return { Icon: CheckCircleIcon, tone: 'bg-emerald-50 text-emerald-700' };
		if (status === 'error') return { Icon: XCircleIcon, tone: 'bg-red-50 text-red-700' };
		if (status === 'incomplete')
			return { Icon: ExclamationCircleIcon, tone: 'bg-amber-50 text-amber-700' };
		if (status === 'cancelled') return { Icon: NoSymbolIcon, tone: 'bg-gray-100 text-gray-600' };
		return { Icon: ExclamationCircleIcon, tone: 'bg-gray-100 text-gray-600' };
	};
	const statusLabel = (status: string) =>
		['success', 'error', 'incomplete', 'cancelled'].includes(status)
			? tOptions(`requestStatus.${status}`)
			: t('statusOther');
	const renderStatusBadge = (status: string) => {
		const { Icon, tone } = statusPresentation(status);
		return (
			<span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ${tone}`}>
				<Icon className="h-3.5 w-3.5" aria-hidden="true" />
				{statusLabel(status)}
			</span>
		);
	};

	/**
	 * 改类型时一并清掉在新范围里不再适用的筛选：它们与类型按 AND 组合，留着只会一条也查不到。
	 * 模型、供应商、协议、路由组只对模型请求有意义；已选的厂商和模型要在新的模型类型里还选得到。
	 */
	const changeKinds = (kinds: string[]) => {
		const scope = requestLogKindScope(kinds);
		if (!scope.model) {
			setFilterModels(EMPTY_GROUPED_SELECTION);
			setFilterProviders(EMPTY_GROUPED_SELECTION);
			setFilterProtocol('');
			setFilterRouteGroup('');
		} else if (modelCatalog.length > 0) {
			const visible = buildModelGroups(modelCatalog, selectedModelKinds(kinds));
			const vendors = new Set(visible.map((group) => group.id));
			const models = new Set(visible.flatMap((group) => group.items.map((item) => item.id)));
			// 目录里没有的模型（已删除、或链接带来的）判断不了类型，留着。
			setFilterModels((prev) => ({
				groups: prev.groups.filter((vendor) => vendors.has(vendor)),
				items: prev.items.filter((id) => models.has(id) || !modelById.has(id)),
			}));
		}
		if (!modelFilterFitsKinds(filterInvocationModel, kinds)) setFilterInvocationModel('');
		if (!scope.invocation && isInvocationModelId(filterModelPrefix)) setFilterModelPrefix('');
		setFilterKinds(kinds);
		setPage(1);
	};
	/** 单独勾选的模型 / 供应商有个数上限（API 的 `model_ids` / `provider_ids`）；勾选整个分组不占这个额度。 */
	const withinIdLimit = (next: GroupedSelection, prev: GroupedSelection, message: string) => {
		if (next.items.length <= MAX_REQUEST_LOG_FILTER_IDS || next.items.length <= prev.items.length) return true;
		notify('error', message);
		return false;
	};
	const changeModels = (next: GroupedSelection) => {
		if (!withinIdLimit(next, filterModels, t('modelFilter.limit', { max: MAX_REQUEST_LOG_FILTER_IDS }))) return;
		setFilterModels(next);
		setPage(1);
	};
	const changeProviders = (next: GroupedSelection) => {
		if (!withinIdLimit(next, filterProviders, t('providerFilter.limit', { max: MAX_REQUEST_LOG_FILTER_IDS }))) return;
		setFilterProviders(next);
		setPage(1);
	};
	const modelOnlyHint = kindScope.model ? undefined : t('kindFilter.modelOnly');
	// 类型选了多项时筛选栏只显示第一项和数量，用标签把每一项列出来，可单独移除。
	const kindNodes = requestLogKindDisplayNodes(filterKinds);
	const kindChips = (kindNodes.length > 1 ? kindNodes : []).map((node) => ({
		key: `kind:${node}`,
		label: t('kindFilter.label'),
		value: node,
		display: kindTree.labelOf(node),
		clear: () => changeKinds(toggleRequestLogKind(filterKinds, node, false, kindTree.children)),
	}));
	/** 模型、供应商选了多项时同样逐项列出。 */
	const groupedChips = (
		prefix: string,
		label: string,
		groups: GroupedFilterGroup[],
		selection: GroupedSelection,
		change: (next: GroupedSelection) => void,
	) => {
		const catalog = groupedFilterCatalog(groups);
		const labelOf = groupedFilterLabeler(groups, staleLabel);
		const nodes = groupedSelectionNodes(selection, catalog);
		const remove = (node: GroupedSelectionNode) =>
			node.type === 'group'
				? toggleGroupedGroup(selection, node.id, false, catalog)
				: toggleGroupedItem(selection, node.id, false, catalog);
		return (nodes.length > 1 ? nodes : []).map((node) => ({
			key: `${prefix}:${node.type}:${node.id}`,
			label,
			value: node.id,
			display: labelOf(node),
			clear: () => change(remove(node)),
		}));
	};
	const modelChips = groupedChips('model', tCommon('model'), modelGroups, filterModels, changeModels);
	const providerChips = groupedChips('provider', tCommon('provider'), providerGroups, filterProviders, changeProviders);
	// 链接带来的具体工具（如某个 MCP 工具）没有对应的选择框，用标签显示并允许移除。
	const advancedFilters = [
		{
			label: t('kindFilter.toolChip'),
			value: filterInvocationModel,
			display: filterInvocationModel.replace(/^(tool|mcp):/, ''),
			clear: () => setFilterInvocationModel(''),
		},
		{ label: remaining('modelPrefix'), value: filterModelPrefix, clear: () => setFilterModelPrefix('') },
		{ label: t('filters.protocol'), value: filterProtocol, clear: () => setFilterProtocol('') },
		{
			label: t('filters.routeGroup'),
			value: filterRouteGroup,
			clear: () => setFilterRouteGroup(''),
		},
		{ label: t('filters.apiKeyId'), value: filterApiKeyId, clear: () => setFilterApiKeyId('') },
		{ label: t('filters.requestId'), value: filterLogId, clear: () => setFilterLogId('') },
	].filter((item) => item.value);
	const filterChips = [
		...kindChips,
		...modelChips,
		...providerChips,
		...advancedFilters.map((item) => ({ ...item, key: item.label })),
	];
	const hasFilters = Boolean(
		filterKinds.length ||
			filterStatus ||
			!isEmptyGroupedSelection(filterModels) ||
			!isEmptyGroupedSelection(filterProviders) ||
			filterUserEmail ||
			advancedFilters.length
	);
	const clearFilters = () => {
		setFilterKinds([]);
		setFilterStatus('');
		setFilterModels(EMPTY_GROUPED_SELECTION);
		setFilterProviders(EMPTY_GROUPED_SELECTION);
		setFilterInvocationModel('');
		setFilterModelPrefix('');
		setFilterUserEmail('');
		setFilterApiKeyId('');
		setFilterLogId('');
		setFilterRouteGroup('');
		setFilterProtocol('');
		setRangeValue({ preset: 'custom', start_date: '', end_date: '' });
		setPage(1);
	};
	const selectClass = 'h-10 min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-600';
	/** 常驻筛选项与「更多筛选」里的项用同一种标题：选中值后仍能看出是哪个筛选。 */
	const fieldClass = 'block min-w-0 space-y-2 text-xs text-gray-500';
	const detailInvocationSource = detailLog ? resolveInvocationSource(detailLog) : null;
	// 调用方：用户邮箱 + 凭据（API Key，或 MCP 的 OAuth 授权应用）。
	const detailIdentityLabel = detailLog
		? [
				detailLog.user_email,
				detailLog.api_key_id ??
					(detailLog.oauth_access_token_id
						? detailLog.oauth_access_token_name
							? tToken('logCredential', { name: detailLog.oauth_access_token_name })
							: tToken('logCredentialUnknown', { id: detailLog.oauth_access_token_id })
						: null),
			]
				.filter(Boolean)
				.join(' · ')
		: '';
	const copyId = async (id: string) => {
		try {
			await navigator.clipboard.writeText(id);
			notify('success', tCommon('copied'));
		} catch {
			notify('error', t('flow.copyFailed'));
		}
	};

	return (
		<div className="admin-content-workspace content-tone-inference min-h-full min-w-0 p-4 sm:p-6 lg:p-8">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<AdminPageTitle>{t('title')}</AdminPageTitle>
					<p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
				</div>
				<div className="flex max-w-full flex-wrap items-center gap-2">
					<LogRangeControl
						onOpenChange={setRangeDialogOpen}
						value={rangeValue}
						timeZone={businessTimezone}
						onChange={(range) => {
							setRangeValue(range);
							setPage(1);
						}}
					/>
					<AutoRefreshControl {...refreshState} intervalMs={intervalMs} intervalOptions={REQUEST_LOG_REFRESH_INTERVAL_OPTIONS}
						onIntervalChange={requestLogRefreshPreference.write} refresh={refreshState.refreshNow} pausedHint={pausedHint}
						disabled={!filtersReady || isLoading} label={t('live.refreshLabel')} refreshLabel={t('ui.refresh')} />
				</div>
			</div>

			<section aria-label={t('ui.filters')} className="admin-filter-surface mb-5 space-y-3">
				<div className="flex flex-wrap items-end gap-3">
					<label className={`${fieldClass} flex-1 basis-60 sm:max-w-xs`}>
						{t('filters.userEmail')}
						<div className="relative">
							<MagnifyingGlassIcon
								className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
								aria-hidden
							/>
							<input
								type="search"
								value={filterUserEmail}
								onChange={(e) => {
									setFilterUserEmail(e.target.value);
									setPage(1);
								}}
								placeholder={t('filters.emailPlaceholder')}
								className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900"
							/>
						</div>
					</label>
					<label className={`${fieldClass} w-32`}>
						{tCommon('status')}
						<select
							value={filterStatus}
							onChange={(e) => {
								setFilterStatus(e.target.value);
								setPage(1);
							}}
							className={`${selectClass} block w-full`}
						>
							<option value="">{t('ui.allStatuses')}</option>
							{['success', 'error', 'incomplete', 'cancelled'].map((status) => (
								<option key={status} value={status}>
									{tOptions(`requestStatus.${status}`)}
								</option>
							))}
						</select>
					</label>
					<RequestLogKindPicker
						className="w-44"
						value={filterKinds}
						tree={kindTree}
						onChange={changeKinds}
						onOpen={() => setKindPickerOpened(true)}
					/>
					<GroupedFilterPicker
						className="w-52 max-w-full"
						label={tCommon('model')}
						emptyLabel={t('ui.allModels')}
						clearLabel={t('modelFilter.clear')}
						hint={t('modelFilter.hint')}
						search={{ placeholder: t('modelFilter.search'), empty: t('modelFilter.empty') }}
						groups={modelGroups}
						value={filterModels}
						onChange={changeModels}
						staleLabel={staleLabel}
						disabled={!kindScope.model}
						title={modelOnlyHint}
					/>
					<GroupedFilterPicker
						className="w-52 max-w-full"
						label={tCommon('provider')}
						emptyLabel={t('providerFilter.all')}
						clearLabel={t('providerFilter.clear')}
						hint={t('providerFilter.hint')}
						search={{ placeholder: t('providerFilter.search'), empty: t('providerFilter.empty') }}
						groups={providerGroups}
						value={filterProviders}
						onChange={changeProviders}
						staleLabel={staleLabel}
						disabled={!kindScope.model}
						title={modelOnlyHint}
					/>
					<AdaptiveFilterGroup
						onOpenChange={setFilterDialogOpen}
						label={t('ui.moreFilters')}
						activeCount={advancedFilters.length}
						extraCount={advancedFilters.length - [filterProtocol, filterRouteGroup].filter(Boolean).length}
						inlineAt={1440}
						extra={<>
						<label className="block space-y-2 text-xs text-gray-500">
							{t('filters.apiKeyId')}
							<input
								value={filterApiKeyId}
								onChange={(e) => {
									setFilterApiKeyId(e.target.value);
									setPage(1);
								}}
								placeholder={t('filters.apiKeyPlaceholder')}
								className={`${selectClass} block w-full font-mono text-xs`}
							/>
						</label>
						<label className="block space-y-2 text-xs text-gray-500">
							{t('filters.requestId')}
							<input
								value={filterLogId}
								onChange={(e) => {
									setFilterLogId(e.target.value);
									setPage(1);
								}}
								placeholder={t('filters.requestIdPlaceholder')}
								className={`${selectClass} block w-full font-mono text-xs`}
							/>
						</label></>}
					>
						<label className="admin-adaptive-field block space-y-2 text-xs text-gray-500" title={modelOnlyHint}>
							{t('filters.protocol')}
							<select
								value={filterProtocol}
								disabled={!kindScope.model}
								onChange={(e) => {
									setFilterProtocol(e.target.value);
									setPage(1);
								}}
								className={`${selectClass} block w-full disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400`}
							>
								<option value="">{tCommon('all')}</option>
								{UPSTREAM_PROTOCOLS.map((protocol) => (
									<option key={protocol} value={protocol}>
										{protocol}
									</option>
								))}
							</select>
						</label>
						<label className="admin-adaptive-field block space-y-2 text-xs text-gray-500" title={modelOnlyHint}>
							{t('filters.routeGroup')}
							<select
								value={filterRouteGroup}
								disabled={!kindScope.model}
								onChange={(e) => {
									setFilterRouteGroup(e.target.value);
									setPage(1);
								}}
								className={`${selectClass} block w-full disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400`}
							>
								<option value="">{tCommon('all')}</option>
								{routeGroupSelectOptions.map((item) => (
									<option key={item.value} value={item.value}>
										{item.label}
									</option>
								))}
							</select>
						</label>
					</AdaptiveFilterGroup>
					{hasFilters && (
						<button
							type="button"
							onClick={clearFilters}
							className="text-xs text-gray-500 hover:text-gray-950"
						>
							{tCommon('clearFilters')}
						</button>
					)}
					<span role="status" aria-live="polite" className="ml-auto text-xs tabular-nums text-gray-500">
						{t('totalRequests', { count: total })}
					</span>
				</div>
				{filterChips.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{filterChips.map((item) => (
							<button
								key={item.key}
								type="button"
								onClick={() => {
									item.clear();
									setPage(1);
								}}
								aria-label={t('ui.removeFilter', { name: item.label })}
								title={`${item.label}: ${item.display || item.value}`}
								className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500"
							>
								<span className="max-w-64 truncate">
									{item.label}: {item.display || item.value}
								</span>
								<XMarkIcon className="h-3 w-3 shrink-0" aria-hidden />
							</button>
						))}
					</div>
				)}
			</section>
			{listError && (
				<div
					role="alert"
					className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
				>
					<span>{listError}</span>
					<button type="button" onClick={() => void fetchLogs()} className="text-xs underline">
						{t('ui.retry')}
					</button>
				</div>
			)}

			{(intervalMs !== 'off' || pendingCount > 0 || newCount > 0) && (
				<div className="sticky top-2 z-20 mb-3 flex min-h-10 flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50/95 px-3 py-2 text-xs text-blue-700">
					<span role="status" className="inline-flex items-center gap-2">
						<span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${pausedHint || intervalMs === 'off' ? 'bg-gray-400' : 'bg-blue-500'}`} />
						{pendingCount > 0 ? t('live.pending', { count: pendingCount }) : newCount > 0 ? t('live.received', { count: newCount })
							: pausedHint || t('live.following')}
					</span>
					{pendingCount > 0 && <button type="button" onClick={applyPending} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-blue-100 focus-visible:outline-blue-600">
						<ArrowUpIcon className="h-3.5 w-3.5" aria-hidden />{t('live.showLatest')}
					</button>}
				</div>
			)}

			<div className="admin-content-panel admin-table-surface overflow-hidden rounded-xl border border-gray-200 bg-white">
				<div
					ref={tableRef}
					className={`scroll-mt-20 overflow-x-auto ${isLoading && logs.length > 0 ? 'opacity-60' : ''}`}
					aria-busy={isLoading}
				>
					<table className="admin-data-table w-full min-w-[68rem] table-fixed">
						<colgroup>
							{['14%', '23%', '15%', '18%', '9%', '21%'].map((width, index) => (
								<col key={index} style={{ width }} />
							))}
						</colgroup>
						<thead className="border-b border-gray-200 bg-gray-50/80">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500">
									{t('headers.statusTime')}
								</th>
								<th
									className="px-4 py-3 text-left text-xs font-medium text-gray-500"
									title={t('titles.route')}
								>
									{t('ui.modelRoute')}
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500">
									{t('headers.userSystem')}
								</th>
								<th
									className="px-4 py-3 text-right text-xs font-medium text-gray-500"
									title={t('titles.usage')}
								>
									{t('headers.usage')}
								</th>
								<th className="px-4 py-3 text-right text-xs font-medium text-gray-500">{t('ui.latency')}</th>
								<th className="px-4 py-3 text-right text-xs font-medium text-gray-500">
									<span className="inline-flex items-center gap-1">
										{t('headers.cost', { currency: billingCurrencySym })}
										<PricingInfoHint kind="amounts" />
									</span>
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100">
							{isLoading &&
								logs.length === 0 &&
								Array.from({ length: 6 }, (_, row) => (
									<tr key={row}>
										{Array.from({ length: 6 }, (_, cell) => (
											<td key={cell} className="px-4 py-5">
												<div className="h-4 max-w-full w-24 animate-pulse rounded bg-gray-100" />
											</td>
										))}
									</tr>
								))}
							{logs.map((log) => (
								<tr
									key={log.id}
									data-request-log-id={log.id}
									tabIndex={0}
									onClick={() => setDetailLog(log)}
									onKeyDown={(event) => {
										if (
											event.target === event.currentTarget &&
											(event.key === 'Enter' || event.key === ' ')
										) {
											event.preventDefault();
											setDetailLog(log);
										}
									}}
									aria-haspopup="dialog"
									className="cursor-pointer align-middle hover:bg-gray-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-500"
								>
									<td className="overflow-hidden px-4 py-3.5 text-xs">
										<div className="flex items-center gap-2">
											{renderStatusBadge(log.status)}
											<ChevronRightIcon
												className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-400"
												aria-hidden
											/>
										</div>
										<div className="mt-1 flex flex-wrap gap-x-2 text-xs tabular-nums text-gray-500">
											<span>{formatShortDate(log.created_at)}</span>
											<span>{formatTime(log.created_at)}</span>
										</div>
										{log.error_message?.trim() && (
											<p className="mt-1 truncate text-xs text-red-600" title={dashboardErrorSummary(log.error_message, tDashboard('upstreamError'))}>
												{dashboardErrorSummary(log.error_message, tDashboard('upstreamError'))}
											</p>
										)}
									</td>
									<td className="overflow-hidden px-4 py-3.5">{renderRouteCell(log)}</td>
									<td className="overflow-hidden px-4 py-3.5 text-xs">
										<div className="truncate text-gray-800" title={log.user_email || undefined}>
											{log.user_id ? (
												<Link
													href={`/gateway/users/${encodeURIComponent(log.user_id)}`}
													onClick={(event) => event.stopPropagation()}
													className="hover:underline"
												>
													{log.user_email || tCommon('noData')}
												</Link>
											) : (
												log.user_email || tCommon('noData')
											)}
										</div>
										{log.external_system && (
											<p className="mt-1 truncate text-gray-500">{log.external_system}</p>
										)}
									</td>
									<td className="px-4 py-3.5 text-right text-xs text-gray-600">{renderUsageCell(log)}</td>
									<td className="px-4 py-3.5 text-right text-xs tabular-nums">
										<p className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-gray-900">
											<ClockIcon className="h-3 w-3 text-gray-400" aria-hidden="true" />
											{formatLatencyMs(log.latency_ms)}
										</p>
										{formatTtftListLine(log).text.trim() ? (
											<div
												className="mt-1 flex min-w-0 items-center justify-end gap-1 text-gray-500"
												title={formatTtftListLine(log).title}
											>
												{log.first_reasoning_token_ms != null ? (
													<CpuChipIcon
														className="h-3 w-3 shrink-0 text-violet-400"
														aria-hidden="true"
													/>
												) : (
													<BoltIcon className="h-3 w-3 shrink-0 text-blue-400" aria-hidden="true" />
												)}
												<span className="truncate">{formatTtftListLine(log).text}</span>
											</div>
										) : null}
									</td>
									<td className="px-4 py-3.5">
										{renderCostCell(
											Number(log.standard_cost ?? 0),
											Number(log.charged_cost ?? 0),
											Number(log.metered_cost ?? 0)
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{!isLoading && logs.length === 0 && !listError && (
					<p className="py-16 text-center text-sm text-gray-500">{tCommon('noLogsFound')}</p>
				)}
				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
					<span className="text-xs text-gray-500">{t('ui.detailHint')}</span>
					{totalPages > 1 && (
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => setPage(page - 1)}
								disabled={page <= 1 || isLoading}
								className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-40"
							>
								{tCommon('previous')}
							</button>
							<span className="text-xs tabular-nums text-gray-500">
								{tCommon('pageOf', { page, totalPages })}
							</span>
							<button
								type="button"
								onClick={() => setPage(page + 1)}
								disabled={page >= totalPages || isLoading}
								className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-40"
							>
								{tCommon('next')}
							</button>
						</div>
					)}
				</div>
			</div>

			{detailLog && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6">
					<div
						ref={detailRef}
						tabIndex={-1}
						role="dialog"
						aria-modal="true"
						aria-labelledby="log-detail-title"
						className="admin-content-dialog flex max-h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white outline-none"
					>
						<header className="admin-dialog-header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
							<div className="min-w-0">
								<h2 id="log-detail-title" className="admin-dialog-title text-base font-medium">
									<AdminContentMark />
									{t('ui.detailTitle')}
								</h2>
								<div className="mt-1 flex items-center gap-2">
									<span className="truncate font-mono text-xs text-gray-500" title={detailLog.id}>
										{detailLog.id}
									</span>
									<button
										type="button"
										aria-label={t('ui.copyRequestId')}
										onClick={() => void copyId(detailLog.id)}
										className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100"
									>
										<ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden />
									</button>
								</div>
							</div>
							<button
								type="button"
								aria-label={tCommon('close')}
								onClick={() => setDetailLog(null)}
								className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
							>
								<XMarkIcon className="h-5 w-5" aria-hidden />
							</button>
						</header>
						<div className="admin-dialog-body min-h-0 overflow-y-auto overscroll-contain">
							{detailInvocationSource ? (
								<RequestLogInvocation
									key={detailLog.id}
									log={detailLog}
									source={detailInvocationSource}
									identityLabel={detailIdentityLabel}
									currency={billingCurrency}
								/>
							) : (
								<RequestLogFlow
									key={detailLog.id}
									log={detailLog}
									providerLabel={providerRouteLabel(detailLog)}
									identityLabel={detailIdentityLabel}
									currency={billingCurrency}
									onExplainTiming={() => setTimingHelpLog(detailLog)}
								/>
							)}
						</div>
						<footer className="admin-dialog-footer flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-5 py-3">
							<span className="text-xs text-gray-500">
								{formatShortDate(detailLog.created_at)} {formatTime(detailLog.created_at)}
							</span>
							<button
								type="button"
								onClick={() => setDetailLog(null)}
								className="h-9 rounded-lg border border-gray-200 bg-white px-4 text-xs text-gray-700"
							>
								{tCommon('close')}
							</button>
						</footer>
					</div>
				</div>
			)}
			{timingHelpLog && (
				<div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/40 p-3 sm:p-6">
					<div
						ref={timingRef}
						tabIndex={-1}
						role="dialog"
						aria-modal="true"
						aria-labelledby="timing-help-title"
						className="admin-content-dialog flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white outline-none"
					>
						<header className="admin-dialog-header flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
							<h2 id="timing-help-title" className="admin-section-title flex items-center gap-2 text-base font-medium">
								<ClockIcon className="h-4 w-4 text-gray-400" aria-hidden />
								{t('timing.helpTitle')}
							</h2>
							<button
								type="button"
								aria-label={tCommon('close')}
								onClick={() => setTimingHelpLog(null)}
								className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
							>
								<XMarkIcon className="h-4 w-4" aria-hidden />
							</button>
						</header>
						<div className="admin-dialog-body min-h-0 overflow-y-auto p-5">
							<div className="grid gap-3 sm:grid-cols-2">
								{[
									{ label: 'gateway', value: timingHelpLog.gateway_overhead_ms },
									{ label: 'upstream', value: timingHelpLog.upstream_response_ms },
									{ label: 'headers', value: timingHelpLog.final_upstream_headers_ms },
									{ label: 'reasoning', value: timingHelpLog.first_reasoning_token_ms },
									{ label: 'ttftContent', value: timingHelpLog.first_token_ms },
									{ label: 'stream', value: timingHelpLog.stream_duration_ms },
								].map((item) => (
									<div key={item.label} className="rounded-lg border border-gray-200 p-3">
										<div className="flex items-baseline justify-between gap-3 text-xs">
											<span className="font-medium text-gray-900">{t(`timing.${item.label}`)}</span>
											<span className="shrink-0 tabular-nums text-gray-600">
												{formatLatencyMs(item.value)}
											</span>
										</div>
										<p className="mt-2 text-xs leading-5 text-gray-500">{t(`timing.${item.label}Desc`)}</p>
									</div>
								))}
							</div>
							<p className="mt-4 text-xs leading-5 text-gray-500">
								{t('timing.attempts')}: {timingHelpLog.upstream_attempt_count ?? '—'} ·{' '}
								{t('timing.attemptsDesc')}
							</p>
							<details className="mt-4 rounded-lg border border-gray-200">
								<summary className="cursor-pointer px-3 py-2 text-xs text-gray-600">
									{t('ui.timingDiagram')}
								</summary>
								<pre className="max-h-64 overflow-auto border-t border-gray-100 bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-600">
									{timingDiagram(timingHelpLog)}
								</pre>
							</details>
						</div>
						<footer className="admin-dialog-footer flex shrink-0 justify-end border-t border-gray-100 bg-gray-50 px-5 py-3">
							<button
								type="button"
								onClick={() => setTimingHelpLog(null)}
								className="h-9 rounded-lg border border-gray-200 bg-white px-4 text-xs"
							>
								{tCommon('close')}
							</button>
						</footer>
					</div>
				</div>
			)}
		</div>
	);
}
