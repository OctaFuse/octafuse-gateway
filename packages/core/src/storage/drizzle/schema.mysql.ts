import { mysqlTable, text, timestamp, int, decimal, varchar } from 'drizzle-orm/mysql-core';

/**
 * PK / UNIQUE / FK 列宽与 migrations-mysql/0001_baseline.sql 对齐。
 * MySQL InnoDB 不允许无前缀长度的 TEXT/BLOB 作为键，因此主键与唯一键必须用 VARCHAR。
 */
const COL = {
	ID: 512,
	KEY: 767,
	USER_ID: 512,
	EMAIL: 512,
	STATUS: 32,
	PERIOD: 64,
	PROVIDER_NAME: 512,
	MODEL_ID: 512,
	PROVIDER_ID: 512,
	ROUTE_GROUP: 64,
	VENDOR: 64,
	EVENT_TYPE: 64,
	ACTOR_TYPE: 32,
	REASON_CODE: 64,
	SYSCONFIG_KEY: 255,
	TAG: 255,
} as const;

export const apiKeysTable = mysqlTable('api_keys', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	key: varchar('key', { length: COL.KEY }).notNull(),
	userId: varchar('user_id', { length: COL.USER_ID }).notNull(),
	userEmail: varchar('user_email', { length: COL.EMAIL }),
	budgetMax: decimal('budget_max', { precision: 18, scale: 6 }),
	budgetBase: decimal('budget_base', { precision: 18, scale: 6 }).notNull().default('0'),
	budgetSpent: decimal('budget_spent', { precision: 18, scale: 6 }).notNull().default('0'),
	budgetPeriod: varchar('budget_period', { length: COL.PERIOD }).notNull(),
	budgetResetAt: timestamp('budget_reset_at', { fsp: 6, mode: 'string' }),
	status: varchar('status', { length: COL.STATUS }).notNull(),
	metadata: text('metadata'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
	updatedAt: timestamp('updated_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const providersTable = mysqlTable('providers', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	name: varchar('name', { length: COL.PROVIDER_NAME }).notNull(),
	baseUrlOpenai: text('base_url_openai'),
	baseUrlAnthropic: text('base_url_anthropic'),
	baseUrlGemini: text('base_url_gemini'),
	apiKey: text('api_key').notNull(),
	description: text('description'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const modelsTable = mysqlTable('models', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	displayName: text('display_name'),
	vendor: varchar('vendor', { length: COL.VENDOR }).notNull(),
	contextWindow: int('context_window'),
	maxTokens: int('max_tokens').notNull(),
	pricingProfile: text('pricing_profile'),
	supportsImages: int('supports_images').notNull(),
	description: text('description'),
	metadata: text('metadata'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const modelRoutesTable = mysqlTable('model_routes', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	modelId: varchar('model_id', { length: COL.MODEL_ID }).notNull(),
	providerId: varchar('provider_id', { length: COL.PROVIDER_ID }).notNull(),
	providerModelName: text('provider_model_name').notNull(),
	priority: int('priority').notNull(),
	status: varchar('status', { length: COL.STATUS }).notNull(),
	routeGroup: varchar('route_group', { length: COL.ROUTE_GROUP }).notNull(),
	priceOverride: text('price_override'),
	customParams: text('custom_params'),
	upstreamProtocol: varchar('upstream_protocol', { length: COL.STATUS }).notNull(),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const apiKeyRequestLogsTable = mysqlTable('api_key_request_logs', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	apiKeyId: varchar('api_key_id', { length: COL.ID }),
	userEmail: varchar('user_email', { length: COL.EMAIL }),
	modelId: varchar('model_id', { length: COL.ID }),
	providerId: varchar('provider_id', { length: COL.ID }),
	providerModelName: text('provider_model_name'),
	modelName: text('model_name'),
	providerName: text('provider_name'),
	requestBody: text('request_body'),
	upstreamRequestBody: text('upstream_request_body'),
	requestProtocol: varchar('request_protocol', { length: COL.STATUS }),
	upstreamProtocol: varchar('upstream_protocol', { length: COL.STATUS }).notNull(),
	inputTokens: int('input_tokens').notNull(),
	outputTokens: int('output_tokens').notNull(),
	cacheReadTokens: int('cache_read_tokens').notNull(),
	cacheWriteTokens: int('cache_write_tokens').notNull(),
	reasoningTokens: int('reasoning_tokens').notNull(),
	totalTokens: int('total_tokens').notNull(),
	meteredCost: decimal('metered_cost', { precision: 18, scale: 6 }).notNull().default('0'),
	standardCost: decimal('standard_cost', { precision: 18, scale: 6 }).notNull().default('0'),
	chargedCost: decimal('charged_cost', { precision: 18, scale: 6 }).notNull().default('0'),
	routeGroup: varchar('route_group', { length: COL.ROUTE_GROUP }).notNull(),
	status: varchar('status', { length: COL.STATUS }).notNull(),
	latencyMs: int('latency_ms'),
	errorMessage: text('error_message'),
	rawUsage: text('raw_usage'),
	/** 计费审计 JSON 字符串；结构见 `db/pricing-audit.ts` */
	pricingAudit: text('pricing_audit'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const systemConfigTable = mysqlTable('system_config', {
	key: varchar('key', { length: COL.SYSCONFIG_KEY }).primaryKey(),
	value: text('value').notNull(),
	description: text('description'),
	updatedAt: timestamp('updated_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const apiKeyAuditLogsTable = mysqlTable('api_key_audit_logs', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	apiKeyId: varchar('api_key_id', { length: COL.ID }).notNull(),
	eventType: varchar('event_type', { length: COL.EVENT_TYPE }).notNull(),
	actorType: varchar('actor_type', { length: COL.ACTOR_TYPE }).notNull(),
	actorId: varchar('actor_id', { length: COL.ID }),
	reasonCode: varchar('reason_code', { length: COL.REASON_CODE }),
	reasonText: text('reason_text'),
	beforeSpent: decimal('before_spent', { precision: 18, scale: 6 }).notNull(),
	deltaSpent: decimal('delta_spent', { precision: 18, scale: 6 }).notNull(),
	afterSpent: decimal('after_spent', { precision: 18, scale: 6 }).notNull(),
	beforeBudgetMax: decimal('before_budget_max', { precision: 18, scale: 6 }),
	afterBudgetMax: decimal('after_budget_max', { precision: 18, scale: 6 }),
	beforeBudgetBase: decimal('before_budget_base', { precision: 18, scale: 6 }),
	afterBudgetBase: decimal('after_budget_base', { precision: 18, scale: 6 }),
	beforeBudgetPeriod: varchar('before_budget_period', { length: COL.PERIOD }),
	afterBudgetPeriod: varchar('after_budget_period', { length: COL.PERIOD }),
	beforeBudgetResetAt: timestamp('before_budget_reset_at', { fsp: 6, mode: 'string' }),
	afterBudgetResetAt: timestamp('after_budget_reset_at', { fsp: 6, mode: 'string' }),
	requestLogId: varchar('request_log_id', { length: COL.ID }),
	metadata: text('metadata'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const mysqlCoreSchema = {
	apiKeysTable,
	providersTable,
	modelsTable,
	modelRoutesTable,
	apiKeyRequestLogsTable,
	systemConfigTable,
	apiKeyAuditLogsTable,
};
