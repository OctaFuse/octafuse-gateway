/**
 * MySQL：关键写路径（Drizzle 事务），供 `storage/critical-write-paths` 调度。
 */
import type { ResultSetHeader } from 'mysql2/promise';
import { and, eq, sql } from 'drizzle-orm';
import type { InsertUserAuditLogParams } from '../user-audit-logs-types';
import type { InsertUserBudgetAuditLogParams } from '../user-budget-audit-params';
import type { InsertKeyParams } from '../api-keys-types';
import type { InsertRequestLogParams } from '../request-logs-types';
import type { GrantWalletCreditParams, GrantWalletCreditResult } from '../wallet-credit';
import {
	buildWalletCreditAuditRow,
	mapStorageUserToRow,
	walletCreditResult,
	WalletCreditUserNotFoundError,
} from '../wallet-credit';
import type { UserBudgetSnapshot } from '../../storage/critical-write-paths';
import {
	userBudgetAuditToInsertRowForBudgetTx,
	userBudgetAuditToInsertRowForCreateKey,
	userBudgetAuditToInsertRowForUsageCharge,
} from '../user-budget-audit-mapper';
import { toUserAuditLogDrizzleInsert } from '../user-audit-drizzle-insert';
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

export async function getUserBudgetSnapshotMy(
	client: MySqlDatabaseClient,
	userId: string
): Promise<UserBudgetSnapshot | null> {
	const row = await client.drizzle
		.select({
			budgetSpent: myUsersTable.budgetSpent,
			budgetMax: myUsersTable.budgetMax,
			budgetPeriod: myUsersTable.budgetPeriod,
			budgetResetAt: myUsersTable.budgetResetAt,
			walletGranted: myUsersTable.walletGranted,
			walletSpent: myUsersTable.walletSpent,
		})
		.from(myUsersTable)
		.where(eq(myUsersTable.id, userId))
		.limit(1);
	if (!row[0]) return null;
	return {
		budgetSpent: parseMoney(row[0].budgetSpent),
		budgetMax: row[0].budgetMax == null ? null : parseMoney(row[0].budgetMax),
		budgetPeriod: row[0].budgetPeriod,
		budgetResetAt: row[0].budgetResetAt,
		walletGranted: parseMoney(row[0].walletGranted),
		walletSpent: parseMoney(row[0].walletSpent),
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
		audit: InsertUserBudgetAuditLogParams;
	}
): Promise<void> {
	const now = nowIso();
	const auditRow = userBudgetAuditToInsertRowForCreateKey(params.insert.userId, params.audit);
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
		await tx.insert(myUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(auditRow, now));
	});
}

export async function updateUserBudgetWithAuditTxMy(
	client: MySqlDatabaseClient,
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
		const [header] = (await tx
			.update(myUsersTable)
			.set(updateSet)
			.where(
				and(
					eq(myUsersTable.id, params.userId),
					sql`${myUsersTable.budgetResetAt} <=> ${params.expectedBudgetResetAt}`
				)
			)) as unknown as [ResultSetHeader, unknown];
		if (!header?.affectedRows) {
			return;
		}

		await tx.insert(myUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(auditRow, now));
	});
}

export async function applyUserBudgetTransitionWithAuditMy(
	client: MySqlDatabaseClient,
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
		const [header] = (await tx
			.update(myUsersTable)
			.set(updateSet)
			.where(eq(myUsersTable.id, params.userId))) as unknown as [ResultSetHeader, unknown];
		if (!header?.affectedRows) {
			return;
		}
		updated = true;
		await tx.insert(myUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(params.audit, now));
	});
	return updated;
}

