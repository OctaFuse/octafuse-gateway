/**
 * `user_audit_logs` 插入与事务内审计载荷。
 * 旧版 `api_key_audit_logs` 的 actor/reason/周期等字段写入 `metadata` JSON。
 */
export interface InsertUserAuditLogParams {
	id: string;
	userId: string;
	apiKeyId?: string | null;
	eventType: string;
	actorType: string;
	requestLogId?: string | null;
	/** 结构化扩展（预算周期前后值、profile patch JSON 等）；原写入 `metadata`。 */
	changePayload?: string | null;
	/** JSON：{@link import('./user-audit-snapshot').UserAuditSnapshot} */
	beforeUserSnapshot?: string | null;
	/** JSON：{@link import('./user-audit-snapshot').UserAuditSnapshot} */
	afterUserSnapshot?: string | null;
	/** JSON string array of changed field names */
	changedFields?: string | null;
	correlationId?: string | null;
	source?: string | null;
	actorId?: string | null;
	reasonCode?: string | null;
	reasonText?: string | null;
}

/** 事务内写审计时的扩展字段（预算周期等合并进 change_payload；actor/reason 走表列）。 */
export interface UserBudgetAuditExtraFields {
	beforeBudgetBase?: number | null;
	afterBudgetBase?: number | null;
	beforeBudgetPeriod?: string | null;
	afterBudgetPeriod?: string | null;
	beforeBudgetResetAt?: string | null;
	afterBudgetResetAt?: string | null;
}
