/**
 * MySQL：关键写路径（mysql2 事务），供 `storage/critical-write-paths` 调度。
 * 与 `db/postgres/critical-writes.impl.ts` 语义对称；利用 mysql2 连接事务实现原子性。
 */
import { eq } from 'drizzle-orm';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import type { InsertKeyParams } from '../api-keys-types';
import type { InsertRequestLogParams } from '../request-logs-types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import { nowIso, parseMoney } from '../../storage/critical-write-paths-utils';
import {
	apiKeyAuditLogsTable as myAuditTable,
	apiKeysTable as myApiKeysTable,
	apiKeyRequestLogsTable as myRequestLogsTable,
	systemConfigTable as mySystemConfigTable,
} from '../../storage/drizzle/schema.mysql';
import { asMySqlPool } from './mysql2-compat';

export async function getActiveApiKeyByUserIdMy(
	client: MySqlDatabaseClient,
	userId: string
): Promise<{ id: string; key: string } | null> {
	const row = await client.drizzle
		.select({
			id: myApiKeysTable.id,
			key: myApiKeysTable.key,
		})
		.from(myApiKeysTable)
		.where(eq(myApiKeysTable.userId, userId))
		.limit(1);
	return row[0] ?? null;
}

export async function getApiKeyBudgetSnapshotMy(
	client: MySqlDatabaseClient,
	keyId: string
): Promise<{ budgetSpent: number; budgetMax: number | null; budgetPeriod: string | null; budgetResetAt: string | null } | null> {
	const row = await client.drizzle
		.select({
			budgetSpent: myApiKeysTable.budgetSpent,
			budgetMax: myApiKeysTable.budgetMax,
			budgetPeriod: myApiKeysTable.budgetPeriod,
			budgetResetAt: myApiKeysTable.budgetResetAt,
		})
		.from(myApiKeysTable)
		.where(eq(myApiKeysTable.id, keyId))
		.limit(1);
	if (!row[0]) return null;
	return {
		budgetSpent: parseMoney(row[0].budgetSpent),
		budgetMax: row[0].budgetMax == null ? null : parseMoney(row[0].budgetMax),
		budgetPeriod: row[0].budgetPeriod,
		budgetResetAt: row[0].budgetResetAt,
	};
}

export async function getSystemConfigValueMy(client: MySqlDatabaseClient, key: string): Promise<string | null> {
	const row = await client.drizzle
		.select({ value: mySystemConfigTable.value })
		.from(mySystemConfigTable)
		.where(eq(mySystemConfigTable.key, key))
		.limit(1);
	return row[0]?.value ?? null;
}

export async function createApiKeyWithAuditMy(
	client: MySqlDatabaseClient,
	params: {
		insert: InsertKeyParams;
		audit: InsertApiKeyBudgetAuditLogParams;
	}
): Promise<void> {
	const now = nowIso();
	const pool = asMySqlPool(client.raw);
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		await conn.execute(
			`INSERT INTO api_keys (id, \`key\`, user_id, user_email, budget_max, budget_base, budget_spent, budget_period, budget_reset_at, status, metadata, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
			[
				params.insert.id,
				params.insert.key,
				params.insert.userId,
				params.insert.userEmail ?? null,
				params.insert.budgetMax == null ? null : String(roundGatewayMoney(params.insert.budgetMax)),
				String(params.insert.budgetBase != null ? roundGatewayMoney(params.insert.budgetBase) : 0),
				String(roundGatewayMoney(params.insert.budgetSpent)),
				params.insert.budgetPeriod,
				params.insert.budgetResetAt ?? null,
				params.insert.status,
				now,
				now,
			]
		);
		await conn.execute(
			`INSERT INTO api_key_audit_logs
			   (id, api_key_id, event_type, actor_type, actor_id, reason_code, reason_text,
			    before_spent, delta_spent, after_spent,
			    before_budget_max, after_budget_max, before_budget_base, after_budget_base,
			    before_budget_period, after_budget_period,
			    before_budget_reset_at, after_budget_reset_at, request_log_id, metadata, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				params.audit.id,
				params.audit.apiKeyId,
				params.audit.eventType,
				params.audit.actorType,
				params.audit.actorId ?? null,
				params.audit.reasonCode ?? null,
				params.audit.reasonText ?? null,
				String(roundGatewayMoney(params.audit.beforeSpent)),
				String(roundGatewayMoney(params.audit.deltaSpent)),
				String(roundGatewayMoney(params.audit.afterSpent)),
				params.audit.beforeBudgetMax == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetMax)),
				params.audit.afterBudgetMax == null ? null : String(roundGatewayMoney(params.audit.afterBudgetMax)),
				params.audit.beforeBudgetBase == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetBase)),
				params.audit.afterBudgetBase == null ? null : String(roundGatewayMoney(params.audit.afterBudgetBase)),
				params.audit.beforeBudgetPeriod ?? null,
				params.audit.afterBudgetPeriod ?? null,
				params.audit.beforeBudgetResetAt ?? null,
				params.audit.afterBudgetResetAt ?? null,
				params.audit.requestLogId ?? null,
				params.audit.metadata ?? null,
				now,
			]
		);
		await conn.commit();
	} catch (err) {
		await conn.rollback();
		throw err;
	} finally {
		conn.release();
	}
}

