/**
 * 管理后台聚合服务：仪表盘 KPI、全局请求日志列表、`system_config` 读写，以及模型/供应商/用户/可靠性分析 API 的数据装配。
 */
import type { GatewayRepositories, RequestLogSummaryDimension, RequestLogSummaryRow } from '@octafuse/core';
import { BILLING_CURRENCY_KEY, tryParseGatewaySupportedBillingCurrencyInput } from '@octafuse/core/lib/billing-currency';
import { MAINTENANCE_MODE_KEY } from '@octafuse/core/lib/maintenance-mode';
import {
	parseWebSearchActiveInput,
	parseWebSearchCatalogInput,
	serializeWebSearchCatalog,
	WEB_SEARCH_ACTIVE_KEY,
	WEB_SEARCH_API_KEY_KEY,
	WEB_SEARCH_CATALOG_KEY,
	WEB_SEARCH_COST_KEY,
	WEB_SEARCH_PROVIDER_KEY,
	WEB_SEARCH_PROVIDERS,
} from '@octafuse/core/lib/web-search-system-config';
import {
	parseWebFetchActiveInput,
	parseWebFetchCatalogInput,
	serializeWebFetchCatalog,
	WEB_FETCH_ACTIVE_KEY,
	WEB_FETCH_API_KEY_KEY,
	WEB_FETCH_CATALOG_KEY,
	WEB_FETCH_COST_KEY,
	WEB_FETCH_PROVIDER_KEY,
	WEB_FETCH_PROVIDERS,
} from '@octafuse/core/lib/web-fetch-system-config';
import {
	parseWebDeepSearchActiveInput,
	parseWebDeepSearchCatalogInput,
	serializeWebDeepSearchCatalog,
	WEB_DEEP_SEARCH_ACTIVE_KEY,
	WEB_DEEP_SEARCH_CATALOG_KEY,
	WEB_DEEP_SEARCH_PROVIDERS,
} from '@octafuse/core/lib/web-deep-search-system-config';
import {
	AI_DETECTION_ACTIVE_KEY,
	AI_DETECTION_CATALOG_KEY,
	AI_DETECTION_IMPLEMENTED_PROVIDERS,
	AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS,
	AI_DETECTION_PROVIDERS,
	entryHasRequiredCredentials,
	isAiDetectionImplementedProvider,
	parseAiDetectionActiveInput,
	parseAiDetectionCatalogInput,
	serializeAiDetectionCatalog,
} from '@octafuse/core/lib/ai-detection-system-config';
import {
	DEFAULT_ROUTE_STRATEGY,
	isRouteStrategyName,
	ROUTE_STRATEGY_NAMES,
} from '@octafuse/core/db/model-route-policy';
import { ROUTE_STRATEGY_KEY } from '@octafuse/core/lib/route-strategy-system-config';
import {
	DEFAULT_USER_CHARGED_COST_FACTOR_MODE,
	USER_CHARGED_COST_FACTOR_MODE_KEY,
	USER_CHARGED_COST_FACTOR_MODES,
	isUserChargedCostFactorMode,
} from '@octafuse/core/lib/user-charged-cost-factor-mode';
import { badRequest } from './errors';
import { clampAnalyticsRange, rangeToDates, resolveStatsDateRange } from './shared';
import { getBusinessDayWindow, getBusinessTimezone } from '@octafuse/core/lib/business-timezone';
import { normalizeUpstreamProtocol } from '@octafuse/core/upstream-protocol';
import type {
	AdminConfigRow,
	AdminConfigUpdateInput,
	AdminModelAnalyticsOutput,
	AdminModelAnalyticsRow,
	AdminProviderAnalyticsOutput,
	AdminProviderAnalyticsRow,
	AdminReliabilityAnalyticsOutput,
	AdminReliabilityModelProviderRow,
	AdminReliabilityProviderRow,
	AdminRequestLogSummaryOutput,
	AdminRequestLogsOutput,
	AdminStatsOutput,
	AdminUserAnalyticsRow,
	AdminKeyAnalyticsRow,
	AdminGlobalBudgetAuditLogsOutput,
} from './types';
import { resolveAdminUserId } from './users-service';

function mapAnalyticsTtftFields(r: {
	avg_first_reasoning_token_ms?: unknown;
	avg_first_token_ms?: unknown;
	avg_effective_ttft_ms?: unknown;
	avg_reasoning_phase_ms?: unknown;
	reasoning_ttft_rate?: unknown;
	content_ttft_rate?: unknown;
}) {
	return {
		avg_first_reasoning_token_ms: r.avg_first_reasoning_token_ms != null ? Number(r.avg_first_reasoning_token_ms) : null,
		avg_first_token_ms: r.avg_first_token_ms != null ? Number(r.avg_first_token_ms) : null,
		avg_effective_ttft_ms: r.avg_effective_ttft_ms != null ? Number(r.avg_effective_ttft_ms) : null,
		avg_reasoning_phase_ms: r.avg_reasoning_phase_ms != null ? Number(r.avg_reasoning_phase_ms) : null,
		reasoning_ttft_rate: Number(r.reasoning_ttft_rate ?? 0),
		content_ttft_rate: Number(r.content_ttft_rate ?? 0),
	};
}

/**
 * Prompt cache 命中率（%）。
 * 网关语义：`input_tokens = regular + cache_read + cache_write`，故分母用 `input_tokens`。
 */
function computeCacheHitRate(inputTokens: number, cacheReadTokens: number): number {
	return inputTokens > 0 ? (cacheReadTokens / inputTokens) * 100 : 0;
}

/**
 * 全局请求日志分页（将查询字符串参数映射为 `getRequestLogs` 的 options）。
 * @param input.page / page_size 字符串或数字均可，非法时由 parseInt 处理
 */
