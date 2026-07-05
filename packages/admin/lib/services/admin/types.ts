/**
 * 管理后台 API 的请求/响应 TypeScript 类型（与 Hono 路由 JSON 契约对应）。
 * 下列按路由分组用注释隔开，便于检索。
 */
import type {
	ApiKeyBudgetAuditLogRow,
	GlobalApiKeyBudgetAuditLogRow,
	RequestLogRow,
} from '@octafuse/core';
import type { ModelRouteJoinRow } from '@octafuse/core';

export type BudgetPeriod = 'none' | 'daily' | 'weekly' | 'monthly';

export type JsonObject = Record<string, unknown>;
export type AdminDataRow = Record<string, unknown>;

/** ---------- `/admin/users` 请求体 ---------- */
export type AdminUserCreateInput = {
	external_system?: string | null;
	external_user_id?: string | null;
	email: string;
	budget_max?: number | null;
	budget_base?: number | null;
	budget_period?: BudgetPeriod;
	metadata?: unknown;
};

export type AdminUserUpdateInput = {
	email?: string | null;
	budget_max?: number | null;
	budget_base?: number | null;
	budget_spent?: number | null;
	budget_period?: BudgetPeriod;
	reset_budget?: boolean;
	budget_reset_at?: string | null;
	reason?: string;
	metadata?: unknown;
	metadata_replace?: unknown;
	status?: string;
	/**
	 * 外部身份对：要么两者都为非空字符串（链接到上游），要么两者都为 null
	 * （清除链接，回到 Gateway-only internal user）。任一字段被显式提供即视为
	 * 一次原子更新；未提供则保持原值。
	 */
	external_system?: string | null;
	external_user_id?: string | null;
};

/** ---------- `/admin/users/:id/budget/transition` 请求体 ---------- */
export type AdminBudgetTransitionInput = {
	target_budget_base: number;
	budget_period: BudgetPeriod;
	budget_reset_at?: string | null;
	carryover_strategy?: 'remaining_or_overage' | 'none';
	reset_spent?: boolean;
	metadata?: Record<string, unknown>;
	reason?: string;
};

export type AdminBudgetTransitionSnapshot = {
	budget_max: number | null;
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
};

export type AdminBudgetTransitionPreviewOutput = {
	before: AdminBudgetTransitionSnapshot;
	after: AdminBudgetTransitionSnapshot;
	carryover: number;
};

/** ---------- `/admin/keys` 请求体 ---------- */
export type AdminKeyCreateInput = {
	/** 已有用户时直接关联；与 `external_system` + `external_user_id` 二选一 */
	user_id?: string;
	external_system?: string | null;
	external_user_id?: string | null;
	/** 通过外部身份新建用户时必填（写入 `users.email`） */
	email?: string | null;
	name?: string | null;
	metadata?: unknown;
	/** 写入 `key_created` 审计的 `reason_text`（仅本次真正新建密钥时） */
	reason?: string;
};

export type AdminKeyUpdateInput = {
	metadata?: unknown;
	metadata_replace?: unknown;
	status?: string;
	name?: string | null;
	reason?: string;
};

/** ---------- `/admin/providers` 请求体（字段多为 unknown 以承接 JSON） ---------- */
export type AdminProviderMutationInput = {
	id?: unknown;
	name?: unknown;
	base_url_openai?: unknown;
	base_url_anthropic?: unknown;
	base_url_gemini?: unknown;
	api_key?: unknown;
	description?: unknown;
	[key: string]: unknown;
};

/** ---------- `/admin/providers/:id/keys` 请求体 ---------- */
export type AdminProviderKeyMutationInput = {
	label?: unknown;
	api_key?: unknown;
	status?: 'active' | 'disabled';
	weight?: unknown;
	priority?: unknown;
	/** 限流配置 JSON 字符串（`{"rpm":…,"tpm":…,"max_concurrency":…}`）；null/空串清空 */
	limit_config?: unknown;
};

/** `GET /admin/providers/import/catalog`：内置 Provider 模板摘要（无密钥）。`id` 为 catalog 行键（数组下标），非入库 provider id。 */
export type AdminProviderImportCatalogItem = {
	id: string;
	name: string;
	vendor_key: string;
	vendor_label: string;
	protocols: Array<'openai' | 'anthropic' | 'gemini'>;
	base_url_openai: string | null;
	base_url_anthropic: string | null;
	base_url_gemini: string | null;
	description: string | null;
};

/** `POST /admin/providers/import` 请求体：导入选中的 catalog 键（`GET .../catalog` 返回的 `id`）。 */
export type AdminProvidersImportBody = {
	ids: string[];
};

