/**
 * 全局类型：D1 行映射与业务枚举（与 migrations-d1 列语义对齐）。
 */

/** 用户密钥预算周期。 */
export type BudgetPeriod = 'none' | 'daily' | 'weekly' | 'monthly';

export type ApiKeyBudgetAuditEventType =
	| 'usage_charge'
	| 'period_reset'
	| 'admin_adjust'
	| 'key_created'
	| 'key_revoked'
	| 'key_deleted'
	| 'user_created'
	| 'user_deleted'
	| 'wallet_credit';

export type ApiKeyBudgetAuditActorType = 'system' | 'admin' | 'service';

/** `api_keys.rate_limit` / `users.rate_limit` JSON。NULL / 空对象 = 该层不限；后续可加 `rpd` 等维度。 */
export type ApiKeyRateLimit = {
	/** 每 60 秒滚动窗口请求数。`0` 拒绝计次请求；省略表示该维度不限。 */
	rpm?: number;
};

/** `api_keys` 表行（密钥明文存库；预算在 `users`）。 */
export interface ApiKeyRow {
	id: string;
	key: string;
	user_id: string;
	name: string | null;
	status: string;
	/** JSON 字符串 */
	metadata: string | null;
	last_used_at: string | null;
	/** JSON 对象；NULL = 不限 */
	rate_limit: ApiKeyRateLimit | null;
	created_at: string;
	updated_at: string;
}