export async function listAdminGlobalRequestLogsService(
	repos: GatewayRepositories,
	input: {
		page?: number | string;
		page_size?: number | string;
		id?: string;
		api_key_id?: string;
		user_email?: string;
		model_id?: string;
		provider_id?: string;
		provider_ids?: string;
		model_id_prefix?: string;
		route_group?: string;
		protocol?: string;
		status?: string;
		start_date?: string;
		end_date?: string;
	}
): Promise<AdminRequestLogsOutput> {
	let protocol: string | undefined;
	if (input.protocol != null && input.protocol.trim() !== '') {
		try {
			protocol = normalizeUpstreamProtocol(input.protocol);
		} catch (e) {
			throw badRequest(e instanceof Error ? e.message : 'Invalid protocol');
		}
	}
	const page = Math.max(1, Number.parseInt(String(input.page ?? '1'), 10));
	const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(input.page_size ?? '20'), 10)));
	const result = await repos.requestLogs.getRequestLogs({
		page,
		pageSize,
		id: input.id?.trim() || undefined,
		apiKeyId: input.api_key_id,
		userEmail: input.user_email,
		modelId: input.model_id,
		providerId: input.provider_id,
		providerIds: parseProviderIds(input.provider_ids),
		modelIdPrefix: input.model_id_prefix?.trim() || undefined,
		routeGroup: input.route_group,
		protocol,
		status: input.status,
		startDate: input.start_date,
		endDate: input.end_date,
	});
	return { ...result, page, page_size: pageSize };
}

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseIsoInstant(raw: string | undefined, name: string): string {
	const value = raw?.trim() ?? '';
	if (!ISO_INSTANT_RE.test(value) || Number.isNaN(Date.parse(value))) {
		throw badRequest(`${name} must be an ISO 8601 timestamp with timezone, e.g. 2026-10-20T10:00:00.000Z`);
	}
	return new Date(value).toISOString();
}

/** 汇总分组维度的规范顺序；`group_by` 里的书写顺序无关，响应统一按此顺序回显。 */
const SUMMARY_DIMENSION_ORDER: readonly RequestLogSummaryDimension[] = [
	'provider',
	'model',
	'user',
	'provider_key',
	'route_group',
	'status',
];

/** 默认模式（不传 `limit`）单次最多返回的分组数；超出直接报错，不静默截断。 */
export const REQUEST_LOG_SUMMARY_MAX_GROUPS = 1000;
/** 显式分页（传了 `limit`）时每页最多的分组数。 */
export const REQUEST_LOG_SUMMARY_MAX_PAGE_SIZE = 5000;
/** 没有任何筛选条件时允许汇总的最长区间，避免对全表无界聚合。 */
export const REQUEST_LOG_SUMMARY_UNFILTERED_MAX_DAYS = 31;

/** 逗号分隔的维度列表 → 去重、校验、按规范顺序排列。 */
function parseSummaryGroupBy(raw: string | undefined): RequestLogSummaryDimension[] {
	const parts = (raw ?? '').split(',').map((value) => value.trim()).filter((value) => value !== '');
	if (parts.length === 0) return ['provider'];
	const allowed = new Set<string>(SUMMARY_DIMENSION_ORDER);
	for (const part of parts) {
		if (!allowed.has(part)) {
			throw badRequest(`group_by must be a comma-separated list of: ${SUMMARY_DIMENSION_ORDER.join(', ')}`);
		}
	}
	if (new Set(parts).size !== parts.length) throw badRequest('group_by must not contain duplicates');
	return SUMMARY_DIMENSION_ORDER.filter((dimension) => parts.includes(dimension));
}

function parseNonNegativeInt(raw: string | undefined, name: string): number | undefined {
	const value = raw?.trim() ?? '';
	if (value === '') return undefined;
	if (!/^\d+$/.test(value)) throw badRequest(`${name} must be a non-negative integer`);
	return Number.parseInt(value, 10);
}

function zeroSummaryMetrics(): Omit<RequestLogSummaryRow, 'provider_id'> {
	return {
		request_count: 0,
		success_count: 0,
		error_count: 0,
		incomplete_count: 0,
		cancelled_count: 0,
		input_tokens: 0,
		output_tokens: 0,
		cache_read_tokens: 0,
		cache_write_tokens: 0,
		reasoning_tokens: 0,
		total_tokens: 0,
		standard_cost: '0.000000',
		metered_cost: '0.000000',
		charged_cost: '0.000000',
		charged_wallet_cost: '0.000000',
		error_metered_cost: '0.000000',
		error_charged_cost: '0.000000',
	};
}

/**
 * 请求日志汇总（门户对账、成本监控等精确核对场景）。
 * 区间为半开 `[start, end)`，精度到毫秒；所有状态的日志都计入，与明细分页口径一致。
 * 金额为 6 位小数十进制字符串。没有任何筛选条件时区间不得超过 31 天。
 * 仅在 `group_by=provider`、传了 `provider_ids` 且未显式分页时，请求的每个 Provider 都有一行，没有日志的记 0。
 * 分页：不传 `limit` 时一次返回全部分组，超过 1000 组报错；传 `limit`（≤5000）后按分组键排序分页，
 * 用 `has_more` 判断是否还有下一页，`offset` 必须配合 `limit`。
 */