export async function updateApiKeyBudgetWithAuditTxMy(
	client: MySqlDatabaseClient,
	params: {
		keyId: string;
		budgetSpent: number;
		budgetResetAt: string | null;
		/**
		 * 可选：把 `api_keys.budget_max` 同时改写为该值（lazy reset 复位 base 时使用）。
		 * 缺省（undefined）时不修改 `budget_max`。
		 */
		budgetMax?: number | null;
		audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>;
	}
): Promise<void> {
	const nextSpent = roundGatewayMoney(params.budgetSpent);
	const now = nowIso();
	const pool = asMySqlPool(client.raw);
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		if (params.budgetMax !== undefined) {
			await conn.execute(
				`UPDATE api_keys SET budget_spent = ?, budget_reset_at = ?, budget_max = ?, updated_at = ? WHERE id = ?`,
				[
					String(nextSpent),
					params.budgetResetAt ?? null,
					params.budgetMax == null ? null : String(roundGatewayMoney(params.budgetMax)),
					now,
					params.keyId,
				]
			);
		} else {
			await conn.execute(
				`UPDATE api_keys SET budget_spent = ?, budget_reset_at = ?, updated_at = ? WHERE id = ?`,
				[String(nextSpent), params.budgetResetAt ?? null, now, params.keyId]
			);
		}
		await conn.execute(
			`INSERT INTO api_key_audit_logs
			   (id, api_key_id, event_type, actor_type, actor_id, reason_code, reason_text,
			    before_spent, delta_spent, after_spent,
			    before_budget_max, after_budget_max, before_budget_base, after_budget_base,
			    before_budget_period, after_budget_period,
			    before_budget_reset_at, after_budget_reset_at, request_log_id, metadata, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				params.keyId,
				params.audit.eventType,
				params.audit.actorType,
				params.audit.actorId ?? null,
				params.audit.reasonCode ?? null,
				params.audit.reasonText ?? null,
				String(roundGatewayMoney(params.audit.beforeSpent)),
				String(roundGatewayMoney(params.audit.deltaSpent)),
				String(nextSpent),
				params.audit.beforeBudgetMax == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetMax)),
				params.audit.afterBudgetMax == null ? null : String(roundGatewayMoney(params.audit.afterBudgetMax)),
				params.audit.beforeBudgetBase == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetBase)),
				params.audit.afterBudgetBase == null ? null : String(roundGatewayMoney(params.audit.afterBudgetBase)),
				params.audit.beforeBudgetPeriod ?? null,
				params.audit.afterBudgetPeriod ?? null,
				params.audit.beforeBudgetResetAt ?? null,
				params.budgetResetAt ?? null,
				params.audit.requestLogId ?? null,
				params.audit.metadata ?? null,
				now,
			]
		);
		await conn.commit();
	} catch (err) {
		await conn.rollback();
		throw err;
	} finally {
		conn.release();
	}
}

export async function insertRequestUsageAndChargeTxMy(
	client: MySqlDatabaseClient,
	params: {
		requestLog: InsertRequestLogParams;
		shouldChargeBudget: boolean;
		beforeSpent: number;
		chargedCost: number;
		audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>;
	}
): Promise<void> {
	const charged = roundGatewayMoney(params.chargedCost);
	const now = nowIso();
	const pool = asMySqlPool(client.raw);
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		await conn.execute(
			`INSERT INTO api_key_request_logs
			   (id, api_key_id, user_email, model_id, provider_id, provider_model_name, model_name, provider_name,
			    request_body, upstream_request_body, request_protocol, upstream_protocol,
			    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens,
			    metered_cost, standard_cost, charged_cost,
			    route_group, status, latency_ms, error_message, raw_usage,
			    pricing_audit, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				params.requestLog.id,
				params.requestLog.apiKeyId ?? null,
				params.requestLog.userEmail ?? null,
				params.requestLog.modelId ?? null,
				params.requestLog.providerId ?? null,
				params.requestLog.providerModelName ?? null,
				params.requestLog.modelName ?? null,
				params.requestLog.providerName ?? null,
				params.requestLog.requestBody ?? null,
				params.requestLog.upstreamRequestBody ?? null,
				params.requestLog.requestProtocol ?? null,
				params.requestLog.upstreamProtocol,
				params.requestLog.inputTokens,
				params.requestLog.outputTokens,
				params.requestLog.cacheReadTokens,
				params.requestLog.cacheWriteTokens,
				params.requestLog.reasoningTokens,
				params.requestLog.totalTokens,
				String(roundGatewayMoney(params.requestLog.meteredCost)),
				String(roundGatewayMoney(params.requestLog.standardCost)),
				String(roundGatewayMoney(params.requestLog.chargedCost)),
				params.requestLog.routeGroup,
				params.requestLog.status,
				params.requestLog.latencyMs ?? null,
				params.requestLog.errorMessage ?? null,
				params.requestLog.rawUsage ?? null,
				params.requestLog.pricingAudit ?? null,
				now,
			]
		);

		if (!params.shouldChargeBudget) {
			await conn.commit();
			return;
		}

		await conn.execute(
			`UPDATE api_keys SET budget_spent = budget_spent + ?, updated_at = ? WHERE id = ?`,
			[String(charged), now, params.audit.apiKeyId]
		);

		await conn.execute(
			`INSERT INTO api_key_audit_logs
			   (id, api_key_id, event_type, actor_type, actor_id, reason_code, reason_text,
			    before_spent, delta_spent, after_spent,
			    before_budget_max, after_budget_max, before_budget_base, after_budget_base,
			    before_budget_period, after_budget_period,
			    before_budget_reset_at, after_budget_reset_at, request_log_id, metadata, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				params.audit.apiKeyId,
				params.audit.eventType,
				params.audit.actorType,
				params.audit.actorId ?? null,
				params.audit.reasonCode ?? null,
				params.audit.reasonText ?? null,
				String(roundGatewayMoney(params.beforeSpent)),
				String(charged),
				String(roundGatewayMoney(params.beforeSpent + charged)),
				params.audit.beforeBudgetMax == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetMax)),
				params.audit.afterBudgetMax == null ? null : String(roundGatewayMoney(params.audit.afterBudgetMax)),
				params.audit.beforeBudgetBase == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetBase)),
				params.audit.afterBudgetBase == null ? null : String(roundGatewayMoney(params.audit.afterBudgetBase)),
				params.audit.beforeBudgetPeriod ?? null,
				params.audit.afterBudgetPeriod ?? null,
				params.audit.beforeBudgetResetAt ?? null,
				params.audit.afterBudgetResetAt ?? null,
				params.audit.requestLogId ?? null,
				params.audit.metadata ?? null,
				now,
			]
		);

		await conn.commit();
	} catch (err) {
		await conn.rollback();
		throw err;
	} finally {
		conn.release();
	}
}
