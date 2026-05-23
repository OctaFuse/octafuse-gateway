/**
 * Repository 层返回的强类型 DTO（替代裸 `Record<string, unknown>`）。
 * 数值列在 SQLite / PG 驱动下可能为 number 或 string，读侧统一为 `number | string` 的联合或经映射后的 number。
 */

import type { ModelRouteRow } from '../types';

/** 管理端密钥列表行（`getAllApiKeys`，JOIN `users`）。 */
export interface AdminApiKeyListItem {
	id: string;
	key: string;
	user_id: string;
	name: string | null;
	user_email: string | null;
	budget_max: number | null;
	/** 周期 reset 时 `budget_max` 的恢复基准；缺省 0。 */
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
	status: string;
	metadata: string | null;
	created_at: string;
	updated_at: string;
}

/** 模型列表 + 路由计数（`listModelsWithRouteCounts` / `getModelDetailWithRouteCounts`）。 */
export interface ModelWithRouteCountsRow {
	id: string;
	display_name: string | null;
	vendor: string;
	context_window: number | null;
	max_tokens: number;
	pricing_profile: string | null;
	/** `json_group_array` 结果 */
	tags: string;
	description: string | null;
	metadata: string | null;
	created_at: string;
	routes_count: number;
	active_routes_count: number;
}

/** `model_routes` 列表 JOIN models / providers 名称。 */
export interface ModelRouteJoinRow {
	id: string;
	model_id: string;
	provider_id: string;
	provider_model_name: string;
	priority: number;
	status: string;
	route_group: string;
	price_override: string | null;
	custom_params: string | null;
	upstream_protocol: string;
	model_name: string | null;
	provider_name: string | null;
}

/** `getModelRouteRowById`：`SELECT * FROM model_routes`。 */
export type ModelRouteDetailRow = ModelRouteRow & { created_at?: string };

/** Provider 列表 / 管理视图。 */
export interface ProviderAdminRow {
	id: string;
	name: string;
	base_url_openai: string | null;
	base_url_anthropic: string | null;
	base_url_gemini: string | null;
	api_key: string;
	description: string | null;
	created_at: string;
}

/** 分析：按模型 + 路由组聚合。 */
export interface ModelAnalyticsRow {
	model_id: string | null;
	route_group: string;
	request_count: number;
	charged_cost: number;
	metered_cost: number;
	standard_cost: number;
	input_tokens: number;
	output_tokens: number;
	success_count: number;
	error_count: number;
	avg_latency_ms: number | null;
}

/** 分析：按用户邮箱聚合。 */
export interface UserAnalyticsRow {
	user_email: string;
	request_count: number;
	charged_cost: number;
	metered_cost: number;
	standard_cost: number;
	distinct_models: number;
	last_active_at: string | null;
	budget_max: number | null;
	budget_spent: number | null;
	success_count: number;
	error_count: number;
}

/** 分析：按 provider 聚合。 */
export interface ProviderAnalyticsRow {
	provider_id: string;
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
	avg_latency_ms: number | null;
}

/** 分析：provider 可靠性。 */
export interface ProviderReliabilityRow {
	provider_id: string;
	request_count: number;
	success_count: number;
	error_count: number;
	avg_latency_ms: number | null;
	charged_cost: number;
	metered_cost: number;
	standard_cost: number;
}

/** 分析：模型 × provider 可靠性。 */
export interface ModelProviderReliabilityRow {
	model_id: string;
	provider_id: string;
	request_count: number;
	success_count: number;
	avg_latency_ms: number | null;
	charged_cost: number;
	metered_cost: number;
	standard_cost: number;
}