export async function getRequestLogSummaryService(
	repos: GatewayRepositories,
	input: {
		group_by?: string;
		provider_ids?: string;
		model_id?: string;
		model_id_prefix?: string;
		route_group?: string;
		status?: string;
		start?: string;
		end?: string;
		include_labels?: string;
		limit?: string;
		offset?: string;
	}
): Promise<AdminRequestLogSummaryOutput> {
	const groupBy = parseSummaryGroupBy(input.group_by);
	const providerIds = parseProviderIds(input.provider_ids);
	const modelId = input.model_id?.trim() || undefined;
	const modelIdPrefix = input.model_id_prefix?.trim() || undefined;
	const routeGroup = input.route_group?.trim() || undefined;
	const status = input.status?.trim() || undefined;
	const start = parseIsoInstant(input.start, 'start');
	const end = parseIsoInstant(input.end, 'end');
	if (Date.parse(start) >= Date.parse(end)) throw badRequest('start must be earlier than end');
	const filtered = !!(providerIds || modelId || modelIdPrefix || routeGroup || status);
	if (!filtered && Date.parse(end) - Date.parse(start) > REQUEST_LOG_SUMMARY_UNFILTERED_MAX_DAYS * 86_400_000) {
		throw badRequest(
			`without provider_ids, model_id, model_id_prefix, route_group or status the range must not exceed ${REQUEST_LOG_SUMMARY_UNFILTERED_MAX_DAYS} days`
		);
	}
	const includeLabels = ['1', 'true'].includes((input.include_labels ?? '').trim().toLowerCase());

	const pageLimit = parseNonNegativeInt(input.limit, 'limit');
	const offset = parseNonNegativeInt(input.offset, 'offset');
	if (pageLimit !== undefined && (pageLimit < 1 || pageLimit > REQUEST_LOG_SUMMARY_MAX_PAGE_SIZE)) {
		throw badRequest(`limit must be between 1 and ${REQUEST_LOG_SUMMARY_MAX_PAGE_SIZE}`);
	}
	if (offset !== undefined && pageLimit === undefined) throw badRequest('offset requires limit');
	const paginated = pageLimit !== undefined;
	const fetchLimit = (paginated ? pageLimit : REQUEST_LOG_SUMMARY_MAX_GROUPS) + 1;

	const rows = await repos.requestLogs.getRequestLogSummary({
		groupBy,
		startDate: start,
		endDate: end,
		providerIds,
		modelId,
		modelIdPrefix,
		routeGroup,
		status,
		includeLabels,
		limit: fetchLimit,
		offset: offset ?? 0,
	});
	const exceeded = rows.length >= fetchLimit;
	if (exceeded && !paginated) {
		throw badRequest(
			`summary has more than ${REQUEST_LOG_SUMMARY_MAX_GROUPS} groups, narrow the filters, choose a coarser group_by, or paginate with limit/offset`
		);
	}
	let groups = exceeded ? rows.slice(0, fetchLimit - 1) : rows;
	if (!paginated && groupBy.length === 1 && groupBy[0] === 'provider' && providerIds) {
		const byId = new Map(rows.map((row) => [row.provider_id, row]));
		groups = providerIds.map((id) => byId.get(id) ?? { provider_id: id, ...zeroSummaryMetrics() });
	}
	return { start, end, group_by: groupBy.join(','), groups, has_more: paginated && exceeded };
}

const MAX_PROVIDER_IDS = 10;

function parseProviderIds(raw: string | undefined): string[] | undefined {
	if (raw == null || raw.trim() === '') return undefined;
	const ids = [...new Set(raw.split(',').map((value) => value.trim()).filter((value) => value !== ''))];
	if (ids.length > MAX_PROVIDER_IDS) {
		throw badRequest('provider_ids accepts at most 10 values');
	}
	return ids.length > 0 ? ids : undefined;
}

/** 多值过滤参数：可重复出现，也可在单个值里用逗号分隔；去空去重。 */
function parseMultiValueFilter(input: string | string[] | undefined): string[] | undefined {
	const values = (Array.isArray(input) ? input : input ? [input] : [])
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter((value, index, all) => value !== '' && all.indexOf(value) === index);
	return values.length > 0 ? values : undefined;
}

/**
 * 全局 `user_audit_logs` 分页（可选 api_key_id、user_email、event_type、actor_type、actor_id、actor_kind、时间窗）。
 */
export async function listAdminGlobalBudgetAuditLogsService(
	repos: GatewayRepositories,
	input: {
		page?: number | string;
		page_size?: number | string;
		user_id?: string;
		api_key_id?: string;
		user_email?: string;
		event_type?: string | string[];
		actor_type?: string | string[];
		actor_id?: string;
		actor_kind?: string | string[];
		reason_code?: string | string[];
		source?: string | string[];
		correlation_id?: string;
		start_date?: string;
		end_date?: string;
	}
): Promise<AdminGlobalBudgetAuditLogsOutput> {
	const page = Math.max(1, Number.parseInt(String(input.page ?? '1'), 10));
	const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(input.page_size ?? '20'), 10)));
	const result = await repos.userAuditLogs.getGlobalUserAuditLogs({
		page,
		pageSize,
		userId: input.user_id,
		apiKeyId: input.api_key_id,
		userEmail: input.user_email,
		eventTypes: parseMultiValueFilter(input.event_type),
		actorTypes: parseMultiValueFilter(input.actor_type),
		actorId: input.actor_id?.trim() || undefined,
		actorKinds: parseMultiValueFilter(input.actor_kind),
		reasonCodes: parseMultiValueFilter(input.reason_code),
		sources: parseMultiValueFilter(input.source),
		correlationId: input.correlation_id,
		startDate: input.start_date,
		endDate: input.end_date,
	});
	return { ...result, page, page_size: pageSize };
}

export async function listAdminGlobalBudgetAuditLogFilterOptionsService(repos: GatewayRepositories) {
	return repos.userAuditLogs.getGlobalUserAuditLogFilterOptions();
}

/** 配置列表；空 value 转为 `''` 便于前端表单展示。 */
export async function listAdminSystemConfigService(repos: GatewayRepositories): Promise<AdminConfigRow[]> {
	const rows = await repos.systemConfig.listSystemConfigRows();
	return rows.map((r) => ({
		key: r.key,
		value: r.value ?? '',
		description: r.description ?? null,
	}));
}

/**
 * 更新或插入一条 `system_config`；校验失败抛 `badRequest`。
 * @param body.value `null`/`undefined` 会写成空字符串
 */
