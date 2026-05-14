import type { InsertUserBudgetAuditLogParams } from './user-budget-audit-params';
import type { InsertUserAuditLogParams } from './user-audit-logs-types';
import { mergeUserAuditChangePayload } from './user-audit-metadata';

type AuditColumnFields = Pick<
	InsertUserBudgetAuditLogParams,
	| 'actorId'
	| 'reasonCode'
	| 'reasonText'
	| 'beforeUserSnapshot'
	| 'afterUserSnapshot'
	| 'changedFields'
	| 'correlationId'
	| 'source'
>;

function auditColumnsFromBudgetAudit(fields: AuditColumnFields): Pick<
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
		actorId: fields.actorId ?? null,
		reasonCode: fields.reasonCode ?? null,
		reasonText: fields.reasonText ?? null,
		beforeUserSnapshot: fields.beforeUserSnapshot ?? null,
		afterUserSnapshot: fields.afterUserSnapshot ?? null,
		changedFields: fields.changedFields ?? null,
		correlationId: fields.correlationId ?? null,
		source: fields.source ?? null,
	};
}

function changePayloadFromBudgetAudit(
	p: Pick<
		InsertUserBudgetAuditLogParams,
		| 'changePayloadMerge'
		| 'beforeBudgetBase'
		| 'afterBudgetBase'
		| 'beforeBudgetPeriod'
		| 'afterBudgetPeriod'
		| 'beforeBudgetResetAt'
		| 'afterBudgetResetAt'
	>
): string | null {
	return mergeUserAuditChangePayload(p.changePayloadMerge ?? null, {
		beforeBudgetBase: p.beforeBudgetBase,
		afterBudgetBase: p.afterBudgetBase,
		beforeBudgetPeriod: p.beforeBudgetPeriod,
		afterBudgetPeriod: p.afterBudgetPeriod,
		beforeBudgetResetAt: p.beforeBudgetResetAt,
		afterBudgetResetAt: p.afterBudgetResetAt,
	});
}

/** `createApiKeyWithAudit`：审计行挂在 `user_id`，`api_key_id` 指向新密钥。 */
export function userBudgetAuditToInsertRowForCreateKey(
	userId: string,
	params: InsertUserBudgetAuditLogParams
): InsertUserAuditLogParams {
	const changePayload = changePayloadFromBudgetAudit(params);
	return {
		id: params.id,
		userId,
		apiKeyId: params.apiKeyId,
		eventType: params.eventType,
		actorType: params.actorType,
		requestLogId: params.requestLogId,
		changePayload,
		...auditColumnsFromBudgetAudit(params),
	};
}

export function userBudgetAuditToInsertRowForBudgetTx(
	userId: string,
	apiKeyId: string | null,
	_afterSpent: number,
	budgetResetAtForPayload: string | null,
	audit: Omit<InsertUserBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>
): InsertUserAuditLogParams {
	const id = crypto.randomUUID();
	const changePayload = mergeUserAuditChangePayload(audit.changePayloadMerge ?? null, {
		beforeBudgetBase: audit.beforeBudgetBase,
		afterBudgetBase: audit.afterBudgetBase,
		beforeBudgetPeriod: audit.beforeBudgetPeriod,
		afterBudgetPeriod: audit.afterBudgetPeriod,
		beforeBudgetResetAt: audit.beforeBudgetResetAt,
		afterBudgetResetAt: budgetResetAtForPayload,
	});
	return {
		id,
		userId,
		apiKeyId,
		eventType: audit.eventType,
		actorType: audit.actorType,
		requestLogId: audit.requestLogId,
		changePayload,
		...auditColumnsFromBudgetAudit(audit),
	};
}

export function userBudgetAuditToInsertRowForUsageCharge(
	userId: string,
	_afterSpent: number,
	_chargedDelta: number,
	audit: Omit<InsertUserBudgetAuditLogParams, 'id' | 'afterSpent' | 'deltaSpent'>
): InsertUserAuditLogParams {
	const id = crypto.randomUUID();
	const changePayload = changePayloadFromBudgetAudit(audit);
	return {
		id,
		userId,
		apiKeyId: audit.apiKeyId,
		eventType: audit.eventType,
		actorType: audit.actorType,
		requestLogId: audit.requestLogId,
		changePayload,
		...auditColumnsFromBudgetAudit(audit),
	};
}

/** 管理端等：已含完整 `id` 与预算快照字段；金额与上限以快照为准。 */
export function userBudgetAuditToInsertRowFull(
	userId: string,
	params: InsertUserBudgetAuditLogParams
): InsertUserAuditLogParams {
	const changePayload = changePayloadFromBudgetAudit(params);
	return {
		id: params.id,
		userId,
		apiKeyId: params.apiKeyId ?? null,
		eventType: params.eventType,
		actorType: params.actorType,
		requestLogId: params.requestLogId,
		changePayload,
		...auditColumnsFromBudgetAudit(params),
	};
}
