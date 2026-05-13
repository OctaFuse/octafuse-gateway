/**
 * MySQL：关键写路径（Drizzle 事务），供 `storage/critical-write-paths` 调度。
 */
import { and, eq, sql } from 'drizzle-orm';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import type { InsertKeyParams } from '../api-keys-types';
import type { InsertRequestLogParams } from '../request-logs-types';
import { insertParamsFromBudgetTx, insertParamsFromCreateKeyAudit, insertParamsFromUsageCharge } from '../user-audit-legacy-mapper';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import { nowIso, parseMoney } from '../../storage/critical-write-paths-utils';
import {
	apiKeysTable as myApiKeysTable,
	apiKeyRequestLogsTable as myRequestLogsTable,
	systemConfigTable as mySystemConfigTable,
	userAuditLogsTable as myUserAuditLogsTable,
	usersTable as myUsersTable,
} from '../../storage/drizzle/schema.mysql';

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
		.where(and(eq(myApiKeysTable.userId, userId), eq(myApiKeysTable.status, 'active')))
		.limit(1);
	return row[0] ?? null;
}

export async function getApiKeyBudgetSnapshotMy(
	client: MySqlDatabaseClient,
	keyId: string
): Promise<{ budgetSpent: number; budgetMax: number | null; budgetPeriod: string | null; budgetResetAt: string | null } | null> {
	const row = await client.drizzle
		.select({
			budgetSpent: myUsersTable.budgetSpent,
			budgetMax: myUsersTable.budgetMax,
			budgetPeriod: myUsersTable.budgetPeriod,
			budgetResetAt: myUsersTable.budgetResetAt,
		})
		.from(myApiKeysTable)
		.innerJoin(myUsersTable, eq(myApiKeysTable.userId, myUsersTable.id))
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
	const auditRow = insertParamsFromCreateKeyAudit(params.insert.userId, params.audit);
	await client.drizzle.transaction(async (tx) => {
		const status = params.insert.status ?? 'active';
		await tx.insert(myApiKeysTable).values({
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
		await tx.insert(myUserAuditLogsTable).values({
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

export async function updateApiKeyBudgetWithAuditTxMy(
	client: MySqlDatabaseClient,
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
		.select({ userId: myApiKeysTable.userId })
		.from(myApiKeysTable)
		.where(eq(myApiKeysTable.id, params.keyId))
		.limit(1);
	const userId = keyRow[0]?.userId;
	if (!userId) {
		throw new Error('updateApiKeyBudgetWithAuditTxMy: api key not found');
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
		await tx.update(myUsersTable).set(updateSet).where(eq(myUsersTable.id, userId));

		await tx.insert(myUserAuditLogsTable).values({
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

export async function insertRequestUsageAndChargeTxMy(
	client: MySqlDatabaseClient,
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
		await tx.insert(myRequestLogsTable).values({
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
			.update(myUsersTable)
			.set({
				budgetSpent: sql`${myUsersTable.budgetSpent} + ${String(charged)}`,
				updatedAt: now,
			})
			.where(eq(myUsersTable.id, params.userId));

		const auditRow = insertParamsFromUsageCharge(params.userId, afterSpent, charged, params.audit);
		await tx.insert(myUserAuditLogsTable).values({
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
