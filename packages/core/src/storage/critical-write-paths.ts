import type { D1Database } from '@cloudflare/workers-types';
import type { InsertApiKeyBudgetAuditLogParams } from '../db/api-key-budget-audit-logs-types';
import type { InsertKeyParams } from '../db/api-keys-types';
import type { InsertRequestLogParams } from '../db/request-logs-types';
import {
	createApiKeyWithAuditD1,
	getActiveApiKeyByUserIdD1,
	getApiKeyBudgetSnapshotD1,
	getSystemConfigValueD1,
	insertRequestUsageAndChargeTxD1,
	updateApiKeyBudgetWithAuditTxD1,
} from '../db/d1/critical-writes.impl';
import {
	createApiKeyWithAuditMy,
	getActiveApiKeyByUserIdMy,
	getApiKeyBudgetSnapshotMy,
	getSystemConfigValueMy,
	insertRequestUsageAndChargeTxMy,
	updateApiKeyBudgetWithAuditTxMy,
} from '../db/mysql/critical-writes.impl';
import {
	createApiKeyWithAuditPg,
	getActiveApiKeyByUserIdPg,
	getApiKeyBudgetSnapshotPg,
	getSystemConfigValuePg,
	insertRequestUsageAndChargeTxPg,
	updateApiKeyBudgetWithAuditTxPg,
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

export async function getActiveApiKeyByUserId(storage: StorageRef, userId: string): Promise<{ id: string; key: string } | null> {
	const client = resolveDatabaseClient(storage);
	if (client.driver === 'd1') {
		return getActiveApiKeyByUserIdD1(client, userId);
	}
	if (client.driver === 'mysql') {
		return getActiveApiKeyByUserIdMy(client, userId);
	}
	return getActiveApiKeyByUserIdPg(client, userId);
}

export async function getApiKeyBudgetSnapshot(
	storage: StorageRef,
	keyId: string
): Promise<{ budgetSpent: number; budgetMax: number | null; budgetPeriod: string | null; budgetResetAt: string | null } | null> {
	const client = resolveDatabaseClient(storage);
	if (client.driver === 'd1') {
		return getApiKeyBudgetSnapshotD1(client, keyId);
	}
	if (client.driver === 'mysql') {
		return getApiKeyBudgetSnapshotMy(client, keyId);
	}
	return getApiKeyBudgetSnapshotPg(client, keyId);
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
		audit: InsertApiKeyBudgetAuditLogParams;
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

export async function updateApiKeyBudgetWithAuditTx(
	storage: StorageRef,
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
	const client = resolveDatabaseClient(storage);
	if (client.driver === 'd1') {
		await updateApiKeyBudgetWithAuditTxD1(client, params);
		return;
	}
	if (client.driver === 'mysql') {
		await updateApiKeyBudgetWithAuditTxMy(client, params);
		return;
	}
	await updateApiKeyBudgetWithAuditTxPg(client, params);
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
		audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>;
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
