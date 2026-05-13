import type { ApiKeyBudgetAuditActorType, ApiKeyBudgetAuditEventType } from '../types';

export interface InsertApiKeyBudgetAuditLogParams {
	id: string;
	/** 用户级审计（无关联密钥）时为 `null` */
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
	 * 周期 reset 基准（与 `api_keys.budget_base` 列对应）变化前/后的快照。
	 * lazy reset 把 `budget_max → budget_base` 时建议同时记录，便于事后对账。
	 */
	beforeBudgetBase?: number | null;
	afterBudgetBase?: number | null;
	beforeBudgetPeriod?: string | null;
	afterBudgetPeriod?: string | null;
	beforeBudgetResetAt?: string | null;
	afterBudgetResetAt?: string | null;
	requestLogId?: string | null;
	metadata?: string | null;
}