/** `POST /admin/providers/import`：从静态模板创建 `providers` 行；每次导入新增；`skipped_existing` 恒为空（兼容字段）。 */
export type AdminProvidersImportOutput = {
	created: number;
	/** 与 `/admin/models/import` 对齐，恒为 `0`。 */
	updated: number;
	/** 兼容字段；重复导入同一模板不再跳过，恒为空数组。 */
	skipped_existing: string[];
	failed: Array<{ id: string; message: string }>;
};

/** ---------- `/admin/models` 请求体 ---------- */
export type AdminModelMutationInput = {
	id?: unknown;
	display_name?: unknown;
	vendor?: unknown;
	context_window?: unknown;
	max_tokens?: unknown;
	/**
	 * 定价 profile：`{ "tiers": [...] }` JSON；写入前由 `coerceModelPricingProfileInput` 校验。
	 * 空字符串 / null 表示清除（PATCH 时）。
	 */
	pricing_profile?: unknown;
	description?: unknown;
	metadata?: unknown;
	tags?: unknown;
	[key: string]: unknown;
};

/** ---------- `/admin/routes` 请求体 ---------- */
export type AdminModelRouteMutationInput = {
	id?: unknown;
	model_id?: unknown;
	provider_id?: unknown;
	provider_model_name?: unknown;
	priority?: unknown;
	status?: unknown;
	route_group?: unknown;
	/** JSON string or object; may contain `metered`, `charged`, `provider_factor`, `charged_factor`, `metered_factor`; normalized by `coerceRoutePriceOverrideInput`. **POST `/admin/routes` requires both `metered` and `charged` with ≥1 tier each; PATCH with `price_override` enforces the same.** */
	price_override?: unknown;
	custom_params?: unknown;
	upstream_protocol?: unknown;
	[key: string]: unknown;
};

/** ---------- `/admin/config` PUT 单键更新 ---------- */
export type AdminConfigUpdateInput = {
	key?: string;
	value?: string;
};

/** 创建类接口统一返回新生成 id */
export type AdminCreatedIdOutput = {
	id: string;
};

/** `GET /admin/models/import/catalog`：可导入的静态预设摘要（不含完整 pricing JSON）。 */
export type AdminStaticModelPresetCatalogItem = {
	id: string;
	display_name: string | null;
	vendor: string;
	context_window: number | null;
	max_tokens: number | null;
	/** `pricing.usd` 档位数，便于预览阶梯 */
	tier_count_usd: number;
	/** USD 分支价格摘要（每档一行，单位为每百万 token）。 */
	pricing_preview_usd: string | null;
};

/** `POST /admin/models/import` 请求体：仅导入选中的预设 id。 */
export type AdminModelsImportBody = {
	ids: string[];
};

/** `POST /admin/models/import`：从内置静态目录按当前 `BILLING_CURRENCY` 选用 USD/CNY 价写入库。 */
export type AdminModelsImportOutput = {
	/** 实际选用的价格分支（与 `BILLING_CURRENCY` 一致，非法历史值时回退为 USD） */
	billing_currency_used: string;
	created: number;
	/** 始终为 `0`：已存在的 model id 不会被覆盖（见 `skipped_existing`）。 */
	updated: number;
	/** 请求中出现、但库中已存在同 id 因而未导入的 id（不覆盖已有行）。 */
	skipped_existing: string[];
	failed: Array<{ id: string; message: string }>;
};

/** ---------- 列表/详情行（与 D1 + JOIN 列对齐） ---------- */
export type AdminProviderRow = {
	id: string;
	name: string;
	base_url_openai: string | null;
	base_url_anthropic: string | null;
	base_url_gemini: string | null;
	description: string | null;
	created_at: string;
	active_key_count?: number;
	has_pending_key?: boolean;
	[key: string]: unknown;
};

export type AdminModelRow = {
	id: string;
	display_name: string | null;
	vendor: string;
	context_window: number | null;
	max_tokens: number | null;
	pricing_profile: string | null;
	input_modalities: string | null;
	output_modalities: string | null;
	released_at: string | null;
	description: string | null;
	metadata: string | null;
	/** 粘性 key 路由配置 JSON；null=无粘性 */
	sticky_config?: string | null;
	created_at: string;
	routes_count?: number;
	active_routes_count?: number;
	tags?: string[];
	[key: string]: unknown;
};

export type AdminModelRouteRow = ModelRouteJoinRow & {
	model_name?: string | null;
	provider_name?: string | null;
	[key: string]: unknown;
};

/** `GET /admin/keys` 单行 */
export type AdminKeyListItem = {
	id: string;
	key: string;
	user_id: string;
	name: string | null;
	user_email: string | null;
	budget_max: number | null;
	/** 订阅套餐基础上限（周期 reset 后 `budget_max` 复位至此） */
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
	status: string;
	metadata: string | null;
	created_at: string;
	updated_at: string;
	[key: string]: unknown;
};

