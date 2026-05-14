import { roundGatewayMoney } from '../lib/money-precision';
import type { InsertUserAuditLogParams } from './user-audit-logs-types';

/** Drizzle / MySQL / Postgres 写入 `user_audit_logs` 的统一值形状（金额列为 string）。 */
export function toUserAuditLogDrizzleInsert(
	params: InsertUserAuditLogParams,
	createdAt: string
): {
	id: string;
	userId: string;
	apiKeyId: string | null;
	eventType: string;
	actorType: string;
	beforeSpent: string;
	deltaSpent: string;
	afterSpent: string;
	beforeBudgetMax: string | null;
	afterBudgetMax: string | null;
	requestLogId: string | null;
	metadata: string | null;
	beforeUserSnapshot: string | null;
	afterUserSnapshot: string | null;
	changedFields: string | null;
	correlationId: string | null;
	source: string | null;
	actorId: string | null;
	reasonCode: string | null;
	reasonText: string | null;
	createdAt: string;
} {
	return {
		id: params.id,
		userId: params.userId,
		apiKeyId: params.apiKeyId ?? null,
		eventType: params.eventType,
		actorType: params.actorType,
		beforeSpent: String(roundGatewayMoney(params.beforeSpent)),
		deltaSpent: String(roundGatewayMoney(params.deltaSpent)),
		afterSpent: String(roundGatewayMoney(params.afterSpent)),
		beforeBudgetMax: params.beforeBudgetMax == null ? null : String(roundGatewayMoney(params.beforeBudgetMax)),
		afterBudgetMax: params.afterBudgetMax == null ? null : String(roundGatewayMoney(params.afterBudgetMax)),
		requestLogId: params.requestLogId ?? null,
		metadata: params.metadata ?? null,
		beforeUserSnapshot: params.beforeUserSnapshot ?? null,
		afterUserSnapshot: params.afterUserSnapshot ?? null,
		changedFields: params.changedFields ?? null,
		correlationId: params.correlationId ?? null,
		source: params.source ?? null,
		actorId: params.actorId ?? null,
		reasonCode: params.reasonCode ?? null,
		reasonText: params.reasonText ?? null,
		createdAt,
	};
}
