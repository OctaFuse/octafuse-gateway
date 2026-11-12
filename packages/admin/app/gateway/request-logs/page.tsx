'use client';

import { AdminContentMark } from '@/components/admin-content-mark';

import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * 全站请求日志表：多维筛选、分页；Route 列按入站 / 上游两行展示协议端点、模型 ID、路由组与上游供应商；展开详情使用交互式请求流程与尝试时间线；数据来自 `/api/admin/request-logs`。
 */
import { PricingInfoHint } from '@/components/PricingInfoHint';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AdaptiveFilterGroup } from '@/components/adaptive-filter-group';
import { useAdminDialog } from '@/components/use-admin-dialog';
import { useFeedback } from '@/components/feedback';
import { useBusinessTimezoneContext } from '@/components/BusinessTimezoneProvider';
import { LogRangeControl } from './log-range-control';
import { readRequestLogFilters, requestLogDuration, requestLogQuery } from './request-log-query';
import { dashboardErrorSummary } from '@/components/dashboard/dashboard-presentation';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
	ArrowPathIcon,
	ChevronRightIcon,
	ClipboardDocumentIcon,
	ClockIcon,
	MagnifyingGlassIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import type { GatewayModel, GatewayModelRoute, GatewayProvider, GatewayRequestLog } from '@/lib/types';
import { compareRouteGroupsForDisplay, normalizeRouteGroup } from '@/lib/route-group-ui';
import { GATEWAY_TOOLS_PROVIDER_ID } from '@/lib/gateway-tools';
import { liveProviderPickerLabel, sortProvidersByKindThenName } from '@/lib/provider-kind';
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
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

/** `/api/admin/models` 列表项（tags 解析为数组） */
type ModelListItem = Omit<GatewayModel, 'tags'> & { tags: string[] };

