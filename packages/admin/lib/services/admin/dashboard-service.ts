/**
 * 管理后台聚合服务：仪表盘 KPI、全局请求日志列表、`system_config` 读写，以及模型/供应商/用户/可靠性分析 API 的数据装配。
 */
import type { GatewayRepositories } from '@octafuse/core';
import { BILLING_CURRENCY_KEY, tryParseGatewaySupportedBillingCurrencyInput } from '@octafuse/core/lib/billing-currency';
import {
	parseWebSearchActiveInput,
	parseWebSearchCatalogInput,
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
	WEB_FETCH_ACTIVE_KEY,
	WEB_FETCH_API_KEY_KEY,
	WEB_FETCH_CATALOG_KEY,
	WEB_FETCH_COST_KEY,
	WEB_FETCH_PROVIDER_KEY,
	WEB_FETCH_PROVIDERS,
} from '@octafuse/core/lib/web-fetch-system-config';
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
	AdminRequestLogsOutput,
	AdminStatsOutput,
	AdminUserAnalyticsRow,
	AdminGlobalBudgetAuditLogsOutput,
} from './types';

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
		api_key_id?: string;
		user_email?: string;
		model_id?: string;
		provider_id?: string;
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
		apiKeyId: input.api_key_id,
		userEmail: input.user_email,
		modelId: input.model_id,
		providerId: input.provider_id,
		routeGroup: input.route_group,
		protocol,
		status: input.status,
		startDate: input.start_date,
		endDate: input.end_date,
	});
	return { ...result, page, page_size: pageSize };
}

/**
 * 全局 `user_audit_logs` 分页（可选 api_key_id、user_email、event_type、actor_type、时间窗）。
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
		reason_code?: string | string[];
		source?: string | string[];
		correlation_id?: string;
		start_date?: string;
		end_date?: string;
	}
): Promise<AdminGlobalBudgetAuditLogsOutput> {
	const page = Math.max(1, Number.parseInt(String(input.page ?? '1'), 10));
	const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(input.page_size ?? '20'), 10)));
	const eventTypes = (Array.isArray(input.event_type) ? input.event_type : input.event_type ? [input.event_type] : [])
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter((value, index, values) => value !== '' && values.indexOf(value) === index);
	const actorTypes = (Array.isArray(input.actor_type) ? input.actor_type : input.actor_type ? [input.actor_type] : [])
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter((value, index, values) => value !== '' && values.indexOf(value) === index);
	const reasonCodes = (Array.isArray(input.reason_code) ? input.reason_code : input.reason_code ? [input.reason_code] : [])
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter((value, index, values) => value !== '' && values.indexOf(value) === index);
	const sources = (Array.isArray(input.source) ? input.source : input.source ? [input.source] : [])
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter((value, index, values) => value !== '' && values.indexOf(value) === index);
	const result = await repos.userAuditLogs.getGlobalUserAuditLogs({
		page,
		pageSize,
		userId: input.user_id,
		apiKeyId: input.api_key_id,
		userEmail: input.user_email,
		eventTypes: eventTypes.length > 0 ? eventTypes : undefined,
		actorTypes: actorTypes.length > 0 ? actorTypes : undefined,
		reasonCodes: reasonCodes.length > 0 ? reasonCodes : undefined,
		sources: sources.length > 0 ? sources : undefined,
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
	let value = body.value == null ? '' : String(body.value);
	if (key === BILLING_CURRENCY_KEY) {
		const parsed = tryParseGatewaySupportedBillingCurrencyInput(value);
		if (!parsed) {
			throw badRequest('BILLING_CURRENCY must be USD or CNY');
		}
		value = parsed;
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
				`WEB_SEARCH_CATALOG must be a JSON object with whitelist providers (${WEB_SEARCH_PROVIDERS.join(', ')}) and { apiKey: string, cost: number }`
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
		value = JSON.stringify(catalog);
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
				`WEB_FETCH_CATALOG must be a JSON object with whitelist providers (${WEB_FETCH_PROVIDERS.join(', ')}) and { apiKey: string, cost: number }`
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
		value = JSON.stringify(catalog);
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
		repos.requestLogs.queryRequestTimeseries({ startDate, endDate, granularity }),
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
	input: { start_date?: string; end_date?: string; tag?: string; provider_id?: string; user_email?: string }
): Promise<AdminModelAnalyticsOutput> {
	const { start, end } = clampAnalyticsRange(input.start_date ?? undefined, input.end_date ?? undefined);
	const tagRaw = input.tag;
	const hasTag = tagRaw != null && tagRaw.trim() !== '';
	const tagValue = hasTag ? tagRaw.trim() : '';
	const providerIdRaw = input.provider_id;
	const hasProviderId = providerIdRaw != null && providerIdRaw.trim() !== '';
	const userEmailRaw = input.user_email;
	const hasUserEmail = userEmailRaw != null && userEmailRaw.trim() !== '';
	const rows = await repos.analytics.queryModelAnalytics({
		start,
		end,
		tag: hasTag ? tagValue : undefined,
		providerId: hasProviderId ? providerIdRaw.trim() : undefined,
		userEmail: hasUserEmail ? userEmailRaw.trim() : undefined,
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
			failover_rate: Number(r.failover_rate ?? 0),
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
			failover_rate: Number(r.failover_rate ?? 0),
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
			budget_usage_rate: budgetMax != null && budgetMax > 0 ? (budgetSpent / budgetMax) * 100 : null,
			success_rate: reqCount > 0 ? (successCount / reqCount) * 100 : 0,
			error_count: Number(r.error_count),
		};
	}) as AdminUserAnalyticsRow[];
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
		repos.requestLogs.getRecentErrors(10),
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
			avg_upstream_response_ms: r.avg_upstream_response_ms != null ? Number(r.avg_upstream_response_ms) : null,
			failover_rate: Number(r.failover_rate ?? 0),
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
			avg_upstream_response_ms: r.avg_upstream_response_ms != null ? Number(r.avg_upstream_response_ms) : null,
			failover_rate: Number(r.failover_rate ?? 0),
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
