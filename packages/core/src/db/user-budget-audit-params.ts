import type { ApiKeyBudgetAuditActorType, ApiKeyBudgetAuditEventType } from '../types';

/**
 * 写入 `user_audit_logs` 前的用户级预算审计载荷（与 `users` 预算语义对齐）。
 * `beforeSpent` / `deltaSpent` / `afterSpent` 等为对账快照，由调用方提供；表上金额由 `before_user_snapshot` / `after_user_snapshot` 派生。
 */
export interface InsertUserBudgetAuditLogParams {
	id: string;
	/** 触发本次变更的密钥；纯用户级审计时为 `null` */
	apiKeyId: string | null;
	eventType: ApiKeyBudgetAuditEventType;
	actorType: ApiKeyBudgetAuditActorType;
	actorId?: string | null;
	reasonCode?: string | null;
	reasonText?: string | null;
	beforeSpent: number;
	deltaSpent: number;
	afterSpent: number;
	beforeBudgetMax?: number | null;
	afterBudgetMax?: number | null;
	/**
	 * 周期 reset 基准（`users.budget_base`）变化前/后。
	 * lazy reset 将 `budget_max → budget_base` 时建议同时记录，便于事后对账。
	 */
	beforeBudgetBase?: number | null;
	afterBudgetBase?: number | null;
	beforeBudgetPeriod?: string | null;
	afterBudgetPeriod?: string | null;
	beforeBudgetResetAt?: string | null;
	afterBudgetResetAt?: string | null;
	requestLogId?: string | null;
	/** 可选 JSON 字符串，与周期字段等合并写入 `user_audit_logs.change_payload` */
	changePayloadMerge?: string | null;
	/** JSON：用户行快照（见 `user-audit-snapshot`） */
	beforeUserSnapshot?: string | null;
	afterUserSnapshot?: string | null;
	/** JSON string array */
	changedFields?: string | null;
	correlationId?: string | null;
	/** 如 gateway_usage、admin_keys、gateway_auth */
	source?: string | null;
}
