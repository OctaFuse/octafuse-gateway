import { pgTable, text, timestamp, integer, numeric } from 'drizzle-orm/pg-core';

export const apiKeysTable = pgTable('api_keys', {
	id: text('id').primaryKey(),
	key: text('key').notNull(),
	userId: text('user_id').notNull(),
	userEmail: text('user_email'),
	budgetMax: numeric('budget_max', { precision: 18, scale: 6 }),
	budgetBase: numeric('budget_base', { precision: 18, scale: 6 }).notNull().default('0'),
	budgetSpent: numeric('budget_spent', { precision: 18, scale: 6 }).notNull().default('0'),
	budgetPeriod: text('budget_period').notNull().default('none'),
	budgetResetAt: timestamp('budget_reset_at', { withTimezone: true, mode: 'string' }),
	status: text('status').notNull().default('active'),
	metadata: text('metadata'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const providersTable = pgTable('providers', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	baseUrlOpenai: text('base_url_openai'),
	baseUrlAnthropic: text('base_url_anthropic'),
	baseUrlGemini: text('base_url_gemini'),
	apiKey: text('api_key').notNull(),
	description: text('description'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const modelsTable = pgTable('models', {
	id: text('id').primaryKey(),
	displayName: text('display_name'),
	vendor: text('vendor').notNull().default('other'),
	contextWindow: integer('context_window'),
	maxTokens: integer('max_tokens').notNull().default(8192),
	pricingProfile: text('pricing_profile'),
	supportsImages: integer('supports_images').notNull().default(0),
	description: text('description'),
	metadata: text('metadata'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const modelRoutesTable = pgTable('model_routes', {
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
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const apiKeyRequestLogsTable = pgTable('api_key_request_logs', {
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
	meteredCost: numeric('metered_cost', { precision: 18, scale: 6 }).notNull().default('0'),
	standardCost: numeric('standard_cost', { precision: 18, scale: 6 }).notNull().default('0'),
	chargedCost: numeric('charged_cost', { precision: 18, scale: 6 }).notNull().default('0'),
	routeGroup: text('route_group').notNull().default('default'),
	status: text('status').notNull().default('success'),
	latencyMs: integer('latency_ms'),
	errorMessage: text('error_message'),
	rawUsage: text('raw_usage'),
	/** 计费审计 JSON 字符串；结构见 `db/pricing-audit.ts` */
	pricingAudit: text('pricing_audit'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const systemConfigTable = pgTable('system_config', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	description: text('description'),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const apiKeyAuditLogsTable = pgTable('api_key_audit_logs', {
	id: text('id').primaryKey(),
	apiKeyId: text('api_key_id').notNull(),
	eventType: text('event_type').notNull(),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id'),
	reasonCode: text('reason_code'),
	reasonText: text('reason_text'),
	beforeSpent: numeric('before_spent', { precision: 18, scale: 6 }).notNull(),
	deltaSpent: numeric('delta_spent', { precision: 18, scale: 6 }).notNull(),
	afterSpent: numeric('after_spent', { precision: 18, scale: 6 }).notNull(),
	beforeBudgetMax: numeric('before_budget_max', { precision: 18, scale: 6 }),
	afterBudgetMax: numeric('after_budget_max', { precision: 18, scale: 6 }),
	beforeBudgetBase: numeric('before_budget_base', { precision: 18, scale: 6 }),
	afterBudgetBase: numeric('after_budget_base', { precision: 18, scale: 6 }),
	beforeBudgetPeriod: text('before_budget_period'),
	afterBudgetPeriod: text('after_budget_period'),
	beforeBudgetResetAt: timestamp('before_budget_reset_at', { withTimezone: true, mode: 'string' }),
	afterBudgetResetAt: timestamp('after_budget_reset_at', { withTimezone: true, mode: 'string' }),
	requestLogId: text('request_log_id'),
	metadata: text('metadata'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const pgCoreSchema = {
	apiKeysTable,
	providersTable,
	modelsTable,
	modelRoutesTable,
	apiKeyRequestLogsTable,
	systemConfigTable,
	apiKeyAuditLogsTable,
};
