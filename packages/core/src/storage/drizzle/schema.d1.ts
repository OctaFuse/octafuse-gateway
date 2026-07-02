import { sql } from 'drizzle-orm';
import { check, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const usersTable = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(),
		/**
		 * 在 `external_system` 命名空间内唯一（含 internal 用户，即 `external_system IS NULL`）；
		 * 由两条 partial unique index 落实，见表选项末尾。
		 */
		email: text('email').notNull(),
		budgetMax: real('budget_max'),
		budgetBase: real('budget_base').notNull().default(0),
		budgetSpent: real('budget_spent').notNull().default(0),
		budgetPeriod: text('budget_period').notNull().default('none'),
		budgetResetAt: text('budget_reset_at'),
		status: text('status').notNull().default('active'),
		metadata: text('metadata'),
		/** 上游命名空间（产品/租户），与 external_user_id 成对做幂等；纯网关用户二者皆空。 */
		externalSystem: text('external_system'),
		externalUserId: text('external_user_id'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(t) => [
		uniqueIndex('uk_users_external_system_user_id').on(t.externalSystem, t.externalUserId),
		uniqueIndex('uk_users_external_system_email')
			.on(t.externalSystem, t.email)
			.where(sql`external_system IS NOT NULL`),
		uniqueIndex('uk_users_internal_email')
			.on(t.email)
			.where(sql`external_system IS NULL`),
		check(
			'users_external_pair_chk',
			sql`(external_system IS NULL AND external_user_id IS NULL) OR (external_system IS NOT NULL AND external_user_id IS NOT NULL)`
		),
	]
);

export const apiKeysTable = sqliteTable('api_keys', {
	id: text('id').primaryKey(),
	key: text('key').notNull(),
	userId: text('user_id').notNull(),
	name: text('name'),
	status: text('status').notNull().default('active'),
	metadata: text('metadata'),
	lastUsedAt: text('last_used_at'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const providersTable = sqliteTable('providers', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	baseUrlOpenai: text('base_url_openai'),
	baseUrlAnthropic: text('base_url_anthropic'),
	baseUrlGemini: text('base_url_gemini'),
	description: text('description'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const providerApiKeysTable = sqliteTable('provider_api_keys', {
	id: text('id').primaryKey(),
	providerId: text('provider_id').notNull(),
	label: text('label').notNull(),
	apiKey: text('api_key').notNull(),
	status: text('status').notNull().default('active'),
	weight: integer('weight').notNull().default(1),
	priority: integer('priority').notNull().default(0),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const modelsTable = sqliteTable('models', {
	id: text('id').primaryKey(),
	displayName: text('display_name'),
	vendor: text('vendor').notNull().default('other'),
	contextWindow: integer('context_window'),
	maxTokens: integer('max_tokens').notNull().default(8192),
	/** JSON：统一阶梯/固定价（`models` 列价真源）。 */
	pricingProfile: text('pricing_profile'),
	description: text('description'),
	metadata: text('metadata'),
	inputModalities: text('input_modalities'),
	outputModalities: text('output_modalities'),
	releasedAt: text('released_at'),
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
	userId: text('user_id'),
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
	providerKeyId: text('provider_key_id'),
	providerKeyLabel: text('provider_key_label'),
	providerKeyFingerprint: text('provider_key_fingerprint'),
	upstreamRequestId: text('upstream_request_id'),
	upstreamMessageId: text('upstream_message_id'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const systemConfigTable = sqliteTable('system_config', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	description: text('description'),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** 用户维度审计：预算、资料等；扩展载荷见 `change_payload`。 */
export const userAuditLogsTable = sqliteTable('user_audit_logs', {
	id: text('id').primaryKey(),
	userId: text('user_id'),
	apiKeyId: text('api_key_id'),
	eventType: text('event_type').notNull(),
	actorType: text('actor_type').notNull().default('system'),
	requestLogId: text('request_log_id'),
	changePayload: text('change_payload'),
	beforeUserSnapshot: text('before_user_snapshot'),
	afterUserSnapshot: text('after_user_snapshot'),
	changedFields: text('changed_fields'),
	correlationId: text('correlation_id'),
	source: text('source'),
	actorId: text('actor_id'),
	reasonCode: text('reason_code'),
	reasonText: text('reason_text'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const d1CoreSchema = {
	usersTable,
	apiKeysTable,
	providersTable,
	providerApiKeysTable,
	modelsTable,
	modelRoutesTable,
	apiKeyRequestLogsTable,
	systemConfigTable,
	userAuditLogsTable,
};
