/**
 * Postgres：关键写路径（Drizzle 事务），供 `storage/critical-write-paths` 调度。
 */
import { and, eq, sql } from 'drizzle-orm';
import type { InsertUserAuditLogParams } from '../user-audit-logs-types';
import type { InsertUserBudgetAuditLogParams } from '../user-budget-audit-params';
import type { InsertKeyParams } from '../api-keys-types';
import type { InsertRequestLogParams } from '../request-logs-types';
import {
	userBudgetAuditToInsertRowForBudgetTx,
	userBudgetAuditToInsertRowForCreateKey,
	userBudgetAuditToInsertRowForUsageCharge,
} from '../user-budget-audit-mapper';
import { toUserAuditLogDrizzleInsert } from '../user-audit-drizzle-insert';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import { nowIso, parseMoney } from '../../storage/critical-write-paths-utils';
import {
	apiKeysTable as pgApiKeysTable,
	apiKeyRequestLogsTable as pgRequestLogsTable,
	systemConfigTable as pgSystemConfigTable,
	userAuditLogsTable as pgUserAuditLogsTable,
	usersTable as pgUsersTable,
} from '../../storage/drizzle/schema.pg';

export async function getUserBudgetSnapshotPg(
	client: PostgresDatabaseClient,
	userId: string
): Promise<{ budgetSpent: number; budgetMax: number | null; budgetPeriod: string | null; budgetResetAt: string | null } | null> {
	const row = await client.drizzle
		.select({
			budgetSpent: pgUsersTable.budgetSpent,
			budgetMax: pgUsersTable.budgetMax,
			budgetPeriod: pgUsersTable.budgetPeriod,
			budgetResetAt: pgUsersTable.budgetResetAt,
		})
		.from(pgUsersTable)
		.where(eq(pgUsersTable.id, userId))
		.limit(1);
	if (!row[0]) return null;
	return {
		budgetSpent: parseMoney(row[0].budgetSpent),
		budgetMax: row[0].budgetMax == null ? null : parseMoney(row[0].budgetMax),
		budgetPeriod: row[0].budgetPeriod,
		budgetResetAt: row[0].budgetResetAt,
	};
}

export async function getSystemConfigValuePg(client: PostgresDatabaseClient, key: string): Promise<string | null> {
	const row = await client.drizzle
		.select({ value: pgSystemConfigTable.value })
		.from(pgSystemConfigTable)
		.where(eq(pgSystemConfigTable.key, key))
		.limit(1);
	return row[0]?.value ?? null;
}

export async function createApiKeyWithAuditPg(
	client: PostgresDatabaseClient,
	params: {
		insert: InsertKeyParams;
		audit: InsertUserBudgetAuditLogParams;
	}
): Promise<void> {
	const now = nowIso();
	const auditRow = userBudgetAuditToInsertRowForCreateKey(params.insert.userId, params.audit);
	await client.drizzle.transaction(async (tx) => {
		const status = params.insert.status ?? 'active';
		await tx.insert(pgApiKeysTable).values({
			id: params.insert.id,
			key: params.insert.key,
			userId: params.insert.userId,
			name: params.insert.name ?? null,
			status,
			metadata: params.insert.metadata ?? null,
			lastUsedAt: null,
			createdAt: now,
			updatedAt: now,
		});
		await tx.insert(pgUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(auditRow, now));
	});
}

export async function updateUserBudgetWithAuditTxPg(
	client: PostgresDatabaseClient,
	params: {
		userId: string;
		expectedBudgetResetAt: string | null;
		budgetSpent: number;
		budgetResetAt: string | null;
		budgetMax?: number | null;
		apiKeyId: string | null;
		audit: Omit<InsertUserBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>;
	}
): Promise<void> {
	const nextSpent = roundGatewayMoney(params.budgetSpent);
	const now = nowIso();
	const auditRow = userBudgetAuditToInsertRowForBudgetTx(
		params.userId,
		params.apiKeyId,
		nextSpent,
		params.budgetResetAt,
		params.audit
	);
	await client.drizzle.transaction(async (tx) => {
		const updateSet: Record<string, unknown> = {
			budgetSpent: String(nextSpent),
			budgetResetAt: params.budgetResetAt,
			updatedAt: now,
		};
		if (params.budgetMax !== undefined) {
			updateSet.budgetMax = params.budgetMax == null ? null : String(roundGatewayMoney(params.budgetMax));
		}
		const updated = await tx
			.update(pgUsersTable)
			.set(updateSet)
			.where(
				and(
					eq(pgUsersTable.id, params.userId),
					sql`${pgUsersTable.budgetResetAt} IS NOT DISTINCT FROM ${params.expectedBudgetResetAt}`
				)
			)
			.returning({ id: pgUsersTable.id });
		if (updated.length === 0) {
			return;
		}

		await tx.insert(pgUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(auditRow, now));
	});
}