export async function updateAdminSystemConfigService(repos: GatewayRepositories, body: AdminConfigUpdateInput) {
	if (typeof body.key !== 'string' || body.key.trim() === '') {
		throw badRequest('key is required');
	}
	if (body.value !== undefined && body.value !== null && typeof body.value !== 'string') {
		throw badRequest('value must be string');
	}
	const key = body.key.trim();
	if (key === 'MASTER_KEY') {
		throw badRequest('MASTER_KEY is removed; use Integration Keys');
	}
	if (key === MAINTENANCE_MODE_KEY) {
		throw badRequest('MAINTENANCE_MODE is managed via PUT /api/admin/maintenance');
	}
	let value = body.value == null ? '' : String(body.value);
	if (key === BILLING_CURRENCY_KEY) {
		const parsed = tryParseGatewaySupportedBillingCurrencyInput(value);
		if (!parsed) {
			throw badRequest('BILLING_CURRENCY must be USD or CNY');
		}
		value = parsed;
	}
	if (key === ROUTE_STRATEGY_KEY) {
		const normalized = value.trim().toLowerCase();
		if (!isRouteStrategyName(normalized)) {
			throw badRequest(
				`ROUTE_STRATEGY must be one of: ${ROUTE_STRATEGY_NAMES.join(', ')} (default ${DEFAULT_ROUTE_STRATEGY})`
			);
		}
		value = normalized;
	}
	if (key === USER_CHARGED_COST_FACTOR_MODE_KEY) {
		const normalized = value.trim().toLowerCase();
		if (!isUserChargedCostFactorMode(normalized)) {
			throw badRequest(
				`USER_CHARGED_COST_FACTOR_MODE must be one of: ${USER_CHARGED_COST_FACTOR_MODES.join(', ')} (default ${DEFAULT_USER_CHARGED_COST_FACTOR_MODE})`
			);
		}
		value = normalized;
	}
	if (key === 'STREAM_FIRST_EVENT_TIMEOUT_MS') {
		const trimmed = value.trim();
		if (trimmed && !/^\d+$/.test(trimmed)) {
			throw badRequest(
				'STREAM_FIRST_EVENT_TIMEOUT_MS must be an integer millisecond value (0 disables) or empty (default 60000)'
			);
		}
		value = trimmed;
	}
	if (key === 'STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS') {
		const trimmed = value.trim();
		if (trimmed && trimmed !== '*' && trimmed.toLowerCase() !== 'all') {
			const groups = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
			if (groups.length === 0) {
				throw badRequest(
					'STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS must be empty, *, all, or a comma-separated list of route groups'
				);
			}
		}
		value = trimmed;
	}
	const legacyToolKeys = new Set([
		WEB_SEARCH_PROVIDER_KEY,
		WEB_SEARCH_API_KEY_KEY,
		WEB_SEARCH_COST_KEY,
		WEB_FETCH_PROVIDER_KEY,
		WEB_FETCH_API_KEY_KEY,
		WEB_FETCH_COST_KEY,
	]);
	if (legacyToolKeys.has(key)) {
		throw badRequest(
			`${key} is deprecated; use Tools → Configuration (WEB_*_ACTIVE / WEB_*_CATALOG) instead`
		);
	}

	if (key === WEB_SEARCH_CATALOG_KEY) {
		const catalog = parseWebSearchCatalogInput(value);
		if (catalog == null) {
			throw badRequest(
				`WEB_SEARCH_CATALOG must be a JSON object with whitelist providers (${WEB_SEARCH_PROVIDERS.join(', ')}) and { apiKey: string, pricing: { v: 2, standard, chargedFactor, meteredFactor } ≥ 0 (or legacy metered/standard/charged/cost) }`
			);
		}
		const activeRaw = await repos.systemConfig.getConfig(WEB_SEARCH_ACTIVE_KEY);
		const active = parseWebSearchActiveInput(activeRaw);
		if (active) {
			const entryKey = catalog[active]?.apiKey?.trim() ?? '';
			if (!entryKey) {
				throw badRequest(
					`Cannot save WEB_SEARCH_CATALOG: active provider "${active}" would have no API key; change WEB_SEARCH_ACTIVE first`
				);
			}
		}
		value = serializeWebSearchCatalog(catalog);
	}
	if (key === WEB_SEARCH_ACTIVE_KEY) {
		const active = parseWebSearchActiveInput(value);
		if (!active) {
			throw badRequest(`WEB_SEARCH_ACTIVE must be one of: ${WEB_SEARCH_PROVIDERS.join(', ')}`);
		}
		const catalogRaw = await repos.systemConfig.getConfig(WEB_SEARCH_CATALOG_KEY);
		const catalog = parseWebSearchCatalogInput(catalogRaw);
		if (catalog == null) {
			throw badRequest('WEB_SEARCH_CATALOG must be configured before setting WEB_SEARCH_ACTIVE');
		}
		const entryKey = catalog[active]?.apiKey?.trim() ?? '';
		if (!entryKey) {
			throw badRequest(`Cannot activate web-search provider "${active}" without an API key`);
		}
		value = active;
	}

	if (key === WEB_FETCH_CATALOG_KEY) {
		const catalog = parseWebFetchCatalogInput(value);
		if (catalog == null) {
			throw badRequest(
				`WEB_FETCH_CATALOG must be a JSON object with whitelist providers (${WEB_FETCH_PROVIDERS.join(', ')}) and { apiKey: string, pricing: { v: 2, standard, chargedFactor, meteredFactor } ≥ 0 (or legacy metered/standard/charged/cost) }`
			);
		}
		const activeRaw = await repos.systemConfig.getConfig(WEB_FETCH_ACTIVE_KEY);
		const active = parseWebFetchActiveInput(activeRaw);
		if (active) {
			const entryKey = catalog[active]?.apiKey?.trim() ?? '';
			if (!entryKey) {
				throw badRequest(
					`Cannot save WEB_FETCH_CATALOG: active provider "${active}" would have no API key; change WEB_FETCH_ACTIVE first`
				);
			}
		}
		value = serializeWebFetchCatalog(catalog);
	}
	if (key === WEB_FETCH_ACTIVE_KEY) {
		const active = parseWebFetchActiveInput(value);
		if (!active) {
			throw badRequest(`WEB_FETCH_ACTIVE must be one of: ${WEB_FETCH_PROVIDERS.join(', ')}`);
		}
		const catalogRaw = await repos.systemConfig.getConfig(WEB_FETCH_CATALOG_KEY);
		const catalog = parseWebFetchCatalogInput(catalogRaw);
		if (catalog == null) {
			throw badRequest('WEB_FETCH_CATALOG must be configured before setting WEB_FETCH_ACTIVE');
		}
		const entryKey = catalog[active]?.apiKey?.trim() ?? '';
		if (!entryKey) {
			throw badRequest(`Cannot activate web-fetch provider "${active}" without an API key`);
		}
		value = active;
	}

	if (key === WEB_DEEP_SEARCH_CATALOG_KEY) {
		const catalog = parseWebDeepSearchCatalogInput(value);
		if (catalog == null) {
			throw badRequest(
				`WEB_DEEP_SEARCH_CATALOG must be a JSON object with whitelist providers (${WEB_DEEP_SEARCH_PROVIDERS.join(', ')}) and { apiKey: string, pricing: { v: 2, standard, chargedFactor, meteredFactor } ≥ 0 (or legacy metered/standard/charged/cost) }`
			);
		}
		const activeRaw = await repos.systemConfig.getConfig(WEB_DEEP_SEARCH_ACTIVE_KEY);
		const active = parseWebDeepSearchActiveInput(activeRaw);
		if (active) {
			const entryKey = catalog[active]?.apiKey?.trim() ?? '';
			if (!entryKey) {
				throw badRequest(
					`Cannot save WEB_DEEP_SEARCH_CATALOG: active provider "${active}" would have no API key; change WEB_DEEP_SEARCH_ACTIVE first`
				);
			}
		}
		value = serializeWebDeepSearchCatalog(catalog);
	}
	if (key === WEB_DEEP_SEARCH_ACTIVE_KEY) {
		const active = parseWebDeepSearchActiveInput(value);
		if (!active) {
			throw badRequest(`WEB_DEEP_SEARCH_ACTIVE must be one of: ${WEB_DEEP_SEARCH_PROVIDERS.join(', ')}`);
		}
		const catalogRaw = await repos.systemConfig.getConfig(WEB_DEEP_SEARCH_CATALOG_KEY);
		const catalog = parseWebDeepSearchCatalogInput(catalogRaw);
		if (catalog == null) {
			throw badRequest('WEB_DEEP_SEARCH_CATALOG must be configured before setting WEB_DEEP_SEARCH_ACTIVE');
		}
		const entryKey = catalog[active]?.apiKey?.trim() ?? '';
		if (!entryKey) {
			throw badRequest(`Cannot activate web-deep-search provider "${active}" without an API key`);
		}
		value = active;
	}

	if (key === AI_DETECTION_CATALOG_KEY) {
		const catalog = parseAiDetectionCatalogInput(value);
		if (catalog == null) {
			throw badRequest(
				`AI_DETECTION_CATALOG must be a JSON object with whitelist providers (${AI_DETECTION_PROVIDERS.join(', ')}) and credential union + pricing: { v: 2, standard, chargedFactor, meteredFactor } ≥ 0 (or legacy prices; optional billingUnitChars)`
			);
		}
		const activeRaw = await repos.systemConfig.getConfig(AI_DETECTION_ACTIVE_KEY);
		const active = parseAiDetectionActiveInput(activeRaw);
		if (active) {
			if (!isAiDetectionImplementedProvider(active)) {
				throw badRequest(
					`Cannot save AI_DETECTION_CATALOG: active provider "${active}" is not implemented; change AI_DETECTION_ACTIVE first`
				);
			}
			if (
				!entryHasRequiredCredentials(catalog[active], AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS[active])
			) {
				throw badRequest(
					`Cannot save AI_DETECTION_CATALOG: active provider "${active}" would miss required credentials; change AI_DETECTION_ACTIVE first`
				);
			}
		}
		value = serializeAiDetectionCatalog(catalog);
	}
	if (key === AI_DETECTION_ACTIVE_KEY) {
		const active = parseAiDetectionActiveInput(value);
		if (!active) {
			throw badRequest(`AI_DETECTION_ACTIVE must be one of: ${AI_DETECTION_PROVIDERS.join(', ')}`);
		}
		if (!isAiDetectionImplementedProvider(active)) {
			throw badRequest(
				`AI_DETECTION_ACTIVE provider "${active}" is not implemented yet (allowed: ${AI_DETECTION_IMPLEMENTED_PROVIDERS.join(', ')})`
			);
		}
		const catalogRaw = await repos.systemConfig.getConfig(AI_DETECTION_CATALOG_KEY);
		const catalog = parseAiDetectionCatalogInput(catalogRaw);
		if (catalog == null) {
			throw badRequest('AI_DETECTION_CATALOG must be configured before setting AI_DETECTION_ACTIVE');
		}
		if (
			!entryHasRequiredCredentials(catalog[active], AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS[active])
		) {
			throw badRequest(`Cannot activate ai-detection provider "${active}" without required credentials`);
		}
		value = active;
	}
	await repos.systemConfig.upsertSystemConfigValue(key, value);
}

