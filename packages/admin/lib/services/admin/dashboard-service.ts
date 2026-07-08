/**
 * 管理后台聚合服务：仪表盘 KPI、全局请求日志列表、`system_config` 读写，以及模型/供应商/用户/可靠性分析 API 的数据装配。
 */
import type { GatewayRepositories } from '@octafuse/core';
import { BILLING_CURRENCY_KEY, tryParseGatewaySupportedBillingCurrencyInput } from '@octafuse/core/lib/billing-currency';
import { badRequest } from './errors';
import { clampAnalyticsRange, rangeToDates } from './shared';
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
		event_type?: string;
		actor_type?: string;
		reason_code?: string;
		source?: string;
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
		eventType: input.event_type,
		actorType: input.actor_type,
		reasonCode: input.reason_code,
		source: input.source,
		correlationId: input.correlation_id,
		startDate: input.start_date,
		endDate: input.end_date,
	});
	return { ...result, page, page_size: pageSize };
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
	await repos.systemConfig.upsertSystemConfigValue(key, value);
}

/**
 * 仪表盘汇总：今日业务时区日界请求、活跃密钥数、近期日志/错误、区间 KPI 与去重活跃用户。
 * @param range 如 `1h` | `1d` | `24h` | `7d` | `14d` | `30d` | `90d`，默认 `7d`；用于 KPI 时间窗（非「今日」卡片）
 */
export async function getAdminStatsService(repos: GatewayRepositories, range?: string): Promise<AdminStatsOutput> {
	const { startDate, endDate } = rangeToDates(range ?? '7d');
	const businessTimeZone = await getBusinessTimezone(repos);
	const { startUtcSql: dayStart, endExclusiveUtcSql: dayEndExclusive } = getBusinessDayWindow(
		new Date(),
		businessTimeZone
	);

	const [activeKeysCount, todayStats, recentLogs, recentErrors, kpiStats, activeUsers] = await Promise.all([
		repos.apiKeys.getActiveApiKeysCount(),
		repos.requestLogs.getRequestStatsByRange({ startDate: dayStart, endDate: dayEndExclusive, endExclusive: true }),
		repos.requestLogs.getRecentLogs(5),
		repos.requestLogs.getRecentErrors(5),
		repos.requestLogs.getRequestStatsByRange({ startDate, endDate }),
		repos.requestLogs.getDistinctActiveUsersCount({ startDate, endDate }),
	]);
	const todayRequestsCount = todayStats.totalRequests;
	const gatewayStats = {
		activeKeysCount,
		todayRequestsCount,
		todayCost: todayStats.chargedCost,
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
	};

	return {
		gateway: gatewayStats,
		kpi,
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
		return {
			model_id: r.model_id,
			route_group: r.route_group ?? 'default',
			request_count: reqCount,
			charged_cost: chargedCost,
			metered_cost: Number(r.metered_cost),
			standard_cost: Number(r.standard_cost),
			input_tokens: Number(r.input_tokens),
			output_tokens: Number(r.output_tokens),
			success_count: successCount,
			error_count: Number(r.error_count),
			success_rate: reqCount > 0 ? (successCount / reqCount) * 100 : 0,
			avg_latency_ms: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
			avg_first_token_ms: r.avg_first_token_ms != null ? Number(r.avg_first_token_ms) : null,
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
		const nameRaw = r.provider_name;
		return {
			provider_id: r.provider_id,
			provider_name: nameRaw != null && String(nameRaw).trim() !== '' ? String(nameRaw) : null,
			request_count: reqCount,
			charged_cost: chargedCost,
			metered_cost: Number(r.metered_cost),
			standard_cost: Number(r.standard_cost),
			input_tokens: Number(r.input_tokens),
			output_tokens: Number(r.output_tokens),
			distinct_models: Number(r.distinct_models),
			success_count: successCount,
			error_count: Number(r.error_count),
			success_rate: reqCount > 0 ? (successCount / reqCount) * 100 : 0,
			avg_latency_ms: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
			avg_first_token_ms: r.avg_first_token_ms != null ? Number(r.avg_first_token_ms) : null,
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