export type AdminKeyListOutput = {
	data: AdminKeyListItem[];
	total: number;
	page: number;
	page_size: number;
};

export type AdminKeyCreateOutput = {
	key: string;
	key_id: string;
	user_id: string;
};

export type AdminKeyLogsOutput = {
	logs: RequestLogRow[];
	total: number;
	page: number;
	page_size: number;
};

export type AdminKeyBudgetAuditLogsOutput = {
	logs: ApiKeyBudgetAuditLogRow[];
	total: number;
	page: number;
	page_size: number;
};

/** 全局预算审计列表（行含 `user_email`，来自 JOIN `api_keys`）。 */
export type AdminGlobalBudgetAuditLogsOutput = {
	logs: GlobalApiKeyBudgetAuditLogRow[];
	total: number;
	page: number;
	page_size: number;
};

export type AdminKeyUpdateOutput =
	| {
			id: string;
			updated: true;
	  }
	| {
			id: string;
			key_id: string;
			user_id: string;
			name: string | null;
			user_email: string | null;
			budget_max: number | null;
			budget_base?: number;
			budget_spent: number;
			budget_period: string;
			budget_reset_at: string | null;
			metadata?: JsonObject;
	  };

export type AdminKeyDetailOutput = {
	id: string;
	key: string;
	user_id: string;
	name: string | null;
	user_email: string | null;
	budget_max: number | null;
	/** 订阅套餐基础上限（周期 reset 后 `budget_max` 复位至此） */
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
	status: string;
	metadata?: JsonObject;
	created_at: string;
	updated_at: string;
	spend: number;
	max_budget: number | null;
};

/** ---------- `/admin/request-logs` ---------- */
export type AdminRequestLogListItem = RequestLogRow;

export type AdminRequestLogsOutput = {
	logs: AdminRequestLogListItem[];
	total: number;
	page: number;
	page_size: number;
};

/** `GET /admin/config` 单行 */
export type AdminConfigRow = {
	key: string;
	value: string;
	description: string | null;
};

/** `GET /admin/stats` 仪表盘数据结构 */
export type AdminStatsOutput = {
	gateway: {
		activeKeysCount: number;
		todayRequestsCount: number;
		todayCost: number;
		errorRate: number;
	};
	kpi: {
		totalRequests: number;
		successRate: number;
		totalCost: number;
		meteredCost: number;
		standardCost: number;
		activeUsers: number;
		errorRate: number;
	};
	recentLogs: RequestLogRow[];
	recentErrors: RequestLogRow[];
};

/** ---------- `/admin/analytics/*` 装配后的行类型 ---------- */
export type AdminModelAnalyticsRow = {
	model_id: unknown;
	route_group: string;
	request_count: number;
	charged_cost: number;
	metered_cost: number;
	standard_cost: number;
	input_tokens: number;
	output_tokens: number;
	success_count: number;
	error_count: number;
	success_rate: number;
	avg_latency_ms: number | null;
	avg_charged_per_request: number;
};

export type AdminModelAnalyticsOutput = {
	data: AdminModelAnalyticsRow[];
	tags: string[];
};

export type AdminProviderAnalyticsRow = {
	provider_id: unknown;
	provider_name: string | null;
	request_count: number;
	charged_cost: number;
	metered_cost: number;
	standard_cost: number;
	input_tokens: number;
	output_tokens: number;
	distinct_models: number;
	success_count: number;
	error_count: number;
	success_rate: number;
	avg_latency_ms: number | null;
	avg_charged_per_request: number;
};

export type AdminProviderAnalyticsOutput = {
	data: AdminProviderAnalyticsRow[];
	tags: string[];
};

export type AdminUserAnalyticsRow = {
	user_email: unknown;
	request_count: number;
	input_tokens: number;
	output_tokens: number;
	charged_cost: number;
	metered_cost: number;
	standard_cost: number;
	distinct_models: number;
	last_active_at: unknown;
	budget_max: number | null;
	budget_spent: number;
	budget_usage_rate: number | null;
	success_rate: number;
	error_count: number;
};

export type AdminReliabilityProviderRow = {
	provider_id: unknown;
	request_count: number;
	success_count: number;
	error_count: number;
	success_rate: number;
	avg_latency_ms: number | null;
	charged_cost: number;
	metered_cost: number;
	standard_cost: number;
};

export type AdminReliabilityModelProviderRow = {
	model_id: unknown;
	provider_id: unknown;
	request_count: number;
	success_rate: number;
	avg_latency_ms: number | null;
	charged_cost: number;
	metered_cost: number;
	standard_cost: number;
};

export type AdminReliabilityAnalyticsOutput = {
	providers: AdminReliabilityProviderRow[];
	modelProviders: AdminReliabilityModelProviderRow[];
	recentErrors: RequestLogRow[];
};