/**
 * 仪表盘汇总：今日业务时区日界请求、活跃密钥数、近期日志/错误、区间 KPI 与去重活跃用户。
 * @param input.range 预设 `1h` | `1d` | `24h` | `7d` | …（无显式起止时默认 `1d`）
 * @param input.startDate / input.endDate UTC `YYYY-MM-DD HH:mm:ss`；与 Request Logs / Analytics 一致，优先于 `range`
 */
export async function getAdminStatsService(
	repos: GatewayRepositories,
	input?: { range?: string; startDate?: string; endDate?: string }
): Promise<AdminStatsOutput> {
	const { startDate, endDate, granularity } = resolveStatsDateRange({
		range: input?.range,
		startDate: input?.startDate,
		endDate: input?.endDate,
	});
	const businessTimeZone = await getBusinessTimezone(repos);
	const { startUtcSql: dayStart, endExclusiveUtcSql: dayEndExclusive } = getBusinessDayWindow(
		new Date(),
		businessTimeZone
	);

	const [
		keysCount,
		accountsCount,
		todayStats,
		recentLogs,
		recentErrors,
		kpiStats,
		activeUsers,
		throughput,
		modelRows,
		userRows,
		timeseries,
	] = await Promise.all([
		repos.apiKeys.getApiKeysCount(),
		repos.users.getUsersCount(),
		repos.requestLogs.getRequestStatsByRange({ startDate: dayStart, endDate: dayEndExclusive, endExclusive: true }),
		repos.requestLogs.getRecentLogs(5),
		repos.requestLogs.getRecentErrors(5),
		repos.requestLogs.getRequestStatsByRange({ startDate, endDate }),
		repos.requestLogs.getDistinctActiveUsersCount({ startDate, endDate }),
		repos.requestLogs.getThroughputLastMinute(),
		repos.analytics.queryModelAnalytics({ start: startDate, end: endDate }),
		repos.analytics.queryUserAnalytics({ start: startDate, end: endDate }),
		repos.requestLogs.queryRequestTimeseries({ startDate, endDate, granularity, timeZone: businessTimeZone }),
	]);

	const modelDistributionMap = new Map<
		string,
		{
			model_id: string;
			request_count: number;
			input_tokens: number;
			output_tokens: number;
			total_tokens: number;
			charged_cost: number;
			metered_cost: number;
			standard_cost: number;
		}
	>();
	for (const row of modelRows) {
		const modelId = String(row.model_id ?? 'unknown');
		const existing = modelDistributionMap.get(modelId) ?? {
			model_id: modelId,
			request_count: 0,
			input_tokens: 0,
			output_tokens: 0,
			total_tokens: 0,
			charged_cost: 0,
			metered_cost: 0,
			standard_cost: 0,
		};
		existing.request_count += Number(row.request_count);
		existing.input_tokens += Number(row.input_tokens);
		existing.output_tokens += Number(row.output_tokens);
		existing.total_tokens += Number(row.input_tokens) + Number(row.output_tokens);
		existing.charged_cost += Number(row.charged_cost);
		existing.metered_cost += Number(row.metered_cost);
		existing.standard_cost += Number(row.standard_cost);
		modelDistributionMap.set(modelId, existing);
	}
	const modelDistribution = [...modelDistributionMap.values()]
		.sort((a, b) => b.request_count - a.request_count)
		.slice(0, 10);

	const topUsers = [...userRows]
		.map((row) => ({
			user_email: String(row.user_email),
			request_count: Number(row.request_count),
			input_tokens: Number(row.input_tokens),
			output_tokens: Number(row.output_tokens),
			total_tokens: Number(row.input_tokens) + Number(row.output_tokens),
			charged_cost: Number(row.charged_cost),
			metered_cost: Number(row.metered_cost),
			standard_cost: Number(row.standard_cost),
		}))
		.sort((a, b) => b.charged_cost - a.charged_cost)
		.slice(0, 12);

	const todayRequestsCount = todayStats.totalRequests;
	const gatewayStats = {
		activeKeysCount: keysCount.active,
		keysTotal: keysCount.total,
		keysActive: keysCount.active,
		accountsTotal: accountsCount.total,
		accountsActive: accountsCount.active,
		todayRequestsCount,
		todayCost: todayStats.chargedCost,
		todayTokens: todayStats.totalTokens,
		errorRate: todayRequestsCount > 0 ? (todayStats.errorCount / todayRequestsCount) * 100 : 0,
	};
	const kpi = {
		totalRequests: kpiStats.totalRequests,
		successRate: kpiStats.totalRequests > 0 ? (kpiStats.successCount / kpiStats.totalRequests) * 100 : 0,
		totalCost: kpiStats.chargedCost,
		meteredCost: kpiStats.meteredCost,
		standardCost: kpiStats.standardCost,
		activeUsers,
		errorRate: kpiStats.totalRequests > 0 ? (kpiStats.errorCount / kpiStats.totalRequests) * 100 : 0,
		inputTokens: kpiStats.inputTokens,
		outputTokens: kpiStats.outputTokens,
		cacheReadTokens: kpiStats.cacheReadTokens,
		cacheWriteTokens: kpiStats.cacheWriteTokens,
		totalTokens: kpiStats.totalTokens,
		avgLatencyMs: kpiStats.avgLatencyMs,
		rpm: throughput.rpm,
		tpm: throughput.tpm,
	};

	return {
		gateway: gatewayStats,
		kpi,
		modelDistribution,
		topUsers,
		timeseries: timeseries.map((row) => ({
			bucket: row.bucket,
			request_count: row.requestCount,
			input_tokens: row.inputTokens,
			output_tokens: row.outputTokens,
			cache_read_tokens: row.cacheReadTokens,
			cache_write_tokens: row.cacheWriteTokens,
			total_tokens: row.totalTokens,
			charged_cost: row.chargedCost,
			avg_latency_ms: row.avgLatencyMs,
			cache_hit_rate: computeCacheHitRate(row.inputTokens, row.cacheReadTokens),
		})),
		granularity,
		recentLogs,
		recentErrors,
	};
}

