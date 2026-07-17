import { sql } from 'drizzle-orm';
import { mysqlTable, text, timestamp, int, decimal, varchar, uniqueIndex, check } from 'drizzle-orm/mysql-core';

/**
 * PK / UNIQUE / FK 列宽与 migrations-mysql/0001_baseline.sql 对齐。
 * MySQL InnoDB 不允许无前缀长度的 TEXT/BLOB 作为键，因此主键与唯一键必须用 VARCHAR。
 */
const COL = {
	ID: 512,
	KEY: 767,
	USER_ID: 512,
	EMAIL: 512,
	EXTERNAL_USER_ID: 512,
	EXTERNAL_SYSTEM: 128,
	STATUS: 32,
	PERIOD: 64,
	PROVIDER_NAME: 512,
	MODEL_ID: 512,
	PROVIDER_ID: 512,
	ROUTE_GROUP: 64,
	VENDOR: 64,
	EVENT_TYPE: 64,
	ACTOR_TYPE: 32,
	SYSCONFIG_KEY: 255,
	TAG: 255,
	NAME: 512,
} as const;

export const usersTable = mysqlTable(
	'users',
	{
		id: varchar('id', { length: COL.ID }).primaryKey(),
		/**
		 * 在 `external_system` 命名空间内唯一（含 internal 用户，即 `external_system IS NULL`）；
		 * 因 InnoDB 不支持 partial index，靠生成列 `external_system_norm` + `uk_users_external_system_email` 实现。
		 */
		email: varchar('email', { length: COL.EMAIL }).notNull(),
		budgetMax: decimal('budget_max', { precision: 18, scale: 6 }),
		budgetBase: decimal('budget_base', { precision: 18, scale: 6 }).notNull().default('0'),
		budgetSpent: decimal('budget_spent', { precision: 18, scale: 6 }).notNull().default('0'),
		budgetPeriod: varchar('budget_period', { length: COL.PERIOD }).notNull().default('none'),
		budgetResetAt: timestamp('budget_reset_at', { fsp: 6, mode: 'string' }),
		status: varchar('status', { length: COL.STATUS }).notNull().default('active'),
		metadata: text('metadata'),
		/** 上游命名空间（产品/租户），与 external_user_id 成对做幂等；纯网关用户二者皆空。 */
		externalSystem: varchar('external_system', { length: COL.EXTERNAL_SYSTEM }),
		externalUserId: varchar('external_user_id', { length: COL.EXTERNAL_USER_ID }),
		/**
		 * MySQL-only generated column: `COALESCE(external_system, '')`. 与 `email` 组成
		 * `uk_users_external_system_email` 唯一约束，让 internal 用户共享一个 namespace。
		 * `users_external_system_nonempty_chk` 保证 `''` 哨兵不会与真实值碰撞。
		 */
		externalSystemNorm: varchar('external_system_norm', { length: COL.EXTERNAL_SYSTEM }).generatedAlwaysAs(
			sql`COALESCE(external_system, '')`,
			{ mode: 'stored' }
		),
		createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
		updatedAt: timestamp('updated_at', { fsp: 6, mode: 'string' }).notNull(),
	},
	(t) => [
		uniqueIndex('uk_users_external_system_user_id').on(t.externalSystem, t.externalUserId),
		uniqueIndex('uk_users_external_system_email').on(t.externalSystemNorm, t.email),
		check(
			'users_external_pair_chk',
			sql`(external_system IS NULL AND external_user_id IS NULL) OR (external_system IS NOT NULL AND external_user_id IS NOT NULL)`
		),
		check(
			'users_external_system_nonempty_chk',
			sql`external_system IS NULL OR CHAR_LENGTH(external_system) > 0`
		),
	]
);

