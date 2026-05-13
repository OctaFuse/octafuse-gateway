import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const apiKeysTable = sqliteTable('api_keys', {
	id: text('id').primaryKey(),
	key: text('key').notNull(),
	userId: text('user_id').notNull(),
	userEmail: text('user_email'),
	budgetMax: real('budget_max'),
	budgetBase: real('budget_base').notNull().default(0),
	budgetSpent: real('budget_spent').notNull().default(0),
	budgetPeriod: text('budget_period').notNull().default('none'),
	budgetResetAt: text('budget_reset_at'),
	status: text('status').notNull().default('active'),
	metadata: text('metadata'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const providersTable = sqliteTable('providers', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	baseUrlOpenai: text('base_url_openai'),
	baseUrlAnthropic: text('base_url_anthropic'),
	baseUrlGemini: text('base_url_gemini'),
	apiKey: text('api_key').notNull(),
	description: text('description'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const modelsTable = sqliteTable('models', {
	id: text('id').primaryKey(),
	displayName: text('display_name'),
	vendor: text('vendor').notNull().default('other'),
	contextWindow: integer('context_window'),
	maxTokens: integer('max_tokens').notNull().default(8192),
	/** JSON：统一阶梯/固定价（`models` 列价真源）。 */
	pricingProfile: text('pricing_profile'),
	supportsImages: integer('supports_images').notNull().default(0),
	description: text('description'),
	metadata: text('metadata'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const modelRoutesTable = sqliteTable('model_routes', {
	id: text('id').primaryKey(),
	modelId: text('model_id').notNull(),
	providerId: text('provider_id').notNull(),
	providerModelName: text('provider_model_name').notNull(),
	priority: integer('priority').notNull().default(0),
	status: text('status').notNull().default('active'),
	routeGroup: text('route_group').notNull().default('default'),
	priceOverride: text('price_override'),
	customParams: text('custom_params'),
	upstreamProtocol: text('upstream_protocol').notNull().default('openai'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const apiKeyRequestLogsTable = sqliteTable('api_key_request_logs', {
	id: text('id').primaryKey(),
	apiKeyId: text('api_key_id'),
	userEmail: text('user_email'),
	modelId: text('model_id'),
	providerId: text('provider_id'),
	providerModelName: text('provider_model_name'),
	modelName: text('model_name'),
	providerName: text('provider_name'),
	requestBody: text('request_body'),
	upstreamRequestBody: text('upstream_request_body'),
	requestProtocol: text('request_protocol'),
	upstreamProtocol: text('upstream_protocol').notNull().default('openai'),
	inputTokens: integer('input_tokens').notNull().default(0),
	outputTokens: integer('output_tokens').notNull().default(0),
	cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
	cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
	reasoningTokens: integer('reasoning_tokens').notNull().default(0),
	totalTokens: integer('total_tokens').notNull().default(0),
	meteredCost: real('metered_cost').notNull().default(0),
	standardCost: real('standard_cost').notNull().default(0),
	chargedCost: real('charged_cost').notNull().default(0),
	routeGroup: text('route_group').notNull().default('default'),
	status: text('status').notNull().default('success'),
	latencyMs: integer('latency_ms'),
	errorMessage: text('error_message'),
	rawUsage: text('raw_usage'),
	/** 计费审计 JSON 字符串；结构见 `db/pricing-audit.ts` */
	pricingAudit: text('pricing_audit'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const systemConfigTable = sqliteTable('system_config', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const apiKeyAuditLogsTable = sqliteTable('api_key_audit_logs', {
	id: text('id').primaryKey(),
	apiKeyId: text('api_key_id').notNull(),
	eventType: text('event_type').notNull(),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id'),
	reasonCode: text('reason_code'),
	reasonText: text('reason_text'),
	beforeSpent: real('before_spent').notNull(),
	deltaSpent: real('delta_spent').notNull(),
	afterSpent: real('after_spent').notNull(),
	beforeBudgetMax: real('before_budget_max'),
	afterBudgetMax: real('after_budget_max'),
	beforeBudgetBase: real('before_budget_base'),
	afterBudgetBase: real('after_budget_base'),
	beforeBudgetPeriod: text('before_budget_period'),
	afterBudgetPeriod: text('after_budget_period'),
	beforeBudgetResetAt: text('before_budget_reset_at'),
	afterBudgetResetAt: text('after_budget_reset_at'),
	requestLogId: text('request_log_id'),
	metadata: text('metadata'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const d1CoreSchema = {
	apiKeysTable,
	providersTable,
	modelsTable,
	modelRoutesTable,
	apiKeyRequestLogsTable,
	systemConfigTable,
	apiKeyAuditLogsTable,
};