export async function applyUserBudgetTransitionWithAuditPg(
	client: PostgresDatabaseClient,
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
	const now = nowIso();
	let updated = false;
	await client.drizzle.transaction(async (tx) => {
		const updateSet: Record<string, unknown> = {
			budgetMax: params.budgetMax == null ? null : String(roundGatewayMoney(params.budgetMax)),
			budgetBase: String(roundGatewayMoney(params.budgetBase)),
			budgetSpent: String(roundGatewayMoney(params.budgetSpent)),
			budgetPeriod: params.budgetPeriod,
			budgetResetAt: params.budgetResetAt,
			updatedAt: now,
		};
		if (params.metadata !== undefined) {
			updateSet.metadata = params.metadata;
		}
		const rows = await tx
			.update(pgUsersTable)
			.set(updateSet)
			.where(eq(pgUsersTable.id, params.userId))
			.returning({ id: pgUsersTable.id });
		if (rows.length === 0) {
			return;
		}
		updated = true;
		await tx.insert(pgUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(params.audit, now));
	});
	return updated;
}

export async function insertRequestUsageAndChargeTxPg(
	client: PostgresDatabaseClient,
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
	const now = nowIso();
	await client.drizzle.transaction(async (tx) => {
		await tx.insert(pgRequestLogsTable).values({
			id: params.requestLog.id,
			userId: params.requestLog.userId,
			apiKeyId: params.requestLog.apiKeyId,
			userEmail: params.requestLog.userEmail ?? null,
			modelId: params.requestLog.modelId ?? null,
			providerId: params.requestLog.providerId ?? null,
			providerModelName: params.requestLog.providerModelName ?? null,
			modelName: params.requestLog.modelName ?? null,
			providerName: params.requestLog.providerName ?? null,
			requestBody: params.requestLog.requestBody ?? null,
			upstreamRequestBody: params.requestLog.upstreamRequestBody ?? null,
			requestProtocol: params.requestLog.requestProtocol ?? null,
			upstreamProtocol: params.requestLog.upstreamProtocol,
			inputTokens: params.requestLog.inputTokens,
			outputTokens: params.requestLog.outputTokens,
			cacheReadTokens: params.requestLog.cacheReadTokens,
			cacheWriteTokens: params.requestLog.cacheWriteTokens,
			reasoningTokens: params.requestLog.reasoningTokens,
			totalTokens: params.requestLog.totalTokens,
			meteredCost: String(roundGatewayMoney(params.requestLog.meteredCost)),
			standardCost: String(roundGatewayMoney(params.requestLog.standardCost)),
			chargedCost: String(roundGatewayMoney(params.requestLog.chargedCost)),
			routeGroup: params.requestLog.routeGroup,
			status: params.requestLog.status,
			latencyMs: params.requestLog.latencyMs ?? null,
			errorMessage: params.requestLog.errorMessage ?? null,
			rawUsage: params.requestLog.rawUsage ?? null,
			pricingAudit: params.requestLog.pricingAudit ?? null,
			providerKeyId: params.requestLog.providerKeyId ?? null,
			providerKeyLabel: params.requestLog.providerKeyLabel ?? null,
			providerKeyFingerprint: params.requestLog.providerKeyFingerprint ?? null,
			createdAt: now,
		});
		if (!params.shouldChargeBudget) {
			return;
		}
		await tx
			.update(pgUsersTable)
			.set({
				budgetSpent: sql`${pgUsersTable.budgetSpent} + ${String(charged)}`,
				updatedAt: now,
			})
			.where(eq(pgUsersTable.id, params.userId));

		const auditRow = userBudgetAuditToInsertRowForUsageCharge(params.userId, afterSpent, charged, params.audit);
		await tx.insert(pgUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(auditRow, now));
	});
}