export const apiKeysTable = mysqlTable('api_keys', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	key: varchar('key', { length: COL.KEY }).notNull(),
	userId: varchar('user_id', { length: COL.USER_ID }).notNull(),
	name: varchar('name', { length: COL.NAME }),
	status: varchar('status', { length: COL.STATUS }).notNull().default('active'),
	metadata: text('metadata'),
	lastUsedAt: timestamp('last_used_at', { fsp: 6, mode: 'string' }),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
	updatedAt: timestamp('updated_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const providersTable = mysqlTable('providers', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	name: varchar('name', { length: COL.PROVIDER_NAME }).notNull(),
	baseUrlOpenai: text('base_url_openai'),
	baseUrlAnthropic: text('base_url_anthropic'),
	baseUrlGemini: text('base_url_gemini'),
	description: text('description'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const providerApiKeysTable = mysqlTable('provider_api_keys', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	providerId: varchar('provider_id', { length: COL.PROVIDER_ID }).notNull(),
	label: varchar('label', { length: COL.NAME }).notNull(),
	apiKey: text('api_key').notNull(),
	status: varchar('status', { length: COL.STATUS }).notNull().default('active'),
	weight: int('weight').notNull().default(1),
	priority: int('priority').notNull().default(0),
	/** 限流配置 JSON；NULL=不限流 */
	limitConfig: text('limit_config'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
	updatedAt: timestamp('updated_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const modelsTable = mysqlTable('models', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	displayName: text('display_name'),
	vendor: varchar('vendor', { length: COL.VENDOR }).notNull().default('other'),
	contextWindow: int('context_window'),
	/** Chat completion max output tokens; NULL for image-generation models. */
	maxTokens: int('max_tokens').default(8192),
	pricingProfile: text('pricing_profile'),
	description: text('description'),
	metadata: text('metadata'),
	inputModalities: text('input_modalities'),
	outputModalities: text('output_modalities'),
	releasedAt: text('released_at'),
	/** 粘性路由配置 JSON；NULL=无粘性 */
	stickyConfig: text('sticky_config'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const modelRoutesTable = mysqlTable('model_routes', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	modelId: varchar('model_id', { length: COL.MODEL_ID }).notNull(),
	providerId: varchar('provider_id', { length: COL.PROVIDER_ID }).notNull(),
	providerModelName: text('provider_model_name').notNull(),
	priority: int('priority').notNull().default(0),
	status: varchar('status', { length: COL.STATUS }).notNull().default('active'),
	routeGroup: varchar('route_group', { length: COL.ROUTE_GROUP }).notNull().default('default'),
	priceOverride: text('price_override'),
	customParams: text('custom_params'),
	upstreamProtocol: varchar('upstream_protocol', { length: COL.STATUS }).notNull().default('openai'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const apiKeyRequestLogsTable = mysqlTable('api_key_request_logs', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	userId: varchar('user_id', { length: COL.USER_ID }),
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
	upstreamProtocol: varchar('upstream_protocol', { length: COL.STATUS }).notNull().default('openai'),
	inputTokens: int('input_tokens').notNull().default(0),
	outputTokens: int('output_tokens').notNull().default(0),
	cacheReadTokens: int('cache_read_tokens').notNull().default(0),
	cacheWriteTokens: int('cache_write_tokens').notNull().default(0),
	reasoningTokens: int('reasoning_tokens').notNull().default(0),
	totalTokens: int('total_tokens').notNull().default(0),
	meteredCost: decimal('metered_cost', { precision: 18, scale: 6 }).notNull().default('0'),
	standardCost: decimal('standard_cost', { precision: 18, scale: 6 }).notNull().default('0'),
	chargedCost: decimal('charged_cost', { precision: 18, scale: 6 }).notNull().default('0'),
	routeGroup: varchar('route_group', { length: COL.ROUTE_GROUP }).notNull().default('default'),
	status: varchar('status', { length: COL.STATUS }).notNull().default('success'),
	latencyMs: int('latency_ms'),
	gatewayOverheadMs: int('gateway_overhead_ms'),
	upstreamResponseMs: int('upstream_response_ms'),
	finalUpstreamHeadersMs: int('final_upstream_headers_ms'),
	firstReasoningTokenMs: int('first_reasoning_token_ms'),
	firstTokenMs: int('first_token_ms'),
	streamDurationMs: int('stream_duration_ms'),
	upstreamAttemptCount: int('upstream_attempt_count'),
	upstreamFailoverCount: int('upstream_failover_count'),
	timingMetadata: text('timing_metadata'),
	errorMessage: text('error_message'),
	rawUsage: text('raw_usage'),
	/** 计费审计 JSON 字符串；结构见 `db/pricing-audit.ts` */
	pricingAudit: text('pricing_audit'),
	providerKeyId: varchar('provider_key_id', { length: COL.ID }),
	providerKeyLabel: varchar('provider_key_label', { length: COL.NAME }),
	providerKeyFingerprint: varchar('provider_key_fingerprint', { length: 64 }),
	upstreamRequestId: varchar('upstream_request_id', { length: 200 }),
	upstreamMessageId: varchar('upstream_message_id', { length: 200 }),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const systemConfigTable = mysqlTable('system_config', {
	key: varchar('key', { length: COL.SYSCONFIG_KEY }).primaryKey(),
	value: text('value').notNull(),
	description: text('description'),
	updatedAt: timestamp('updated_at', { fsp: 6, mode: 'string' }).notNull(),
});

/** 用户维度审计：预算、资料等；扩展载荷见 `change_payload`。 */
export const userAuditLogsTable = mysqlTable('user_audit_logs', {
	id: varchar('id', { length: COL.ID }).primaryKey(),
	userId: varchar('user_id', { length: COL.USER_ID }),
	apiKeyId: varchar('api_key_id', { length: COL.ID }),
	eventType: varchar('event_type', { length: COL.EVENT_TYPE }).notNull(),
	actorType: varchar('actor_type', { length: COL.ACTOR_TYPE }).notNull().default('system'),
	requestLogId: varchar('request_log_id', { length: COL.ID }),
	changePayload: text('change_payload'),
	beforeUserSnapshot: text('before_user_snapshot'),
	afterUserSnapshot: text('after_user_snapshot'),
	changedFields: text('changed_fields'),
	correlationId: varchar('correlation_id', { length: COL.ID }),
	source: varchar('source', { length: 128 }),
	actorId: varchar('actor_id', { length: COL.ID }),
	reasonCode: varchar('reason_code', { length: 128 }),
	reasonText: text('reason_text'),
	createdAt: timestamp('created_at', { fsp: 6, mode: 'string' }).notNull(),
});

export const mysqlCoreSchema = {
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
