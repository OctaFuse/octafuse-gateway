import type { InsertApiKeyBudgetAuditLogParams } from './api-key-budget-audit-logs-types';
import type { InsertUserAuditLogParams } from './user-audit-logs-types';
import { mergeUserAuditMetadata } from './user-audit-metadata';

/** 从 legacy 审计载荷提取的、映射到 `user_audit_logs` 独立列的字段。 */
type LegacyAuditColumnFields = Pick<
	InsertApiKeyBudgetAuditLogParams,
	| 'actorId'
	| 'reasonCode'
	| 'reasonText'
	| 'beforeUserSnapshot'
	| 'afterUserSnapshot'
	| 'changedFields'
	| 'correlationId'
	| 'source'
>;

function auditColumnsFromLegacy(legacy: LegacyAuditColumnFields): Pick<
	InsertUserAuditLogParams,
	| 'actorId'
	| 'reasonCode'
	| 'reasonText'
	| 'beforeUserSnapshot'
	| 'afterUserSnapshot'
	| 'changedFields'
	| 'correlationId'
	| 'source'
> {
	return {
		actorId: legacy.actorId ?? null,
		reasonCode: legacy.reasonCode ?? null,
		reasonText: legacy.reasonText ?? null,
		beforeUserSnapshot: legacy.beforeUserSnapshot ?? null,
		afterUserSnapshot: legacy.afterUserSnapshot ?? null,
		changedFields: legacy.changedFields ?? null,
		correlationId: legacy.correlationId ?? null,
		source: legacy.source ?? null,
	};
}

function budgetMetaFromLegacy(legacy: Pick<
	InsertApiKeyBudgetAuditLogParams,
	| 'metadata'
	| 'beforeBudgetBase'
	| 'afterBudgetBase'
	| 'beforeBudgetPeriod'
	| 'afterBudgetPeriod'
	| 'beforeBudgetResetAt'
	| 'afterBudgetResetAt'
>): string | null {
	return mergeUserAuditMetadata(legacy.metadata, {
		beforeBudgetBase: legacy.beforeBudgetBase,
		afterBudgetBase: legacy.afterBudgetBase,
		beforeBudgetPeriod: legacy.beforeBudgetPeriod,
		afterBudgetPeriod: legacy.afterBudgetPeriod,
		beforeBudgetResetAt: legacy.beforeBudgetResetAt,
		afterBudgetResetAt: legacy.afterBudgetResetAt,
	});
}

/** `createApiKeyWithAudit`：审计行挂在 `user_id`，`api_key_id` 指向新密钥。 */
export function insertParamsFromCreateKeyAudit(userId: string, legacy: InsertApiKeyBudgetAuditLogParams): InsertUserAuditLogParams {
	const meta = budgetMetaFromLegacy(legacy);
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
		...auditColumnsFromLegacy(legacy),
	};
}

export function insertParamsFromBudgetTx(
	userId: string,
	apiKeyId: string | null,
	afterSpent: number,
	budgetResetAt: string | null,
	audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>
): InsertUserAuditLogParams {
	const id = crypto.randomUUID();
	const meta = mergeUserAuditMetadata(audit.metadata, {
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
		apiKeyId,
		eventType: audit.eventType,
		actorType: audit.actorType,
		beforeSpent: audit.beforeSpent,
		deltaSpent: audit.deltaSpent,
		afterSpent,
		beforeBudgetMax: audit.beforeBudgetMax,
		afterBudgetMax: audit.afterBudgetMax,
		requestLogId: audit.requestLogId,
		metadata: meta,
		actorId: audit.actorId ?? null,
		reasonCode: audit.reasonCode ?? null,
		reasonText: audit.reasonText ?? null,
		beforeUserSnapshot: audit.beforeUserSnapshot ?? null,
		afterUserSnapshot: audit.afterUserSnapshot ?? null,
		changedFields: audit.changedFields ?? null,
		correlationId: audit.correlationId ?? null,
		source: audit.source ?? null,
	};
}

export function insertParamsFromUsageCharge(
	userId: string,
	afterSpent: number,
	chargedDelta: number,
	audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>
): InsertUserAuditLogParams {
	const id = crypto.randomUUID();
	const meta = budgetMetaFromLegacy(audit);
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
		...auditColumnsFromLegacy(audit),
	};
}

/** 管理端审计：已含 `id` / `afterSpent` 等完整 legacy 字段。 */
export function insertParamsFromFullLegacy(userId: string, legacy: InsertApiKeyBudgetAuditLogParams): InsertUserAuditLogParams {
	const meta = budgetMetaFromLegacy(legacy);
	return {
		id: legacy.id,
		userId,
		apiKeyId: legacy.apiKeyId ?? null,
		eventType: legacy.eventType,
		actorType: legacy.actorType,
		beforeSpent: legacy.beforeSpent,
		deltaSpent: legacy.deltaSpent,
		afterSpent: legacy.afterSpent,
		beforeBudgetMax: legacy.beforeBudgetMax,
		afterBudgetMax: legacy.afterBudgetMax,
		requestLogId: legacy.requestLogId,
		metadata: meta,
		...auditColumnsFromLegacy(legacy),
	};
}
