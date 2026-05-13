/**
 * 全局类型：D1 行映射与业务枚举（与 migrations-d1 列语义对齐）。
 */

/** 用户密钥预算周期。 */
export type BudgetPeriod = 'none' | 'daily' | 'weekly' | 'monthly';

export type ApiKeyBudgetAuditEventType =
	| 'usage_charge'
	| 'period_reset'
	| 'admin_adjust'
	| 'key_created';

export type ApiKeyBudgetAuditActorType = 'system' | 'admin' | 'service';

/** `api_keys` 表行（密钥明文存库）。 */
export interface ApiKeyRow {
  id: string;
  key: string;
  user_id: string;
  user_email: string | null;
  budget_max: number | null;
  /**
   * 周期 reset 时 `budget_max` 的恢复基准（非空，缺省 0）。
   * 当 `budget_period` 到期触发 lazy reset 时，`budget_max` 会被回写为 `budget_base`；
   * 调用方临时调高 `budget_max` 而不希望被周期回收时，需要保持 `budget_base` 不变。
   */
  budget_base: number;
  budget_spent: number;
  budget_period: string;
  budget_reset_at: string | null;
  status: string;
  /** JSON 字符串 */
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

/** `providers` 表行（含上游密钥）。 */
export interface ProviderRow {
  id: string;
  name: string;
  /** OpenAI 兼容上游根 URL（仅 openai 协议路由必需） */
  base_url_openai: string | null;
  base_url_anthropic?: string | null;
  base_url_gemini?: string | null;
  api_key: string;
  description: string | null;
  created_at: string;
}

/** `models` 查询结果；`tags` / `route_groups` 多为 `json_group_array` 生成的 JSON 字符串。 */
export interface ModelRow {
  id: string;
  display_name: string | null;
  /** 厂商；缺省归类为 other */
  vendor: string;
  context_window: number | null;
  max_tokens: number;
  /** `{ "tiers": [...] }` JSON 文本，与 `parsePricingProfile` 契约一致 */
  pricing_profile: string | null;
  supports_images: number;
  /** `json_group_array(model_tags.tag)` */
  tags: string;
  /** active `model_routes` 的 `route_group` 去重 JSON 数组（部分查询可能无此列） */
  route_groups?: string | null;
  description: string | null;
  metadata: string | null;
  created_at: string;
}

/** `model_routes` 表行。 */
export interface ModelRouteRow {
  id: string;
  model_id: string;
  provider_id: string;
  provider_model_name: string;
  priority: number;
  status: string;
  /** 计费/选路通道；迁移后默认 `default` */
  route_group?: string;
  price_override: string | null;
  /** 路由级默认请求体片段（JSON 对象字符串）；与用户请求体深度合并，用户字段优先 */
  custom_params: string | null;
  /** `openai` | `anthropic` | `gemini` */
  upstream_protocol: string;
}

/** `api_key_request_logs` 表行。 */
export interface RequestLogRow {
  id: string;
  api_key_id: string | null;
  user_email: string | null;
  model_id: string | null;
  provider_id: string | null;
  /** 请求当时转发到上游的模型名；升级前列不存在或旧行为 null */
  provider_model_name: string | null;
  /** `models.display_name` 快照；无展示名时通常写入 `model_id` */
  model_name: string | null;
  /** `providers.name` 快照 */
  provider_name: string | null;
  /** 脱敏后的请求体 JSON（无 messages/contents 等提示词） */
  request_body: string | null;
  /** 脱敏后的上游 wire 请求体（路由合并默认参数后；旧行可能为 null） */
  upstream_request_body: string | null;
  request_protocol: string | null;
  /** 所选路由的上游协议快照（`model_routes.upstream_protocol`） */
  upstream_protocol: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  /** 未乘路由倍率的原始 token 成本 */
  metered_cost: number;
  /** 按 models 标准价格计算的 token 成本（不受 route price_override 影响） */
  standard_cost: number;
  /** 计入用户预算与日志展示的费用 */
  charged_cost: number;
  /** 请求当时选用的 `route_group` */
  route_group: string;
  status: string;
  latency_ms: number | null;
  error_message: string | null;
  /** 上游返回的 usage JSON 快照 */
  raw_usage: string | null;
  /** 计费审计 JSON 字符串（单列）；结构约定见 `db/pricing-audit.ts` */
  pricing_audit: string | null;
  created_at: string;
}

/** `api_key_audit_logs` 表行。 */
export interface ApiKeyBudgetAuditLogRow {
	id: string;
	api_key_id: string;
	event_type: ApiKeyBudgetAuditEventType;
	actor_type: ApiKeyBudgetAuditActorType;
	actor_id: string | null;
	reason_code: string | null;
	reason_text: string | null;
	before_spent: number;
	delta_spent: number;
	after_spent: number;
	before_budget_max: number | null;
	after_budget_max: number | null;
	before_budget_base: number | null;
	after_budget_base: number | null;
	before_budget_period: string | null;
	after_budget_period: string | null;
	before_budget_reset_at: string | null;
	after_budget_reset_at: string | null;
	request_log_id: string | null;
	metadata: string | null;
	created_at: string;
}

/** 全局列表 JOIN `api_keys` 后的审计行（多 `user_email`）。 */
export type GlobalApiKeyBudgetAuditLogRow = ApiKeyBudgetAuditLogRow & { user_email: string | null };