/**
 * 模型维度分析 + 全量标签列表；时间窗经 `clampAnalyticsRange` 限制最大跨度。
 * @param input.tag 可选，按模型标签过滤（JOIN `model_tags`）
 */
export async function getModelAnalyticsService(
	repos: GatewayRepositories,
	input: {
		start_date?: string;
		end_date?: string;
		tag?: string;
		provider_id?: string;
		user_email?: string;
		user_id?: string;
		api_key_id?: string;
	}
): Promise<AdminModelAnalyticsOutput> {
	const { start, end } = clampAnalyticsRange(input.start_date ?? undefined, input.end_date ?? undefined);
	const tagRaw = input.tag;
	const hasTag = tagRaw != null && tagRaw.trim() !== '';
	const tagValue = hasTag ? tagRaw.trim() : '';
	const providerIdRaw = input.provider_id;
	const hasProviderId = providerIdRaw != null && providerIdRaw.trim() !== '';
	const userEmailRaw = input.user_email;
	const hasUserEmail = userEmailRaw != null && userEmailRaw.trim() !== '';
	const userIdRaw = input.user_id?.trim();
	const apiKeyIdRaw = input.api_key_id?.trim();
	const userId = userIdRaw ? await resolveAdminUserId(repos, userIdRaw) : undefined;
	const rows = await repos.analytics.queryModelAnalytics({
		start,
		end,
		tag: hasTag ? tagValue : undefined,
		providerId: hasProviderId ? providerIdRaw.trim() : undefined,
		userEmail: hasUserEmail ? userEmailRaw.trim() : undefined,
		userId,
		apiKeyId: apiKeyIdRaw || undefined,
	});
	const data = rows.map((r) => {
		const reqCount = Number(r.request_count);
		const successCount = Number(r.success_count);
		const chargedCost = Number(r.charged_cost);
		const inputTokens = Number(r.input_tokens);
		const cacheReadTokens = Number(r.cache_read_tokens ?? 0);
		const cacheWriteTokens = Number(r.cache_write_tokens ?? 0);
		return {
			model_id: r.model_id,
			route_group: r.route_group ?? 'default',
			request_count: reqCount,
			charged_cost: chargedCost,
			metered_cost: Number(r.metered_cost),
			standard_cost: Number(r.standard_cost),
			input_tokens: inputTokens,
			output_tokens: Number(r.output_tokens),
			cache_read_tokens: cacheReadTokens,
			cache_write_tokens: cacheWriteTokens,
			cache_hit_rate: computeCacheHitRate(inputTokens, cacheReadTokens),
			success_count: successCount,
			error_count: Number(r.error_count),
			success_rate: reqCount > 0 ? (successCount / reqCount) * 100 : 0,
			avg_latency_ms: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
			...mapAnalyticsTtftFields(r),
			avg_upstream_response_ms: r.avg_upstream_response_ms != null ? Number(r.avg_upstream_response_ms) : null,
			tokens_per_second: r.tokens_per_second != null ? Number(r.tokens_per_second) : null,
			stream_tokens_per_second: r.stream_tokens_per_second != null ? Number(r.stream_tokens_per_second) : null,
			stream_sample_count: Number(r.stream_sample_count ?? 0),
			failover_rate: Number(r.failover_rate ?? 0),
			failover_request_count: Number(r.failover_request_count ?? 0),
			failover_request_rate: Number(r.failover_request_rate ?? 0),
			avg_attempts: r.avg_attempts != null ? Number(r.avg_attempts) : null,
			avg_charged_per_request: reqCount > 0 ? chargedCost / reqCount : 0,
		};
	}) as AdminModelAnalyticsRow[];
	const tags = await repos.analytics.queryDistinctModelTags();
	return { data, tags };
}

