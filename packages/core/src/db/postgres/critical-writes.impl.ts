/**
 * Postgres：关键写路径（Drizzle 事务），供 `storage/critical-write-paths` 调度。
 */
import { and, eq, sql } from 'drizzle-orm';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import type { InsertKeyParams } from '../api-keys-types';
import type { InsertRequestLogParams } from '../request-logs-types';
import { insertParamsFromBudgetTx, insertParamsFromCreateKeyAudit, insertParamsFromUsageCharge } from '../user-audit-legacy-mapper';
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

export async function getActiveApiKeyByUserIdPg(
	client: PostgresDatabaseClient,
	userId: string
): Promise<{ id: string; key: string } | null> {
	const row = await client.drizzle
		.select({
			id: pgApiKeysTable.id,
			key: pgApiKeysTable.key,
		})
		.from(pgApiKeysTable)
		.where(and(eq(pgApiKeysTable.userId, userId), eq(pgApiKeysTable.status, 'active')))
		.limit(1);
	return row[0] ?? null;
}

export async function getApiKeyBudgetSnapshotPg(
	client: PostgresDatabaseClient,
	keyId: string
): Promise<{ budgetSpent: number; budgetMax: number | null; budgetPeriod: string | null; budgetResetAt: string | null } | null> {
	const row = await client.drizzle
		.select({
			budgetSpent: pgUsersTable.budgetSpent,
			budgetMax: pgUsersTable.budgetMax,
			budgetPeriod: pgUsersTable.budgetPeriod,
			budgetResetAt: pgUsersTable.budgetResetAt,
		})
		.from(pgApiKeysTable)
		.innerJoin(pgUsersTable, eq(pgApiKeysTable.userId, pgUsersTable.id))
		.where(eq(pgApiKeysTable.id, keyId))
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
		audit: InsertApiKeyBudgetAuditLogParams;
	}
): Promise<void> {
	const now = nowIso();
	const auditRow = insertParamsFromCreateKeyAudit(params.insert.userId, params.audit);
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
		await tx.insert(pgUserAuditLogsTable).values({
			id: auditRow.id,
			userId: auditRow.userId,
			apiKeyId: auditRow.apiKeyId ?? null,
			eventType: auditRow.eventType,
			actorType: auditRow.actorType,
			beforeSpent: String(roundGatewayMoney(auditRow.beforeSpent)),
			deltaSpent: String(roundGatewayMoney(auditRow.deltaSpent)),
			afterSpent: String(roundGatewayMoney(auditRow.afterSpent)),
			beforeBudgetMax: auditRow.beforeBudgetMax == null ? null : String(roundGatewayMoney(auditRow.beforeBudgetMax)),
			afterBudgetMax: auditRow.afterBudgetMax == null ? null : String(roundGatewayMoney(auditRow.afterBudgetMax)),
			requestLogId: auditRow.requestLogId ?? null,
			metadata: auditRow.metadata ?? null,
			createdAt: now,
		});
	});
}

export async function updateApiKeyBudgetWithAuditTxPg(
	client: PostgresDatabaseClient,
	params: {
		keyId: string;
		budgetSpent: number;
		budgetResetAt: string | null;
		budgetMax?: number | null;
		audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>;
	}
): Promise<void> {
	const nextSpent = roundGatewayMoney(params.budgetSpent);
	const now = nowIso();
	const keyRow = await client.drizzle
		.select({ userId: pgApiKeysTable.userId })
		.from(pgApiKeysTable)
		.where(eq(pgApiKeysTable.id, params.keyId))
		.limit(1);
	const userId = keyRow[0]?.userId;
	if (!userId) {
		throw new Error('updateApiKeyBudgetWithAuditTxPg: api key not found');
	}
	const auditRow = insertParamsFromBudgetTx(userId, params.keyId, nextSpent, params.budgetResetAt, params.audit);
	await client.drizzle.transaction(async (tx) => {
		const updateSet: Record<string, unknown> = {
			budgetSpent: String(nextSpent),
			budgetResetAt: params.budgetResetAt,
			updatedAt: now,
		};
		if (params.budgetMax !== undefined) {
			updateSet.budgetMax = params.budgetMax == null ? null : String(roundGatewayMoney(params.budgetMax));
		}
		await tx.update(pgUsersTable).set(updateSet).where(eq(pgUsersTable.id, userId));

		await tx.insert(pgUserAuditLogsTable).values({
			id: auditRow.id,
			userId: auditRow.userId,
			apiKeyId: auditRow.apiKeyId ?? null,
			eventType: auditRow.eventType,
			actorType: auditRow.actorType,
			beforeSpent: String(roundGatewayMoney(auditRow.beforeSpent)),
			deltaSpent: String(roundGatewayMoney(auditRow.deltaSpent)),
			afterSpent: String(roundGatewayMoney(auditRow.afterSpent)),
			beforeBudgetMax: auditRow.beforeBudgetMax == null ? null : String(roundGatewayMoney(auditRow.beforeBudgetMax)),
			afterBudgetMax: auditRow.afterBudgetMax == null ? null : String(roundGatewayMoney(auditRow.afterBudgetMax)),
			requestLogId: auditRow.requestLogId ?? null,
			metadata: auditRow.metadata ?? null,
			createdAt: now,
		});
	});
}

export async function insertRequestUsageAndChargeTxPg(
	client: PostgresDatabaseClient,
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

		const auditRow = insertParamsFromUsageCharge(params.userId, afterSpent, charged, params.audit);
		await tx.insert(pgUserAuditLogsTable).values({
			id: auditRow.id,
			userId: auditRow.userId,
			apiKeyId: auditRow.apiKeyId ?? null,
			eventType: auditRow.eventType,
			actorType: auditRow.actorType,
			beforeSpent: String(roundGatewayMoney(auditRow.beforeSpent)),
			deltaSpent: String(charged),
			afterSpent: String(roundGatewayMoney(auditRow.afterSpent)),
			beforeBudgetMax: auditRow.beforeBudgetMax == null ? null : String(roundGatewayMoney(auditRow.beforeBudgetMax)),
			afterBudgetMax: auditRow.afterBudgetMax == null ? null : String(roundGatewayMoney(auditRow.afterBudgetMax)),
			requestLogId: auditRow.requestLogId ?? null,
			metadata: auditRow.metadata ?? null,
			createdAt: now,
		});
	});
}
