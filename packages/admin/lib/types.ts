/**
 * Gateway Admin 与 Worker 代理 JSON 对齐的 TypeScript 类型（字段名与 API 一致）。
 * 行内英文注释便于与网关迁移、列名对照；业务含义以 octafuse 为准。
 */

// ============== 网关实体（Keys / Providers / Models / Routes / Logs）=============

export type BudgetPeriod = 'none' | 'daily' | 'weekly' | 'monthly';

export interface GatewayApiKey {
  id: string;
  key: string;
  user_id: string;
  /** 密钥展示名（`api_keys.name`） */
  name?: string | null;
  user_email: string | null;
  budget_max: number | null;
  /** 订阅套餐基础上限（周期 reset 后 `budget_max` 复位至此） */
  budget_base?: number;
  budget_spent: number;
  budget_period: string;
  budget_reset_at: string | null;
  status: string;
  /** JSON string; extensible key data (e.g. plan), surfaced on GET /v1/me */
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

/** `user_audit_logs` 行；全局列表 JOIN `users` 后带 `user_email`。预算周期等扩展在 `change_payload` JSON。 */
export interface GatewayApiKeyBudgetAuditLog {
  id: string;
  user_id: string;
  api_key_id: string | null;
  event_type: string;
  actor_type: string;
  actor_id?: string | null;
  reason_code?: string | null;
  reason_text?: string | null;
  /** 由 `before_user_snapshot` / `after_user_snapshot` 派生 */
  before_spent: number;
  delta_spent: number;
  after_spent: number;
  before_budget_max: number | null;
  after_budget_max: number | null;
  /** 由快照派生 */
  before_budget_base: number;
  after_budget_base: number;
  before_budget_period?: string | null;
  after_budget_period?: string | null;
  before_budget_reset_at?: string | null;
  after_budget_reset_at?: string | null;
  request_log_id: string | null;
  /** 结构化扩展（预算周期前后、管理端 patch 等）；原 `metadata` */
  change_payload: string | null;
  /** JSON：用户行快照（`UserAuditSnapshot`） */
  before_user_snapshot?: string | null;
  after_user_snapshot?: string | null;
  /** JSON string array：变更字段名 */
  changed_fields?: string | null;
  correlation_id?: string | null;
  source?: string | null;
  created_at: string;
  user_email?: string | null;
}

/** `GET /admin/users` 列表行（含 `active_keys_count`）。 */
export interface GatewayUserListItem {
  id: string;
  email: string;
  external_system: string | null;
  external_user_id: string | null;
  budget_max: number | null;
  budget_base: number;
  budget_spent: number;
  budget_period: string;
  budget_reset_at: string | null;
  status: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  active_keys_count: number;
}

/** 与 octafuse `ApiKeyBudgetAuditEventType` 对齐（筛选下拉与网关枚举一致） */
export const API_KEY_BUDGET_AUDIT_EVENT_TYPES = [
  'usage_charge',
  'period_reset',
  'admin_adjust',
  'key_created',
] as const;

/** 与 octafuse `ApiKeyBudgetAuditActorType` 对齐 */
export const API_KEY_BUDGET_AUDIT_ACTOR_TYPES = ['system', 'admin', 'service'] as const;

export interface GatewayProvider {
  id: string;
  name: string;
  /** OpenAI-compatible upstream base */
  base_url_openai: string | null;
  base_url_anthropic?: string | null;
  base_url_gemini?: string | null;
  api_key: string;
  description: string | null;
  created_at: string;
}

export interface GatewayModel {
  id: string;
  display_name: string | null;
  /** Vendor / manufacturer (e.g. Anthropic, OpenAI). Default stored value: other */
  vendor: string;
  context_window: number | null;
  max_tokens: number;
  /** `{ "tiers": [...] }` JSON；与 `models.pricing_profile` 一致 */
  pricing_profile?: string | null;
  supports_images: number;
  /** JSON array string from json_group_array(model_tags.tag) */
  tags: string;
  description: string | null;
  metadata: string | null;
  created_at: string;
  /** Count of active routes associated with this model */
  active_routes_count?: number;
  /** Total count of routes associated with this model */
  routes_count?: number;
}

export interface GatewayModelRoute {
  id: string;
  model_id: string;
  provider_id: string;
  provider_model_name: string;
  priority: number;
  status: string;
  /** Route channel: e.g. default, free (gateway migration 0016) */
  route_group: string;
  price_override: string | null;
  /** JSON object string: route-level request body defaults (merged with client body; client wins) */
  custom_params: string | null;
  /** NOT NULL DEFAULT 'openai' after gateway migration 0011 */
  upstream_protocol: string;
}

export interface GatewayRequestLog {
  id: string;
  user_id?: string | null;
  api_key_id: string | null;
  user_email: string | null;
  model_id: string | null;
  provider_id: string | null;
  /** 展示名快照（`api_key_request_logs.model_name`，读接口不 JOIN catalog） */
  model_name?: string | null;
  request_protocol?: string | null;
  /** 所选路由的上游协议快照（`model_routes.upstream_protocol`）；旧行可能缺省 */
  upstream_protocol?: string | null;
  /** 供应商展示名快照（`api_key_request_logs.provider_name`） */
  provider_name?: string | null;
  /** Upstream model name snapshot on the log row (Gateway writes at request time); null on legacy rows */
  provider_model_name?: string | null;
  /** 脱敏请求体 JSON（无提示词）；仅新写入 */
  request_body?: string | null;
  /** 脱敏上游 wire 体（路由合并默认参数后）；迁移前旧行为 null */
  upstream_request_body?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens?: number;
  total_tokens?: number;
  /** Catalog / model list price valuation (no route price_override) */
  standard_cost?: number;
  /** Token-based supplier valuation (route override if set) */
  metered_cost: number;
  /** Amount applied to user budget */
  charged_cost: number;
  /** Route group snapshot on the log row (default `default` for pre-migration rows) */
  route_group?: string;
  status: string;
  latency_ms: number | null;
  error_message: string | null;
  /** Raw usage payload from upstream/provider (JSON string) */
  raw_usage?: string | null;
  /** 计费审计 JSON（单列）；结构见 `@octafuse/core` `pricing-audit.ts` */
  pricing_audit?: string | null;
  created_at: string;
}

/** `system_config` row shape (Gateway D1; admin UI loads via Gateway Worker proxy). */
export interface SystemConfigRow {
  key: string;
  value: string;
  description: string | null;
}

export interface DashboardStats {
  gateway: {
    activeKeysCount: number;
    todayRequestsCount: number;
    todayCost: number;
    errorRate: number;
  };
  /** When time range is used (e.g. 24h, 7d, 30d), KPI for that range. */
  kpi?: KpiMetrics;
  recentLogs: GatewayRequestLog[];
  recentErrors: GatewayRequestLog[];
}

// ============== 分析 / 仪表盘 KPI ==============

/** Common filter for analytics APIs. startDate/endDate in ISO date or datetime. */
export interface AnalyticsFilter {
  startDate?: string;
  endDate?: string;
  /** For user stats: filter by email (LIKE). */
  email?: string;
}

/**
 * Cost columns aggregated from `api_key_request_logs` in Worker analytics APIs.
 * `standard_cost` 为目录价合计；旧网关或未迁移库可能缺省。
 */
export interface AnalyticsRowCosts {
  standard_cost?: number;
  charged_cost: number;
  metered_cost: number;
}

/** KPI metrics for dashboard overview (time-bounded). */
export interface KpiMetrics {
  totalRequests: number;
  successRate: number;
  /** Sum of charged_cost (user spend) */
  totalCost: number;
  /** Sum of standard_cost (catalog / model list price); omitted on older gateways */
  standardCost?: number;
  /** Sum of metered_cost (upstream token valuation) */
  meteredCost: number;
  activeUsers: number;
  errorRate: number;
}

/** One row for model usage aggregation. */
export interface ModelUsageRow extends AnalyticsRowCosts {
  model_id: string;
  route_group: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  success_count: number;
  error_count: number;
  success_rate: number;
  avg_latency_ms: number | null;
  avg_charged_per_request: number;
}

/** One row for provider usage aggregation. */
export interface ProviderUsageRow extends AnalyticsRowCosts {
  provider_id: string;
  provider_name: string | null;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  distinct_models: number;
  success_count: number;
  error_count: number;
  success_rate: number;
  avg_latency_ms: number | null;
  avg_charged_per_request: number;
}

/** One row for user usage aggregation (with budget from api_keys). */
export interface UserUsageRow extends AnalyticsRowCosts {
  user_email: string;
  request_count: number;
  distinct_models: number;
  last_active_at: string | null;
  budget_max: number | null;
  budget_spent: number;
  budget_usage_rate: number | null;
  success_rate: number;
  error_count: number;
}

/** One row for provider reliability. */
export interface ProviderReliabilityRow extends AnalyticsRowCosts {
  provider_id: string;
  request_count: number;
  success_count: number;
  error_count: number;
  success_rate: number;
  avg_latency_ms: number | null;
}

/** Model + provider breakdown for reliability (same model, multiple providers). */
export interface ModelProviderRow extends AnalyticsRowCosts {
  model_id: string;
  provider_id: string;
  request_count: number;
  success_rate: number;
  avg_latency_ms: number | null;
}

// ============== 通用 API 响应包装 ==============

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  count?: number;
  total?: number;
  page?: number;
  page_size?: number;
}
