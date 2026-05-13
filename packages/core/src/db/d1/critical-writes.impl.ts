/**
 * D1：关键写路径（batch / 原始 SQL），供 `storage/critical-write-paths` 调度。
 */
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { and, eq } from 'drizzle-orm';
import { buildInsertApiKeyBudgetAuditLogStatement } from './api-key-budget-audit-logs.impl';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import { buildIncrementApiKeyBudgetSpentStatement, buildInsertApiKeyStatement } from './api-keys.impl';
import type { InsertKeyParams } from '../api-keys-types';
import { buildInsertRequestLogStatement } from './request-logs.impl';
import type { InsertRequestLogParams } from '../request-logs-types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { D1DatabaseClient } from '../../storage/database-client';
import { parseMoney } from '../../storage/critical-write-paths-utils';
import {
	apiKeysTable as d1ApiKeysTable,
	systemConfigTable as d1SystemConfigTable,
} from '../../storage/drizzle/schema.d1';

function ensureD1Batch(client: D1DatabaseClient, statements: D1PreparedStatement[]): Promise<void> {
	return client.raw.batch(statements).then(() => undefined);
}

export async function getActiveApiKeyByUserIdD1(
	client: D1DatabaseClient,
	userId: string
): Promise<{ id: string; key: string } | null> {
	const row = await client.drizzle
		.select({
			id: d1ApiKeysTable.id,
			key: d1ApiKeysTable.key,
		})
		.from(d1ApiKeysTable)
		.where(and(eq(d1ApiKeysTable.userId, userId), eq(d1ApiKeysTable.status, 'active')))
		.limit(1);
	return row[0] ?? null;
}

export async function getApiKeyBudgetSnapshotD1(
	client: D1DatabaseClient,
	keyId: string
): Promise<{ budgetSpent: number; budgetMax: number | null; budgetPeriod: string | null; budgetResetAt: string | null } | null> {
	const row = await client.drizzle
		.select({
			budgetSpent: d1ApiKeysTable.budgetSpent,
			budgetMax: d1ApiKeysTable.budgetMax,
			budgetPeriod: d1ApiKeysTable.budgetPeriod,
			budgetResetAt: d1ApiKeysTable.budgetResetAt,
		})
		.from(d1ApiKeysTable)
		.where(eq(d1ApiKeysTable.id, keyId))
		.limit(1);
	if (!row[0]) return null;
	return {
		budgetSpent: parseMoney(row[0].budgetSpent),
		budgetMax: row[0].budgetMax == null ? null : parseMoney(row[0].budgetMax),
		budgetPeriod: row[0].budgetPeriod,
		budgetResetAt: row[0].budgetResetAt,
	};
}

export async function getSystemConfigValueD1(client: D1DatabaseClient, key: string): Promise<string | null> {
	const row = await client.drizzle
		.select({ value: d1SystemConfigTable.value })
		.from(d1SystemConfigTable)
		.where(eq(d1SystemConfigTable.key, key))
		.limit(1);
	return row[0]?.value ?? null;
}

export async function createApiKeyWithAuditD1(
	client: D1DatabaseClient,
	params: {
		insert: InsertKeyParams;
		audit: InsertApiKeyBudgetAuditLogParams;
	}
): Promise<void> {
	await ensureD1Batch(client, [
		buildInsertApiKeyStatement(client.raw, params.insert),
		buildInsertApiKeyBudgetAuditLogStatement(client.raw, params.audit),
	]);
}

export async function updateApiKeyBudgetWithAuditTxD1(
	client: D1DatabaseClient,
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
	const updateStmt =
		params.budgetMax !== undefined
			? client.raw
					.prepare(
						'UPDATE api_keys SET budget_spent = ?, budget_reset_at = ?, budget_max = ?, updated_at = datetime("now") WHERE id = ?'
					)
					.bind(
						nextSpent,
						params.budgetResetAt,
						params.budgetMax == null ? null : roundGatewayMoney(params.budgetMax),
						params.keyId
					)
			: client.raw
					.prepare('UPDATE api_keys SET budget_spent = ?, budget_reset_at = ?, updated_at = datetime("now") WHERE id = ?')
					.bind(nextSpent, params.budgetResetAt, params.keyId);
	await ensureD1Batch(client, [
		updateStmt,
		buildInsertApiKeyBudgetAuditLogStatement(client.raw, {
			id: crypto.randomUUID(),
			apiKeyId: params.keyId,
			eventType: params.audit.eventType,
			actorType: params.audit.actorType,
			actorId: params.audit.actorId ?? null,
			reasonCode: params.audit.reasonCode ?? null,
			reasonText: params.audit.reasonText ?? null,
			beforeSpent: params.audit.beforeSpent,
			deltaSpent: params.audit.deltaSpent,
			afterSpent: nextSpent,
			beforeBudgetMax: params.audit.beforeBudgetMax ?? null,
			afterBudgetMax: params.audit.afterBudgetMax ?? null,
			beforeBudgetBase: params.audit.beforeBudgetBase ?? null,
			afterBudgetBase: params.audit.afterBudgetBase ?? null,
			beforeBudgetPeriod: params.audit.beforeBudgetPeriod ?? null,
			afterBudgetPeriod: params.audit.afterBudgetPeriod ?? null,
			beforeBudgetResetAt: params.audit.beforeBudgetResetAt ?? null,
			afterBudgetResetAt: params.budgetResetAt,
			requestLogId: params.audit.requestLogId ?? null,
			metadata: params.audit.metadata ?? null,
		}),
	]);
}

export async function insertRequestUsageAndChargeTxD1(
	client: D1DatabaseClient,
	params: {
		requestLog: InsertRequestLogParams;
		shouldChargeBudget: boolean;
		beforeSpent: number;
		chargedCost: number;
		audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>;
	}
): Promise<void> {
	const charged = roundGatewayMoney(params.chargedCost);
	const statements: D1PreparedStatement[] = [buildInsertRequestLogStatement(client.raw, params.requestLog)];
	if (params.shouldChargeBudget) {
		statements.push(buildIncrementApiKeyBudgetSpentStatement(client.raw, params.audit.apiKeyId, charged));
		statements.push(
			buildInsertApiKeyBudgetAuditLogStatement(client.raw, {
				id: crypto.randomUUID(),
				apiKeyId: params.audit.apiKeyId,
				eventType: params.audit.eventType,
				actorType: params.audit.actorType,
				actorId: params.audit.actorId ?? null,
				reasonCode: params.audit.reasonCode ?? null,
				reasonText: params.audit.reasonText ?? null,
				beforeSpent: params.beforeSpent,
				deltaSpent: charged,
				afterSpent: roundGatewayMoney(params.beforeSpent + charged),
				beforeBudgetMax: params.audit.beforeBudgetMax ?? null,
				afterBudgetMax: params.audit.afterBudgetMax ?? null,
				beforeBudgetBase: params.audit.beforeBudgetBase ?? null,
				afterBudgetBase: params.audit.afterBudgetBase ?? null,
				beforeBudgetPeriod: params.audit.beforeBudgetPeriod ?? null,
				afterBudgetPeriod: params.audit.afterBudgetPeriod ?? null,
				beforeBudgetResetAt: params.audit.beforeBudgetResetAt ?? null,
				afterBudgetResetAt: params.audit.afterBudgetResetAt ?? null,
				requestLogId: params.audit.requestLogId ?? null,
				metadata: params.audit.metadata ?? null,
			})
		);
	}
	await ensureD1Batch(client, statements);
}
