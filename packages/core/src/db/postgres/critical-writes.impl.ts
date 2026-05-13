/**
 * Postgres：关键写路径（Drizzle 事务），供 `storage/critical-write-paths` 调度。
 */
import { and, eq, sql } from 'drizzle-orm';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import type { InsertKeyParams } from '../api-keys-types';
import type { InsertRequestLogParams } from '../request-logs-types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import { nowIso, parseMoney } from '../../storage/critical-write-paths-utils';
import {
	apiKeyAuditLogsTable as pgApiKeyAuditLogsTable,
	apiKeysTable as pgApiKeysTable,
	apiKeyRequestLogsTable as pgRequestLogsTable,
	systemConfigTable as pgSystemConfigTable,
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
			budgetSpent: pgApiKeysTable.budgetSpent,
			budgetMax: pgApiKeysTable.budgetMax,
			budgetPeriod: pgApiKeysTable.budgetPeriod,
			budgetResetAt: pgApiKeysTable.budgetResetAt,
		})
		.from(pgApiKeysTable)
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
	await client.drizzle.transaction(async (tx) => {
		await tx.insert(pgApiKeysTable).values({
			id: params.insert.id,
			key: params.insert.key,
			userId: params.insert.userId,
			userEmail: params.insert.userEmail ?? null,
			budgetMax: params.insert.budgetMax == null ? null : String(roundGatewayMoney(params.insert.budgetMax)),
			budgetBase: String(params.insert.budgetBase != null ? roundGatewayMoney(params.insert.budgetBase) : 0),
			budgetSpent: String(roundGatewayMoney(params.insert.budgetSpent)),
			budgetPeriod: params.insert.budgetPeriod,
			budgetResetAt: params.insert.budgetResetAt,
			status: params.insert.status,
			createdAt: now,
			updatedAt: now,
		});
		await tx.insert(pgApiKeyAuditLogsTable).values({
			id: params.audit.id,
			apiKeyId: params.audit.apiKeyId,
			eventType: params.audit.eventType,
			actorType: params.audit.actorType,
			actorId: params.audit.actorId ?? null,
			reasonCode: params.audit.reasonCode ?? null,
			reasonText: params.audit.reasonText ?? null,
			beforeSpent: String(roundGatewayMoney(params.audit.beforeSpent)),
			deltaSpent: String(roundGatewayMoney(params.audit.deltaSpent)),
			afterSpent: String(roundGatewayMoney(params.audit.afterSpent)),
			beforeBudgetMax: params.audit.beforeBudgetMax == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetMax)),
			afterBudgetMax: params.audit.afterBudgetMax == null ? null : String(roundGatewayMoney(params.audit.afterBudgetMax)),
			beforeBudgetBase: params.audit.beforeBudgetBase == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetBase)),
			afterBudgetBase: params.audit.afterBudgetBase == null ? null : String(roundGatewayMoney(params.audit.afterBudgetBase)),
			beforeBudgetPeriod: params.audit.beforeBudgetPeriod ?? null,
			afterBudgetPeriod: params.audit.afterBudgetPeriod ?? null,
			beforeBudgetResetAt: params.audit.beforeBudgetResetAt ?? null,
			afterBudgetResetAt: params.audit.afterBudgetResetAt ?? null,
			requestLogId: params.audit.requestLogId ?? null,
			metadata: params.audit.metadata ?? null,
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
	await client.drizzle.transaction(async (tx) => {
		const updateSet: Record<string, unknown> = {
			budgetSpent: String(nextSpent),
			budgetResetAt: params.budgetResetAt,
			updatedAt: now,
		};
		if (params.budgetMax !== undefined) {
			updateSet.budgetMax = params.budgetMax == null ? null : String(roundGatewayMoney(params.budgetMax));
		}
		await tx.update(pgApiKeysTable).set(updateSet).where(eq(pgApiKeysTable.id, params.keyId));

		await tx.insert(pgApiKeyAuditLogsTable).values({
			id: crypto.randomUUID(),
			apiKeyId: params.keyId,
			eventType: params.audit.eventType,
			actorType: params.audit.actorType,
			actorId: params.audit.actorId ?? null,
			reasonCode: params.audit.reasonCode ?? null,
			reasonText: params.audit.reasonText ?? null,
			beforeSpent: String(roundGatewayMoney(params.audit.beforeSpent)),
			deltaSpent: String(roundGatewayMoney(params.audit.deltaSpent)),
			afterSpent: String(nextSpent),
			beforeBudgetMax: params.audit.beforeBudgetMax == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetMax)),
			afterBudgetMax: params.audit.afterBudgetMax == null ? null : String(roundGatewayMoney(params.audit.afterBudgetMax)),
			beforeBudgetBase: params.audit.beforeBudgetBase == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetBase)),
			afterBudgetBase: params.audit.afterBudgetBase == null ? null : String(roundGatewayMoney(params.audit.afterBudgetBase)),
			beforeBudgetPeriod: params.audit.beforeBudgetPeriod ?? null,
			afterBudgetPeriod: params.audit.afterBudgetPeriod ?? null,
			beforeBudgetResetAt: params.audit.beforeBudgetResetAt ?? null,
			afterBudgetResetAt: params.budgetResetAt,
			requestLogId: params.audit.requestLogId ?? null,
			metadata: params.audit.metadata ?? null,
			createdAt: now,
		});
	});
}

export async function insertRequestUsageAndChargeTxPg(
	client: PostgresDatabaseClient,
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
	await client.drizzle.transaction(async (tx) => {
		await tx.insert(pgRequestLogsTable).values({
			id: params.requestLog.id,
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
			.update(pgApiKeysTable)
			.set({
				budgetSpent: sql`${pgApiKeysTable.budgetSpent} + ${String(charged)}`,
				updatedAt: now,
			})
			.where(eq(pgApiKeysTable.id, params.audit.apiKeyId));

		await tx.insert(pgApiKeyAuditLogsTable).values({
			id: crypto.randomUUID(),
			apiKeyId: params.audit.apiKeyId,
			eventType: params.audit.eventType,
			actorType: params.audit.actorType,
			actorId: params.audit.actorId ?? null,
			reasonCode: params.audit.reasonCode ?? null,
			reasonText: params.audit.reasonText ?? null,
			beforeSpent: String(roundGatewayMoney(params.beforeSpent)),
			deltaSpent: String(charged),
			afterSpent: String(roundGatewayMoney(params.beforeSpent + charged)),
			beforeBudgetMax: params.audit.beforeBudgetMax == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetMax)),
			afterBudgetMax: params.audit.afterBudgetMax == null ? null : String(roundGatewayMoney(params.audit.afterBudgetMax)),
			beforeBudgetBase: params.audit.beforeBudgetBase == null ? null : String(roundGatewayMoney(params.audit.beforeBudgetBase)),
			afterBudgetBase: params.audit.afterBudgetBase == null ? null : String(roundGatewayMoney(params.audit.afterBudgetBase)),
			beforeBudgetPeriod: params.audit.beforeBudgetPeriod ?? null,
			afterBudgetPeriod: params.audit.afterBudgetPeriod ?? null,
			beforeBudgetResetAt: params.audit.beforeBudgetResetAt ?? null,
			afterBudgetResetAt: params.audit.afterBudgetResetAt ?? null,
			requestLogId: params.audit.requestLogId ?? null,
			metadata: params.audit.metadata ?? null,
			createdAt: now,
		});
	});
}