/**
 * 供应商维度分析 + 全量标签列表；时间窗经 `clampAnalyticsRange` 限制最大跨度。
 * @param input.tag 可选，按模型标签过滤（JOIN `model_tags`）
 */
export async function getProviderAnalyticsService(
	repos: GatewayRepositories,
	input: { start_date?: string; end_date?: string; tag?: string; model_id?: string; route_group?: string }
): Promise<AdminProviderAnalyticsOutput> {
	const { start, end } = clampAnalyticsRange(input.start_date ?? undefined, input.end_date ?? undefined);
	const tagRaw = input.tag;
	const hasTag = tagRaw != null && tagRaw.trim() !== '';
	const tagValue = hasTag ? tagRaw.trim() : '';
	const modelIdRaw = input.model_id;
	const hasModelId = modelIdRaw != null && modelIdRaw.trim() !== '';
	const routeGroupRaw = input.route_group;
	const hasRouteGroup = routeGroupRaw != null && routeGroupRaw.trim() !== '';
	const rows = await repos.analytics.queryProviderAnalytics({
		start,
		end,
		tag: hasTag ? tagValue : undefined,
		modelId: hasModelId ? modelIdRaw.trim() : undefined,
		routeGroup: hasRouteGroup ? routeGroupRaw.trim() : undefined,
	});
	const data = rows.map((r) => {
		const reqCount = Number(r.request_count);
		const successCount = Number(r.success_count);
		const chargedCost = Number(r.charged_cost);
		const inputTokens = Number(r.input_tokens);
		const cacheReadTokens = Number(r.cache_read_tokens ?? 0);
		const cacheWriteTokens = Number(r.cache_write_tokens ?? 0);
		const nameRaw = r.provider_name;
		return {
			provider_id: r.provider_id,
			provider_name: nameRaw != null && String(nameRaw).trim() !== '' ? String(nameRaw) : null,
			request_count: reqCount,
			charged_cost: chargedCost,
			metered_cost: Number(r.metered_cost),
			standard_cost: Number(r.standard_cost),
			input_tokens: inputTokens,
			output_tokens: Number(r.output_tokens),
			cache_read_tokens: cacheReadTokens,
			cache_write_tokens: cacheWriteTokens,
			cache_hit_rate: computeCacheHitRate(inputTokens, cacheReadTokens),
			distinct_models: Number(r.distinct_models),
			success_count: successCount,
			error_count: Number(r.error_count),
			success_rate: reqCount > 0 ? (successCount / reqCount) * 100 : 0,
			avg_latency_ms: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
			...mapAnalyticsTtftFields(r),
			avg_upstream_response_ms: r.avg_upstream_response_ms != null ? Number(r.avg_upstream_response_ms) : null,
			tokens_per_second: r.tokens_per_second != null ? Number(r.tokens_per_second) : null,
			stream_tokens_per_second: r.stream_tokens_per_second != null ? Number(r.stream_tokens_per_second) : null,
			stream_sample_count: Number(r.stream_sample_count ?? 0),
			failover_rate: Number(r.failover_rate ?? 0),
			failover_request_count: Number(r.failover_request_count ?? 0),
			failover_request_rate: Number(r.failover_request_rate ?? 0),
			avg_attempts: r.avg_attempts != null ? Number(r.avg_attempts) : null,
			avg_charged_per_request: reqCount > 0 ? chargedCost / reqCount : 0,
		};
	}) as AdminProviderAnalyticsRow[];
	const tags = await repos.analytics.queryDistinctModelTags();
	return { data, tags };
}

/**
 * 用户（邮箱）维度分析；可选邮箱模糊筛。
 */