export default function GatewayRequestLogsPage() {
	const router = useRouter();
	const t = useTranslations('requestLogs');
	const tCommon = useTranslations('common');
	const tDashboard = useTranslations('dashboard');
	const tOptions = useTranslations('options');
	const tKind = useTranslations('providers.kind');
	const tToken = useTranslations('oauthAccessTokensPage');
	const locale = useLocale();
	const [logs, setLogs] = useState<GatewayRequestLog[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	/** 同时展开一个请求流程；环节详情由流程组件按需展示。 */
	const [detailLog, setDetailLog] = useState<GatewayRequestLog | null>(null);
	const [timingHelpLog, setTimingHelpLog] = useState<GatewayRequestLog | null>(null);
	const pageSize = 50;
	const { currency: billingCurrency } = useBillingCurrency();
	const { businessTimezone, formatDate: formatShortDate, formatTime } = useGatewayDateTime();
	const { isLoading: timezoneLoading } = useBusinessTimezoneContext();
	const { notify } = useFeedback();
	const [filtersReady, setFiltersReady] = useState(false);
	const [listError, setListError] = useState('');
	const detailRef = useAdminDialog(Boolean(detailLog), false, () => setDetailLog(null));
	const timingRef = useAdminDialog(Boolean(timingHelpLog), false, () => setTimingHelpLog(null));
	const billingCurrencySym = getGatewayCurrencySymbol(billingCurrency);

	// Filters
	const [filterStatus, setFilterStatus] = useState('');
	const [filterModel, setFilterModel] = useState('');
	const [filterUserEmail, setFilterUserEmail] = useState('');
	const [filterApiKeyId, setFilterApiKeyId] = useState('');
	const [filterLogId, setFilterLogId] = useState('');
	const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() =>
		createRangeValue(DEFAULT_GATEWAY_TIME_RANGE_PRESET, businessTimezone)
	);
	const [filterProviderId, setFilterProviderId] = useState('');
	const [filterProviderIds, setFilterProviderIds] = useState('');
	const [filterModelPrefix, setFilterModelPrefix] = useState('');
	const remaining = useTranslations('remainingUi');
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
		if (timezoneLoading || filtersReady) return;
		const filters = readRequestLogFilters(window.location.search, businessTimezone);
		setPage(filters.page);
		setFilterStatus(filters.status);
		setFilterModel(filters.model);
		setFilterProviderId(filters.provider);
		setFilterProviderIds(filters.providerIds ?? '');
		setFilterModelPrefix(filters.modelPrefix ?? '');
		setFilterUserEmail(filters.email);
		setFilterApiKeyId(filters.apiKey);
		setFilterLogId(filters.requestId);
		setFilterRouteGroup(filters.routeGroup);
		setFilterProtocol(filters.protocol);
		setRangeValue(filters.range);
		setFiltersReady(true);
	}, [timezoneLoading, filtersReady, businessTimezone]);

	const query = useMemo(
		() =>
			requestLogQuery({
				page,
				status: filterStatus,
				model: filterModel,
				provider: filterProviderId,
				providerIds: filterProviderIds,
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
			filterStatus,
			filterModel,
			filterProviderId,
			filterProviderIds,
			filterModelPrefix,
			filterUserEmail,
			filterApiKeyId,
			filterLogId,
			filterRouteGroup,
			filterProtocol,
			rangeValue,
		]
	);
	useEffect(() => {
		if (filtersReady) router.replace(`/gateway/request-logs?${query}`, { scroll: false });
	}, [query, filtersReady, router]);

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
			rows.unshift({ id: filterModel, label: t('ui.notInCatalog', { value: filterModel }) });
		}
		return rows;
	}, [modelCatalog, filterModel, t]);

	const providerSelectOptions = useMemo(() => {
		const rows = sortProvidersByKindThenName(providerCatalog, locale, tKind('custom')).map((p) => ({
			id: p.id,
			label: liveProviderPickerLabel(p, locale, tKind('custom'), p.id),
		}));
		const ids = new Set(rows.map((r) => r.id));
		if (filterProviderId && !ids.has(filterProviderId)) {
			rows.unshift({
				id: filterProviderId,
				label: t('ui.notInCatalog', { value: filterProviderId }),
			});
		}
		return rows;
	}, [providerCatalog, filterProviderId, locale, tKind, t]);

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

	const latestLogRequest = useRef(0);

	const fetchLogs = useCallback(async () => {
		if (!filtersReady) return;
		const request = ++latestLogRequest.current;
		setIsLoading(true);
		setListError('');
		try {
			const response = await fetch(`/api/admin/request-logs?${query}`);
			const data = await readApiJson<GatewayRequestLog[]>(response);
			if (request !== latestLogRequest.current) return;
			if (data.success) {
				setLogs(data.data || []);
				setTotal(data.total || 0);
			} else setListError(data.message || t('ui.loadFailed'));
		} catch (error) {
			if (request === latestLogRequest.current)
				setListError(error instanceof Error ? error.message : t('ui.loadFailed'));
		} finally {
			if (request === latestLogRequest.current) setIsLoading(false);
		}
	}, [query, filtersReady, t]);

	useEffect(() => {
		fetchLogs();
	}, [fetchLogs]);

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
			return { text, title };
		}
		if (log.first_token_ms != null) {
			return { text: `TTFT ${formatLatencyMs(log.first_token_ms)}` };
		}
		if (log.upstream_response_ms != null) {
			return { text: t('ui.upstreamLatency', { time: formatLatencyMs(log.upstream_response_ms) }) };
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
				<span className="text-xs font-medium text-gray-400">{unit}</span>
			</div>
		</div>
	);

	const compactCount = (value: number | null | undefined) =>
		Number(value ?? 0).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });

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
				characters != null && Number.isFinite(characters) ? Number(characters).toLocaleString() : '—';
			return renderUsageValue(value, t('usage.characters'), t('titles.audioPerCharacterUsage'));
		}
		const hasCache = log.cache_read_tokens > 0 || log.cache_write_tokens > 0;
		return (
			<div className="leading-tight space-y-1 whitespace-nowrap">
				<div
					className="inline-flex items-baseline gap-1 text-gray-900"
					title={`${t('titles.inputOutputTokens')}: ${Number(
						log.input_tokens ?? 0
					).toLocaleString()} / ${Number(log.output_tokens ?? 0).toLocaleString()}`}
				>
					<span className="tabular-nums">
						{compactCount(log.input_tokens)} / {compactCount(log.output_tokens)}
					</span>
					<span className="text-xs font-medium text-gray-400">{t('usage.tokens')}</span>
				</div>
				{hasCache ? (
					<div
						className="text-gray-400 tabular-nums"
						title={`${t('titles.cacheTokens')}: ${log.cache_read_tokens} / ${log.cache_write_tokens}`}
					>
						CR {compactCount(log.cache_read_tokens)} / CW {compactCount(log.cache_write_tokens)}
					</div>
				) : null}
			</div>
		);
	};

	const renderCostCell = (standardCost: number, chargedCost: number, meteredCost: number) => (
		<div
			className="admin-money-comparison grid grid-cols-[auto_auto_auto] justify-end gap-x-1.5 gap-y-1 text-right text-xs tabular-nums"
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
					<span className={`self-baseline whitespace-nowrap ${row.tone}`}>
						{formatGatewayMoneyCode(row.amount, billingCurrency, 6)}
					</span>
					<span
						className="min-w-12 self-baseline whitespace-nowrap text-right text-[11px] text-gray-400"
						title={row.hint}
					>
						{formatCostMultiplier(row.amount, standardCost) || '—'}
					</span>
				</Fragment>
			))}
		</div>
	);

	const renderRouteCell = (log: GatewayRequestLog) => {
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

	const featureTagClass = 'bg-gray-50 text-gray-500 ring-gray-200/70';

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
					return (
						<span
							key={key}
							className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
								tag.key === 'failover' ? 'bg-amber-50 text-amber-700 ring-amber-200' : featureTagClass
							}`}
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
	const statusLabel = (status: string) =>
		['success', 'error', 'incomplete', 'cancelled'].includes(status)
			? tOptions(`requestStatus.${status}`)
			: t('statusOther');
	const advancedFilters = [
		{ label: remaining('providerScope'), value: filterProviderIds, clear: () => setFilterProviderIds('') },
		{ label: remaining('modelPrefix'), value: filterModelPrefix, clear: () => setFilterModelPrefix('') },
		{
			label: tCommon('provider'),
			value: filterProviderId,
			display: providerSelectOptions.find((item) => item.id === filterProviderId)?.label,
			clear: () => setFilterProviderId(''),
		},
		{ label: t('filters.protocol'), value: filterProtocol, clear: () => setFilterProtocol('') },
		{
			label: t('filters.routeGroup'),
			value: filterRouteGroup,
			clear: () => setFilterRouteGroup(''),
		},
		{ label: t('filters.apiKeyId'), value: filterApiKeyId, clear: () => setFilterApiKeyId('') },
		{ label: t('filters.requestId'), value: filterLogId, clear: () => setFilterLogId('') },
	].filter((item) => item.value);
	const hasFilters = Boolean(filterStatus || filterModel || filterUserEmail || advancedFilters.length);
	const clearFilters = () => {
		setFilterStatus('');
		setFilterModel('');
		setFilterProviderId('');
		setFilterProviderIds('');
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
				<div className="flex max-w-full items-center gap-2">
					<LogRangeControl
						value={rangeValue}
						timeZone={businessTimezone}
						onChange={(range) => {
							setRangeValue(range);
							setPage(1);
						}}
					/>
					<button
						type="button"
						disabled={isLoading}
						aria-label={t('ui.refresh')}
						title={t('ui.refresh')}
						onClick={() => {
							if (rangeValue.preset !== 'custom')
								setRangeValue(createRangeValue(rangeValue.preset, businessTimezone));
							else void fetchLogs();
						}}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-40"
					>
						<ArrowPathIcon className="h-4 w-4" aria-hidden />
					</button>
				</div>
			</div>

			<section aria-label={t('ui.filters')} className="admin-filter-surface mb-5 space-y-3">
				<div className="flex flex-wrap items-end gap-3">
					<div className="relative min-w-0 flex-1 basis-60 sm:max-w-xs">
						<MagnifyingGlassIcon
							className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
							aria-hidden
						/>
						<input
							type="search"
							aria-label={t('filters.userEmail')}
							value={filterUserEmail}
							onChange={(e) => {
								setFilterUserEmail(e.target.value);
								setPage(1);
							}}
							placeholder={t('filters.emailPlaceholder')}
							className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm"
						/>
					</div>
					<select
						aria-label={tCommon('status')}
						value={filterStatus}
						onChange={(e) => {
							setFilterStatus(e.target.value);
							setPage(1);
						}}
						className={`${selectClass} w-32`}
					>
						<option value="">{t('ui.allStatuses')}</option>
						{['success', 'error', 'incomplete', 'cancelled'].map((status) => (
							<option key={status} value={status}>
								{tOptions(`requestStatus.${status}`)}
							</option>
						))}
					</select>
					<select
						aria-label={tCommon('model')}
						value={filterModel}
						onChange={(e) => {
							setFilterModelPrefix('');
							setFilterModel(e.target.value);
							setPage(1);
						}}
						className={`${selectClass} max-w-full w-52`}
					>
						<option value="">{t('ui.allModels')}</option>
						{modelSelectOptions.map((item) => (
							<option key={item.id} value={item.id}>
								{item.label}
							</option>
						))}
					</select>
					<AdaptiveFilterGroup
						label={t('ui.moreFilters')}
						activeCount={advancedFilters.length}
						extraCount={[filterProviderIds, filterModelPrefix, filterApiKeyId, filterLogId].filter(Boolean).length}
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
						<label className="admin-adaptive-field block space-y-2 text-xs text-gray-500">
							{tCommon('provider')}
							<select
								value={filterProviderId}
								onChange={(e) => {
									setFilterProviderIds('');
									setFilterProviderId(e.target.value);
									setPage(1);
								}}
								className={`${selectClass} block w-full`}
							>
								<option value="">{tCommon('all')}</option>
								{providerSelectOptions.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
							</select>
						</label>
						<label className="admin-adaptive-field block space-y-2 text-xs text-gray-500">
							{t('filters.protocol')}
							<select
								value={filterProtocol}
								onChange={(e) => {
									setFilterProtocol(e.target.value);
									setPage(1);
								}}
								className={`${selectClass} block w-full`}
							>
								<option value="">{tCommon('all')}</option>
								{UPSTREAM_PROTOCOLS.map((protocol) => (
									<option key={protocol} value={protocol}>
										{protocol}
									</option>
								))}
							</select>
						</label>
						<label className="admin-adaptive-field block space-y-2 text-xs text-gray-500">
							{t('filters.routeGroup')}
							<select
								value={filterRouteGroup}
								onChange={(e) => {
									setFilterRouteGroup(e.target.value);
									setPage(1);
								}}
								className={`${selectClass} block w-full`}
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
				{advancedFilters.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{advancedFilters.map((item) => (
							<button
								key={item.label}
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

			<div className="admin-content-panel admin-table-surface overflow-hidden rounded-xl border border-gray-200 bg-white">
				<div
					className={`overflow-x-auto ${isLoading && logs.length > 0 ? 'opacity-60' : ''}`}
					aria-busy={isLoading}
				>
					<table className="admin-data-table w-full min-w-[60rem] table-fixed">
						<colgroup>
							{['15%', '24%', '16%', '14%', '10%', '21%'].map((width, index) => (
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
											<span
												className={`h-2 w-2 shrink-0 rounded-full ${statusSwatchClass(log.status)}`}
												aria-hidden
											/>
											<span
												className={
													log.status === 'error'
														? 'font-medium text-red-600'
														: log.status === 'incomplete'
														? 'font-medium text-amber-700'
														: 'text-gray-700'
												}
											>
												{statusLabel(log.status)}
											</span>
											<ChevronRightIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
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
										<p className="font-medium text-gray-900">{formatLatencyMs(log.latency_ms)}</p>
										<p className="mt-1 truncate text-gray-500" title={formatTtftListLine(log).title}>
											{formatTtftListLine(log).text}
										</p>
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
							<RequestLogFlow
								key={detailLog.id}
								log={detailLog}
								providerLabel={providerRouteLabel(detailLog)}
								identityLabel={[
									detailLog.user_email,
									detailLog.api_key_id ??
										(detailLog.oauth_access_token_id
											? detailLog.oauth_access_token_name
												? tToken('logCredential', { name: detailLog.oauth_access_token_name })
												: tToken('logCredentialUnknown', { id: detailLog.oauth_access_token_id })
											: null),
								]
									.filter(Boolean)
									.join(' · ')}
								currency={billingCurrency}
								onExplainTiming={() => setTimingHelpLog(detailLog)}
							/>
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
