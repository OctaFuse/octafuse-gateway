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
	beforeSpent: number;
	deltaSpent: number;
	afterSpent: number;
	beforeBudgetMax?: number | null;
	afterBudgetMax?: number | null;
	requestLogId?: string | null;
	metadata?: string | null;
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

/** 事务内写审计时的扩展字段（预算周期等仍合并进 metadata；actor/reason 走表列）。 */
export interface UserBudgetAuditExtraFields {
	beforeBudgetBase?: number | null;
	afterBudgetBase?: number | null;
	beforeBudgetPeriod?: string | null;
	afterBudgetPeriod?: string | null;
	beforeBudgetResetAt?: string | null;
	afterBudgetResetAt?: string | null;
}