export async function insertRequestUsageAndChargeTxMy(
	client: MySqlDatabaseClient,
	params: {
		requestLog: InsertRequestLogParams;
		shouldChargeBudget: boolean;
		userId: string;
		beforeSpent: number;
		chargedCost: number;
		chargedFromWallet?: number;
		audit: Omit<InsertUserBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>;
	}
): Promise<void> {
	const charged = roundGatewayMoney(params.chargedCost);
	const fromWallet = roundGatewayMoney(params.chargedFromWallet ?? params.requestLog.chargedWalletCost ?? 0);
	const fromBudget = roundGatewayMoney(charged - fromWallet);
	const afterSpent = roundGatewayMoney(params.beforeSpent + fromBudget);
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
			requestOperation: params.requestLog.requestOperation ?? null,
			upstreamProtocol: params.requestLog.upstreamProtocol,
			upstreamOperation: params.requestLog.upstreamOperation ?? null,
			modelSurfaceId: params.requestLog.modelSurfaceId ?? null,
			routePoolId: params.requestLog.routePoolId ?? null,
			routeTargetId: params.requestLog.routeTargetId ?? null,
			adapter: params.requestLog.adapter ?? null,
			routeTrace: params.requestLog.routeTrace ?? null,
			inputTokens: params.requestLog.inputTokens,
			outputTokens: params.requestLog.outputTokens,
			cacheReadTokens: params.requestLog.cacheReadTokens,
			cacheWriteTokens: params.requestLog.cacheWriteTokens,
			reasoningTokens: params.requestLog.reasoningTokens,
			totalTokens: params.requestLog.totalTokens,
			meteredCost: String(roundGatewayMoney(params.requestLog.meteredCost)),
			standardCost: String(roundGatewayMoney(params.requestLog.standardCost)),
			chargedCost: String(roundGatewayMoney(params.requestLog.chargedCost)),
			chargedWalletCost: String(fromWallet),
			routeGroup: params.requestLog.routeGroup,
			status: params.requestLog.status,
			latencyMs: params.requestLog.latencyMs ?? null,
			gatewayOverheadMs: params.requestLog.gatewayOverheadMs ?? null,
			upstreamResponseMs: params.requestLog.upstreamResponseMs ?? null,
			finalUpstreamHeadersMs: params.requestLog.finalUpstreamHeadersMs ?? null,
			firstReasoningTokenMs: params.requestLog.firstReasoningTokenMs ?? null,
			firstTokenMs: params.requestLog.firstTokenMs ?? null,
			streamDurationMs: params.requestLog.streamDurationMs ?? null,
			upstreamAttemptCount: params.requestLog.upstreamAttemptCount ?? null,
			upstreamFailoverCount: params.requestLog.upstreamFailoverCount ?? null,
			timingMetadata: params.requestLog.timingMetadata ?? null,
			errorMessage: params.requestLog.errorMessage ?? null,
			rawUsage: params.requestLog.rawUsage ?? null,
			pricingAudit: params.requestLog.pricingAudit ?? null,
			providerKeyId: params.requestLog.providerKeyId ?? null,
			providerKeyLabel: params.requestLog.providerKeyLabel ?? null,
			providerKeyFingerprint: params.requestLog.providerKeyFingerprint ?? null,
			upstreamRequestId: params.requestLog.upstreamRequestId ?? null,
			upstreamMessageId: params.requestLog.upstreamMessageId ?? null,
			billingKind: params.requestLog.billingKind ?? null,
			inputImageCount: params.requestLog.inputImageCount ?? 0,
			outputImageCount: params.requestLog.outputImageCount ?? 0,
			audioDurationSeconds: params.requestLog.audioDurationSeconds ?? null,
			audioCharacters: params.requestLog.audioCharacters ?? null,
			createdAt: now,
		});
		if (!params.shouldChargeBudget) {
			return;
		}
		await tx
			.update(myUsersTable)
			.set({
				budgetSpent: sql`${myUsersTable.budgetSpent} + ${String(fromBudget)}`,
				walletSpent: sql`${myUsersTable.walletSpent} + ${String(fromWallet)}`,
				updatedAt: now,
			})
			.where(eq(myUsersTable.id, params.userId));

		const auditRow = userBudgetAuditToInsertRowForUsageCharge(params.userId, afterSpent, charged, params.audit);
		await tx.insert(myUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(auditRow, now));
	});
}

export async function grantWalletCreditWithAuditTxMy(
	client: MySqlDatabaseClient,
	params: GrantWalletCreditParams
): Promise<GrantWalletCreditResult> {
	const rows = await client.drizzle.select().from(myUsersTable).where(eq(myUsersTable.id, params.userId)).limit(1);
	if (!rows[0]) {
		throw new WalletCreditUserNotFoundError(params.userId);
	}
	const auditId = crypto.randomUUID();
	const { audit } = buildWalletCreditAuditRow(mapStorageUserToRow(rows[0]), params, auditId);
	const amount = roundGatewayMoney(params.amount);
	const now = nowIso();
	const values = toUserAuditLogDrizzleInsert(audit, now);
	let applied = false;
	await client.drizzle.transaction(async (tx) => {
		await tx.insert(myUserAuditLogsTable).values(values).onDuplicateKeyUpdate({
			set: { id: sql`id` },
		});
		const [header] = (await tx
			.update(myUsersTable)
			.set({
				walletGranted: sql`${myUsersTable.walletGranted} + ${String(amount)}`,
				updatedAt: now,
			})
			.where(
				and(
					eq(myUsersTable.id, params.userId),
					sql`EXISTS (SELECT 1 FROM user_audit_logs WHERE id = ${auditId})`
				)
			)) as unknown as [ResultSetHeader, unknown];
		applied = Boolean(header?.affectedRows);
	});
	const after = await client.drizzle
		.select({
			walletGranted: myUsersTable.walletGranted,
			walletSpent: myUsersTable.walletSpent,
		})
		.from(myUsersTable)
		.where(eq(myUsersTable.id, params.userId))
		.limit(1);
	return walletCreditResult(
		applied ? 'applied' : 'duplicate',
		parseMoney(after[0]?.walletGranted),
		parseMoney(after[0]?.walletSpent)
	);
}
