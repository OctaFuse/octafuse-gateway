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
}

/** 事务内写审计时的扩展字段（由 critical-write-paths 合并进 metadata）。 */
export interface UserBudgetAuditExtraFields {
	actorId?: string | null;
	reasonCode?: string | null;
	reasonText?: string | null;
	beforeBudgetBase?: number | null;
	afterBudgetBase?: number | null;
	beforeBudgetPeriod?: string | null;
	afterBudgetPeriod?: string | null;
	beforeBudgetResetAt?: string | null;
	afterBudgetResetAt?: string | null;
}