/** `users` 表行（网关自有用户；预算字段在此）。 */
export interface UserRow {
	id: string;
	email: string;
	budget_max: number | null;
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
	/** 累计发放的永久额度；余额为 granted − spent，不落列。 */
	wallet_granted: number;
	/** 累计消耗的永久额度。 */
	wallet_spent: number;
	status: string;
	metadata: string | null;
	/** JSON 对象；NULL = 该用户所有 Key 合计不限 */
	rate_limit: ApiKeyRateLimit | null;
	/** `{ "<models.id>": factor }` JSON；NULL 表示无用户级 Charged 折扣 */
	charged_cost_factors: string | null;
	external_system: string | null;
	external_user_id: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * `api_keys` JOIN `users` 后的扁平行：鉴权与管理端沿用 `user_email` / `budget_*` 命名。
 */
export interface ResolvedGatewayKeyRow extends ApiKeyRow {
	user_email: string | null;
	/** `users.metadata` JSON 文本（鉴权 JOIN 时一并读取，供 `/v1/me` 优先合并） */
	user_metadata: string | null;
	/** `users.charged_cost_factors` JSON 文本（鉴权 JOIN 时一并读取） */
	user_charged_cost_factors: string | null;
	budget_max: number | null;
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
	wallet_granted: number;
	wallet_spent: number;
	/** `users.rate_limit`；NULL = 用户层不限 */
	user_rate_limit: ApiKeyRateLimit | null;
}

/** `providers.status` 枚举。 */
export type ProviderStatus = 'active' | 'disabled';

/** 同层路由排序策略名。 */
export type RouteStrategyName =
	| 'hash_affinity'
	| 'weighted_random'
	| 'weight_priority'
	| 'weighted_round_robin';

/** `providers` 表行。 */
export interface ProviderRow {
  id: string;
  name: string;
  /**
	 * 协议端点 JSON（权威）：`{ openai?: { base?, endpoints? }, anthropic?, gemini?, dashscope? }`。
   * 见 `parseProviderEndpoints` / `resolveUpstreamEndpoint`。
   */
  endpoints?: string | null;
  /** 该上游账号唯一 API Key（明文，仅服务端）。 */
  api_key?: string;
  /** `active` | `disabled`；disabled 不参与调度。 */
  status?: ProviderStatus | string;
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
  /** Chat max output tokens; null for image-generation models */
  max_tokens: number | null;
  /** `{ "tiers": [...] }` JSON 文本，与 `parsePricingProfile` 契约一致 */
  pricing_profile: string | null;
  /** `json_group_array(model_tags.tag)` */
  tags: string;
  /** active `model_routes` 的 `route_group` 去重 JSON 数组（部分查询可能无此列） */
  route_groups?: string | null;
  description: string | null;
  metadata: string | null;
  /** JSON array string, e.g. `["text","image"]` */
  input_modalities: string | null;
  /** JSON array string, e.g. `["text"]` */
  output_modalities: string | null;
  /** Model release date `YYYY-MM-DD` */
  released_at: string | null;
  /** 路由策略配置 JSON（`parseModelRoutePolicy`）；NULL=使用全局/代码默认（部分查询可能无此列） */
  route_policy?: string | null;
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
  /** 同 priority 层内权重；策略排序用，默认 1 */
  weight?: number;
  price_override: string | null;
  /** 路由级默认请求体片段（JSON 对象字符串）；与用户请求体深度合并，用户字段优先。保留键 `headers` 注入上游 HTTP 头，不进 body。 */
  custom_params: string | null;
  /** `openai` | `anthropic` | `gemini` */
  upstream_protocol: string;
  /** Owning route pool. Nullable only for databases that have not applied migration 0016 yet. */
  route_pool_id?: string | null;
  /** Upstream capability; `*` means use the request operation (legacy compatibility). */
  upstream_operation?: string;
  /** Request-to-upstream conversion adapter. First release supports `passthrough`. */
  adapter?: string;
}

/** `api_key_request_logs` 表行。 */
export interface RequestLogRow {
	id: string;
	user_id: string | null;
	api_key_id: string | null;
	user_email: string | null;
	/** 管理端全局日志查询从 users 关联得到；物理日志行本身不存储。 */
	external_system?: string | null;
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
  request_operation?: string | null;
  /** 所选路由的上游协议快照（`model_routes.upstream_protocol`） */
  upstream_protocol: string;
  upstream_operation?: string | null;
  model_surface_id?: string | null;
  route_pool_id?: string | null;
  route_target_id?: string | null;
  adapter?: string | null;
  route_trace?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  /** 未乘路由倍率的原始 token 成本 */
  metered_cost: number;
  /** 官方当刻目录价（含 model 时段倍率），不含 route 倍率 */
  standard_cost: number;
  /** 计入用户预算与日志展示的费用 */
  charged_cost: number;
  /** 本次请求从永久池扣掉的部分；周期部分 = charged_cost − charged_wallet_cost */
  charged_wallet_cost: number;
  /** 请求当时选用的 `route_group` */
  route_group: string;
  status: string;
  latency_ms: number | null;
  gateway_overhead_ms: number | null;
  upstream_response_ms: number | null;
  final_upstream_headers_ms: number | null;
  first_reasoning_token_ms: number | null;
  first_token_ms: number | null;
  stream_duration_ms: number | null;
  upstream_attempt_count: number | null;
  upstream_failover_count: number | null;
  timing_metadata: string | null;
  error_message: string | null;
  /** 上游返回的 usage JSON 快照 */
  raw_usage: string | null;
  /** 计费审计 JSON 字符串（单列）；结构约定见 `db/pricing-audit.ts` */
  pricing_audit: string | null;
  /**
   * 历史列：曾存 `provider_api_keys.id`；单键化后语义为 provider id（或兼容旧值）。
   * 新写入可填 `providers.id`；展示以 label / fingerprint 为准。
   */
  provider_key_id: string | null;
  /** 历史列：曾存 key label；单键化后可填 provider name */
  provider_key_label: string | null;
  /** 脱敏尾号指纹，不存明文（历史语义保留） */
  provider_key_fingerprint: string | null;
  /** 上游响应头中的 provider 追踪 id（如 x-request-id）；传输层，经聚合商/CDN 可能为 null */
  upstream_request_id: string | null;
  /** 上游响应 body 里的生成结果 id（OpenAI `chatcmpl-*` / Anthropic `msg_*` / Gemini `responseId`）；应用层，穿透聚合商 */
  upstream_message_id: string | null;
	/** 计费种类：`image_tokens` | `image_per_image` | `audio_per_second` | `audio_tokens` | `audio_per_character`；旧行为 null */
  billing_kind: string | null;
  /** 按张计费：参考图张数 */
  input_image_count: number;
  /** 按张计费：生成图张数 */
  output_image_count: number;
  /** 音频转写：计费时长（秒） */
	audio_duration_seconds: number | null;
	/** TTS：上游返回的有效计费字符数 */
	audio_characters: number | null;
	/** 请求打到的入口 Host（只记录，不做准入） */
	ingress_host: string | null;
  created_at: string;
}

/** `user_audit_logs` 表行。 */
export interface UserAuditLogRow {
	id: string;
	/** 用户删除后外键 ON DELETE SET NULL 可能为空；快照/change_payload 保留身份 */
	user_id: string | null;
	api_key_id: string | null;
	event_type: string;
	actor_type: string;
	/** 由 `before_user_snapshot` / `after_user_snapshot` 派生（表上已无独立列）。 */
	before_spent: number;
	/** 由快照派生，语义同历史 `delta_spent`。 */
	delta_spent: number;
	after_spent: number;
	before_budget_max: number | null;
	after_budget_max: number | null;
	/** 由快照派生的 `budget_base`（周期 reset 参考额）。 */
	before_budget_base: number;
	after_budget_base: number;
	request_log_id: string | null;
	/** 结构化扩展载荷（预算周期前后值、管理端 patch 摘要等）；原 `metadata` 列。 */
	change_payload: string | null;
	before_user_snapshot: string | null;
	after_user_snapshot: string | null;
	changed_fields: string | null;
	correlation_id: string | null;
	source: string | null;
	actor_id: string | null;
	reason_code: string | null;
	reason_text: string | null;
	created_at: string;
}

/** 全局列表 JOIN `users` 后的审计行。 */
export type GlobalUserAuditLogRow = UserAuditLogRow & { user_email: string | null };

/** @deprecated 使用 {@link UserAuditLogRow} */
export type ApiKeyBudgetAuditLogRow = UserAuditLogRow;
/** @deprecated 使用 {@link GlobalUserAuditLogRow} */
export type GlobalApiKeyBudgetAuditLogRow = GlobalUserAuditLogRow;