export async function getUserAnalyticsService(
	repos: GatewayRepositories,
	input: { start_date?: string; end_date?: string; email?: string }
): Promise<AdminUserAnalyticsRow[]> {
	const { start, end } = clampAnalyticsRange(input.start_date ?? undefined, input.end_date ?? undefined);
	const rows = await repos.analytics.queryUserAnalytics({ start, end, email: input.email });
	return rows.map((r) => {
		const reqCount = Number(r.request_count);
		const successCount = Number(r.success_count);
		const budgetMax = r.budget_max != null ? Number(r.budget_max) : null;
		const budgetSpent = Number(r.budget_spent ?? 0);
		const walletGranted = r.wallet_granted != null ? Number(r.wallet_granted) : 0;
		const walletSpent = r.wallet_spent != null ? Number(r.wallet_spent) : 0;
		return {
			user_email: r.user_email,
			request_count: reqCount,
			input_tokens: Number(r.input_tokens),
			output_tokens: Number(r.output_tokens),
			charged_cost: Number(r.charged_cost),
			metered_cost: Number(r.metered_cost),
			standard_cost: Number(r.standard_cost),
			distinct_models: Number(r.distinct_models),
			last_active_at: r.last_active_at,
			budget_max: budgetMax,
			budget_spent: budgetSpent,
			wallet_granted: walletGranted,
			wallet_spent: walletSpent,
			success_count: successCount,
			budget_usage_rate: budgetMax != null && budgetMax > 0 ? (budgetSpent / budgetMax) * 100 : null,
			success_rate: reqCount > 0 ? (successCount / reqCount) * 100 : 0,
			error_count: Number(r.error_count),
		};
	}) as AdminUserAnalyticsRow[];
}

/**
 * 用户下按 API Key 聚合用量；`user_id` 必填（UUID 或 `ext:` 路由）。
 */
export async function getKeyAnalyticsService(
	repos: GatewayRepositories,
	input: { start_date?: string; end_date?: string; user_id?: string }
): Promise<AdminKeyAnalyticsRow[]> {
	const userIdRaw = input.user_id?.trim();
	if (!userIdRaw) throw badRequest('user_id is required');
	const userId = await resolveAdminUserId(repos, userIdRaw);
	const { start, end } = clampAnalyticsRange(input.start_date ?? undefined, input.end_date ?? undefined);
	const rows = await repos.analytics.queryKeyAnalytics({ start, end, userId });
	return rows.map((r) => {
		const reqCount = Number(r.request_count);
		const successCount = Number(r.success_count);
		return {
			api_key_id: r.api_key_id,
			key_name: r.key_name,
			request_count: reqCount,
			input_tokens: Number(r.input_tokens),
			output_tokens: Number(r.output_tokens),
			charged_cost: Number(r.charged_cost),
			metered_cost: Number(r.metered_cost),
			standard_cost: Number(r.standard_cost),
			distinct_models: Number(r.distinct_models),
			last_active_at: r.last_active_at,
			success_count: successCount,
			error_count: Number(r.error_count),
			success_rate: reqCount > 0 ? (successCount / reqCount) * 100 : 0,
		};
	});
}

/**
 * 供应商可靠性 + 模型×供应商矩阵 + 最近错误日志片段。
 */
export async function getReliabilityAnalyticsService(
	repos: GatewayRepositories,
	input: { start_date?: string; end_date?: string }
): Promise<AdminReliabilityAnalyticsOutput> {
	const { start, end } = clampAnalyticsRange(input.start_date ?? undefined, input.end_date ?? undefined);
	const [providers, modelProviders, recentErrors] = await Promise.all([
		repos.analytics.queryProviderReliability({ start, end }),
		repos.analytics.queryModelProviderReliability({ start, end }),
		repos.requestLogs.getRequestLogs({ page: 1, pageSize: 10, status: 'error', startDate: start, endDate: end }).then((result) => result.logs),
	]);

	const providerRows = providers.map((r) => {
		const requestCount = Number(r.request_count);
		return {
			provider_id: r.provider_id,
			provider_name: r.provider_name ?? null,
			request_count: requestCount,
			success_count: Number(r.success_count),
			error_count: Number(r.error_count),
			success_rate: requestCount > 0 ? (Number(r.success_count) / requestCount) * 100 : 0,
			avg_latency_ms: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
			...mapAnalyticsTtftFields(r),
			avg_upstream_response_ms: r.avg_upstream_response_ms != null ? Number(r.avg_upstream_response_ms) : null,
			failover_rate: Number(r.failover_rate ?? 0),
			failover_request_count: Number(r.failover_request_count ?? 0),
			failover_request_rate: Number(r.failover_request_rate ?? 0),
			avg_attempts: r.avg_attempts != null ? Number(r.avg_attempts) : null,
			charged_cost: Number(r.charged_cost),
			metered_cost: Number(r.metered_cost),
			standard_cost: Number(r.standard_cost),
		};
	}) as AdminReliabilityProviderRow[];
	const modelProviderRows = modelProviders.map((r) => {
		const requestCount = Number(r.request_count);
		return {
			model_id: r.model_id,
			provider_id: r.provider_id,
			provider_name: r.provider_name ?? null,
			request_count: requestCount,
			success_rate: requestCount > 0 ? (Number(r.success_count) / requestCount) * 100 : 0,
			avg_latency_ms: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
			...mapAnalyticsTtftFields(r),
			avg_upstream_response_ms: r.avg_upstream_response_ms != null ? Number(r.avg_upstream_response_ms) : null,
			failover_rate: Number(r.failover_rate ?? 0),
			failover_request_count: Number(r.failover_request_count ?? 0),
			failover_request_rate: Number(r.failover_request_rate ?? 0),
			avg_attempts: r.avg_attempts != null ? Number(r.avg_attempts) : null,
			charged_cost: Number(r.charged_cost),
			metered_cost: Number(r.metered_cost),
			standard_cost: Number(r.standard_cost),
		};
	}) as AdminReliabilityModelProviderRow[];

	return {
		providers: providerRows,
		modelProviders: modelProviderRows,
		recentErrors,
	};
}
