import type { InsertApiKeyBudgetAuditLogParams } from './api-key-budget-audit-logs-types';
import type { InsertUserAuditLogParams } from './user-audit-logs-types';
import { mergeUserAuditMetadata } from './user-audit-metadata';

/** `createApiKeyWithAudit`：审计行挂在 `user_id`，`api_key_id` 指向新密钥。 */
export function insertParamsFromCreateKeyAudit(userId: string, legacy: InsertApiKeyBudgetAuditLogParams): InsertUserAuditLogParams {
	const meta = mergeUserAuditMetadata(legacy.metadata, {
		actorId: legacy.actorId,
		reasonCode: legacy.reasonCode,
		reasonText: legacy.reasonText,
		beforeBudgetBase: legacy.beforeBudgetBase,
		afterBudgetBase: legacy.afterBudgetBase,
		beforeBudgetPeriod: legacy.beforeBudgetPeriod,
		afterBudgetPeriod: legacy.afterBudgetPeriod,
		beforeBudgetResetAt: legacy.beforeBudgetResetAt,
		afterBudgetResetAt: legacy.afterBudgetResetAt,
	});
	return {
		id: legacy.id,
		userId,
		apiKeyId: legacy.apiKeyId,
		eventType: legacy.eventType,
		actorType: legacy.actorType,
		beforeSpent: legacy.beforeSpent,
		deltaSpent: legacy.deltaSpent,
		afterSpent: legacy.afterSpent,
		beforeBudgetMax: legacy.beforeBudgetMax,
		afterBudgetMax: legacy.afterBudgetMax,
		requestLogId: legacy.requestLogId,
		metadata: meta,
	};
}

export function insertParamsFromBudgetTx(
	userId: string,
	keyId: string,
	afterSpent: number,
	budgetResetAt: string | null,
	audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>
): InsertUserAuditLogParams {
	const id = crypto.randomUUID();
	const meta = mergeUserAuditMetadata(audit.metadata, {
		actorId: audit.actorId,
		reasonCode: audit.reasonCode,
		reasonText: audit.reasonText,
		beforeBudgetBase: audit.beforeBudgetBase,
		afterBudgetBase: audit.afterBudgetBase,
		beforeBudgetPeriod: audit.beforeBudgetPeriod,
		afterBudgetPeriod: audit.afterBudgetPeriod,
		beforeBudgetResetAt: audit.beforeBudgetResetAt,
		afterBudgetResetAt: budgetResetAt,
	});
	return {
		id,
		userId,
		apiKeyId: keyId,
		eventType: audit.eventType,
		actorType: audit.actorType,
		beforeSpent: audit.beforeSpent,
		deltaSpent: audit.deltaSpent,
		afterSpent,
		beforeBudgetMax: audit.beforeBudgetMax,
		afterBudgetMax: audit.afterBudgetMax,
		requestLogId: audit.requestLogId,
		metadata: meta,
	};
}

export function insertParamsFromUsageCharge(
	userId: string,
	afterSpent: number,
	chargedDelta: number,
	audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>
): InsertUserAuditLogParams {
	const id = crypto.randomUUID();
	const meta = mergeUserAuditMetadata(audit.metadata, {
		actorId: audit.actorId,
		reasonCode: audit.reasonCode,
		reasonText: audit.reasonText,
		beforeBudgetBase: audit.beforeBudgetBase,
		afterBudgetBase: audit.afterBudgetBase,
		beforeBudgetPeriod: audit.beforeBudgetPeriod,
		afterBudgetPeriod: audit.afterBudgetPeriod,
		beforeBudgetResetAt: audit.beforeBudgetResetAt,
		afterBudgetResetAt: audit.afterBudgetResetAt,
	});
	return {
		id,
		userId,
		apiKeyId: audit.apiKeyId,
		eventType: audit.eventType,
		actorType: audit.actorType,
		beforeSpent: audit.beforeSpent,
		deltaSpent: chargedDelta,
		afterSpent,
		beforeBudgetMax: audit.beforeBudgetMax,
		afterBudgetMax: audit.afterBudgetMax,
		requestLogId: audit.requestLogId,
		metadata: meta,
	};
}

/** 管理端审计：已含 `id` / `afterSpent` 等完整 legacy 字段。 */
export function insertParamsFromFullLegacy(userId: string, legacy: InsertApiKeyBudgetAuditLogParams): InsertUserAuditLogParams {
	const meta = mergeUserAuditMetadata(legacy.metadata, {
		actorId: legacy.actorId,
		reasonCode: legacy.reasonCode,
		reasonText: legacy.reasonText,
		beforeBudgetBase: legacy.beforeBudgetBase,
		afterBudgetBase: legacy.afterBudgetBase,
		beforeBudgetPeriod: legacy.beforeBudgetPeriod,
		afterBudgetPeriod: legacy.afterBudgetPeriod,
		beforeBudgetResetAt: legacy.beforeBudgetResetAt,
		afterBudgetResetAt: legacy.afterBudgetResetAt,
	});
	return {
		id: legacy.id,
		userId,
		apiKeyId: legacy.apiKeyId,
		eventType: legacy.eventType,
		actorType: legacy.actorType,
		beforeSpent: legacy.beforeSpent,
		deltaSpent: legacy.deltaSpent,
		afterSpent: legacy.afterSpent,
		beforeBudgetMax: legacy.beforeBudgetMax,
		afterBudgetMax: legacy.afterBudgetMax,
		requestLogId: legacy.requestLogId,
		metadata: meta,
	};
}
