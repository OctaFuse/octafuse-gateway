import type { D1Database } from '@cloudflare/workers-types';
import type { InsertUserBudgetAuditLogParams } from '../db/user-budget-audit-params';
import type { InsertKeyParams } from '../db/api-keys-types';
import type { InsertRequestLogParams } from '../db/request-logs-types';
import {
	createApiKeyWithAuditD1,
	getSystemConfigValueD1,
	getUserBudgetSnapshotD1,
	insertRequestUsageAndChargeTxD1,
	updateUserBudgetWithAuditTxD1,
} from '../db/d1/critical-writes.impl';
import {
	createApiKeyWithAuditMy,
	getSystemConfigValueMy,
	getUserBudgetSnapshotMy,
	insertRequestUsageAndChargeTxMy,
	updateUserBudgetWithAuditTxMy,
} from '../db/mysql/critical-writes.impl';
import {
	createApiKeyWithAuditPg,
	getSystemConfigValuePg,
	getUserBudgetSnapshotPg,
	insertRequestUsageAndChargeTxPg,
	updateUserBudgetWithAuditTxPg,
} from '../db/postgres/critical-writes.impl';
import type { GatewayDatabaseClient } from './database-client';
import { createD1DatabaseClient } from './database-client';
import type { GatewayRepositories } from './repositories';

export type StorageRef = D1Database | GatewayDatabaseClient | GatewayRepositories;

export function resolveDatabaseClient(storage: StorageRef): GatewayDatabaseClient {
	if ('driver' in storage) {
		return storage;
	}
	if ('client' in storage) {
		return (storage as GatewayRepositories).client;
	}
	return createD1DatabaseClient(storage as D1Database);
}

export async function getUserBudgetSnapshot(
	storage: StorageRef,
	userId: string
): Promise<{ budgetSpent: number; budgetMax: number | null; budgetPeriod: string | null; budgetResetAt: string | null } | null> {
	const client = resolveDatabaseClient(storage);
	if (client.driver === 'd1') {
		return getUserBudgetSnapshotD1(client, userId);
	}
	if (client.driver === 'mysql') {
		return getUserBudgetSnapshotMy(client, userId);
	}
	return getUserBudgetSnapshotPg(client, userId);
}

export async function getSystemConfigValue(storage: StorageRef, key: string): Promise<string | null> {
	const client = resolveDatabaseClient(storage);
	if (client.driver === 'd1') {
		return getSystemConfigValueD1(client, key);
	}
	if (client.driver === 'mysql') {
		return getSystemConfigValueMy(client, key);
	}
	return getSystemConfigValuePg(client, key);
}

export async function createApiKeyWithAudit(
	storage: StorageRef,
	params: {
		insert: InsertKeyParams;
		audit: InsertUserBudgetAuditLogParams;
	}
): Promise<void> {
	const client = resolveDatabaseClient(storage);
	if (client.driver === 'd1') {
		await createApiKeyWithAuditD1(client, params);
		return;
	}
	if (client.driver === 'mysql') {
		await createApiKeyWithAuditMy(client, params);
		return;
	}
	await createApiKeyWithAuditPg(client, params);
}

/**
 * 条件更新 `users` 预算字段并写 `user_audit_logs`。
 * Postgres / MySQL：`WHERE id=? AND budget_reset_at` 与读库时的 `expectedBudgetResetAt` 一致才更新；否则跳过审计（并发 lazy reset 已由另一请求提交）。
 */
export async function updateUserBudgetWithAuditTx(
	storage: StorageRef,
	params: {
		userId: string;
		expectedBudgetResetAt: string | null;
		budgetSpent: number;
		budgetResetAt: string | null;
		budgetMax?: number | null;
		/** 触发本次写回的密钥（若有），写入审计 `api_key_id` */
		apiKeyId: string | null;
		audit: Omit<InsertUserBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>;
	}
): Promise<void> {
	const client = resolveDatabaseClient(storage);
	if (client.driver === 'd1') {
		await updateUserBudgetWithAuditTxD1(client, params);
		return;
	}
	if (client.driver === 'mysql') {
		await updateUserBudgetWithAuditTxMy(client, params);
		return;
	}
	await updateUserBudgetWithAuditTxPg(client, params);
}

export async function insertRequestUsageAndChargeTx(
	storage: StorageRef,
	params: {
		requestLog: InsertRequestLogParams;
		shouldChargeBudget: boolean;
		/** `users.id`，与 `requestLog.userId` 一致 */
		userId: string;
		beforeSpent: number;
		chargedCost: number;
		audit: Omit<InsertUserBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>;
	}
): Promise<void> {
	const client = resolveDatabaseClient(storage);
	if (client.driver === 'd1') {
		await insertRequestUsageAndChargeTxD1(client, params);
		return;
	}
	if (client.driver === 'mysql') {
		await insertRequestUsageAndChargeTxMy(client, params);
		return;
	}
	await insertRequestUsageAndChargeTxPg(client, params);
}
