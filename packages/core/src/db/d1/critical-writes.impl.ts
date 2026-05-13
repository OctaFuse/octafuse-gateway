/**
 * D1：关键写路径（batch / 原始 SQL），供 `storage/critical-write-paths` 调度。
 */
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { and, eq } from 'drizzle-orm';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import { buildInsertUserAuditLogStatement } from './user-audit-logs.impl';
import type { InsertUserAuditLogParams } from '../user-audit-logs-types';
import { insertParamsFromBudgetTx, insertParamsFromCreateKeyAudit, insertParamsFromUsageCharge } from '../user-audit-legacy-mapper';
import { buildInsertApiKeyStatement } from './api-keys.impl';
import type { InsertKeyParams } from '../api-keys-types';
import { buildInsertRequestLogStatement } from './request-logs.impl';
import type { InsertRequestLogParams } from '../request-logs-types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { D1DatabaseClient } from '../../storage/database-client';
import { parseMoney } from '../../storage/critical-write-paths-utils';
import {
	apiKeysTable as d1ApiKeysTable,
	systemConfigTable as d1SystemConfigTable,
	usersTable as d1UsersTable,
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
			budgetSpent: d1UsersTable.budgetSpent,
			budgetMax: d1UsersTable.budgetMax,
			budgetPeriod: d1UsersTable.budgetPeriod,
			budgetResetAt: d1UsersTable.budgetResetAt,
		})
		.from(d1ApiKeysTable)
		.innerJoin(d1UsersTable, eq(d1ApiKeysTable.userId, d1UsersTable.id))
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
	const auditRow = insertParamsFromCreateKeyAudit(params.insert.userId, params.audit);
	await ensureD1Batch(client, [
		buildInsertApiKeyStatement(client.raw, params.insert),
		buildInsertUserAuditLogStatement(client.raw, auditRow),
	]);
}

export async function updateApiKeyBudgetWithAuditTxD1(
	client: D1DatabaseClient,
	params: {
		keyId: string;
		budgetSpent: number;
		budgetResetAt: string | null;
		budgetMax?: number | null;
		audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>;
	}
): Promise<void> {
	const nextSpent = roundGatewayMoney(params.budgetSpent);
	const userRow = await client.raw
		.prepare('SELECT user_id FROM api_keys WHERE id = ?')
		.bind(params.keyId)
		.first<{ user_id: string }>();
	if (!userRow) {
		throw new Error('updateApiKeyBudgetWithAuditTxD1: api key not found');
	}
	const userId = userRow.user_id;
	const auditRow = insertParamsFromBudgetTx(userId, params.keyId, nextSpent, params.budgetResetAt, params.audit);
	const updateStmt =
		params.budgetMax !== undefined
			? client.raw
					.prepare(
						`UPDATE users SET budget_spent = ?, budget_reset_at = ?, budget_max = COALESCE(?, budget_max), updated_at = datetime('now') WHERE id = ?`
					)
					.bind(nextSpent, params.budgetResetAt, params.budgetMax == null ? null : roundGatewayMoney(params.budgetMax), userId)
			: client.raw
					.prepare(`UPDATE users SET budget_spent = ?, budget_reset_at = ?, updated_at = datetime('now') WHERE id = ?`)
					.bind(nextSpent, params.budgetResetAt, userId);
	await ensureD1Batch(client, [updateStmt, buildInsertUserAuditLogStatement(client.raw, auditRow)]);
}

export async function insertRequestUsageAndChargeTxD1(
	client: D1DatabaseClient,
	params: {
		requestLog: InsertRequestLogParams;
		shouldChargeBudget: boolean;
		userId: string;
		beforeSpent: number;
		chargedCost: number;
		audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>;
	}
): Promise<void> {
	const charged = roundGatewayMoney(params.chargedCost);
	const afterSpent = roundGatewayMoney(params.beforeSpent + charged);
	const statements: D1PreparedStatement[] = [buildInsertRequestLogStatement(client.raw, params.requestLog)];
	if (params.shouldChargeBudget) {
		statements.push(
			client.raw
				.prepare(`UPDATE users SET budget_spent = budget_spent + ?, updated_at = datetime('now') WHERE id = ?`)
				.bind(charged, params.userId)
		);
		const auditRow = insertParamsFromUsageCharge(params.userId, afterSpent, charged, params.audit);
		statements.push(buildInsertUserAuditLogStatement(client.raw, auditRow));
	}
	await ensureD1Batch(client, statements);
}
