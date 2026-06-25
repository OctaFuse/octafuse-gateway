/**
 * D1：关键写路径（batch / 原始 SQL），供 `storage/critical-write-paths` 调度。
 */
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import type { InsertUserAuditLogParams } from '../user-audit-logs-types';
import type { InsertUserBudgetAuditLogParams } from '../user-budget-audit-params';
import { buildInsertUserAuditLogStatement } from './user-audit-logs.impl';
import {
	userBudgetAuditToInsertRowForBudgetTx,
	userBudgetAuditToInsertRowForCreateKey,
	userBudgetAuditToInsertRowForUsageCharge,
} from '../user-budget-audit-mapper';
import { buildInsertApiKeyStatement } from './api-keys.impl';
import type { InsertKeyParams } from '../api-keys-types';
import { buildInsertRequestLogStatement } from './request-logs.impl';
import type { InsertRequestLogParams } from '../request-logs-types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { D1DatabaseClient } from '../../storage/database-client';
import { parseMoney } from '../../storage/critical-write-paths-utils';
import {
	systemConfigTable as d1SystemConfigTable,
	usersTable as d1UsersTable,
} from '../../storage/drizzle/schema.d1';

function ensureD1Batch(client: D1DatabaseClient, statements: D1PreparedStatement[]): Promise<void> {
	return client.raw.batch(statements).then(() => undefined);
}

export async function getUserBudgetSnapshotD1(
	client: D1DatabaseClient,
	userId: string
): Promise<{ budgetSpent: number; budgetMax: number | null; budgetPeriod: string | null; budgetResetAt: string | null } | null> {
	const row = await client.drizzle
		.select({
			budgetSpent: d1UsersTable.budgetSpent,
			budgetMax: d1UsersTable.budgetMax,
			budgetPeriod: d1UsersTable.budgetPeriod,
			budgetResetAt: d1UsersTable.budgetResetAt,
		})
		.from(d1UsersTable)
		.where(eq(d1UsersTable.id, userId))
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
		audit: InsertUserBudgetAuditLogParams;
	}
): Promise<void> {
	const auditRow = userBudgetAuditToInsertRowForCreateKey(params.insert.userId, params.audit);
	await ensureD1Batch(client, [
		buildInsertApiKeyStatement(client.raw, params.insert),
		buildInsertUserAuditLogStatement(client.raw, auditRow),
	]);
}

export async function updateUserBudgetWithAuditTxD1(
	client: D1DatabaseClient,
	params: {
		userId: string;
		/** 读库时的 `users.budget_reset_at`，与之一致才更新（防并发 lazy reset 重复审计） */
		expectedBudgetResetAt: string | null;
		budgetSpent: number;
		budgetResetAt: string | null;
		budgetMax?: number | null;
		apiKeyId: string | null;
		audit: Omit<InsertUserBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>;
	}
): Promise<void> {
	const nextSpent = roundGatewayMoney(params.budgetSpent);
	const auditRow = userBudgetAuditToInsertRowForBudgetTx(
		params.userId,
		params.apiKeyId,
		nextSpent,
		params.budgetResetAt,
		params.audit
	);
	const updateStmt =
		params.budgetMax !== undefined
			? client.raw
					.prepare(
						`UPDATE users SET budget_spent = ?, budget_reset_at = ?, budget_max = COALESCE(?, budget_max), updated_at = datetime('now') WHERE id = ? AND budget_reset_at IS NOT DISTINCT FROM ?`
					)
					.bind(
						nextSpent,
						params.budgetResetAt,
						params.budgetMax == null ? null : roundGatewayMoney(params.budgetMax),
						params.userId,
						params.expectedBudgetResetAt
					)
			: client.raw
					.prepare(
						`UPDATE users SET budget_spent = ?, budget_reset_at = ?, updated_at = datetime('now') WHERE id = ? AND budget_reset_at IS NOT DISTINCT FROM ?`
					)
					.bind(nextSpent, params.budgetResetAt, params.userId, params.expectedBudgetResetAt);
	const runResult = await updateStmt.run();
	const changes = runResult.meta?.changes ?? 0;
	if (changes === 0) {
		return;
	}
	await ensureD1Batch(client, [buildInsertUserAuditLogStatement(client.raw, auditRow)]);
}

export async function applyUserBudgetTransitionWithAuditD1(
	client: D1DatabaseClient,
	params: {
		userId: string;
		budgetMax: number | null;
		budgetBase: number;
		budgetSpent: number;
		budgetPeriod: string;
		budgetResetAt: string | null;
		metadata?: string | null;
		audit: InsertUserAuditLogParams;
	}
): Promise<boolean> {
	const nextSpent = roundGatewayMoney(params.budgetSpent);
	const nextBase = roundGatewayMoney(params.budgetBase);
	const nextMax = params.budgetMax == null ? null : roundGatewayMoney(params.budgetMax);
	const metadataClause = params.metadata !== undefined ? ', metadata = ?' : '';
	const updateSql =
		"UPDATE users SET budget_max = ?, budget_base = ?, budget_spent = ?, budget_period = ?, budget_reset_at = ?, updated_at = datetime('now')" +
		metadataClause +
		' WHERE id = ?';
	const binds: unknown[] = [nextMax, nextBase, nextSpent, params.budgetPeriod, params.budgetResetAt];
	if (params.metadata !== undefined) {
		binds.push(params.metadata);
	}
	binds.push(params.userId);
	const updateStmt = client.raw.prepare(updateSql).bind(...binds);
	const runResult = await updateStmt.run();
	const changes = runResult.meta?.changes ?? 0;
	if (changes === 0) {
		return false;
	}
	await ensureD1Batch(client, [buildInsertUserAuditLogStatement(client.raw, params.audit)]);
	return true;
}

export async function insertRequestUsageAndChargeTxD1(
	client: D1DatabaseClient,
	params: {
		requestLog: InsertRequestLogParams;
		shouldChargeBudget: boolean;
		userId: string;
		beforeSpent: number;
		chargedCost: number;
		audit: Omit<InsertUserBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>;
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
		const auditRow = userBudgetAuditToInsertRowForUsageCharge(params.userId, afterSpent, charged, params.audit);
		statements.push(buildInsertUserAuditLogStatement(client.raw, auditRow));
	}
	await ensureD1Batch(client, statements);
}
