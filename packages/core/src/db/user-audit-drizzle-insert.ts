import type { InsertUserAuditLogParams } from './user-audit-logs-types';

/** Drizzle / MySQL / Postgres 写入 `user_audit_logs` 的统一值形状。 */
export function toUserAuditLogDrizzleInsert(
	params: InsertUserAuditLogParams,
	createdAt: string
): {
	id: string;
	userId: string;
	apiKeyId: string | null;
	eventType: string;
	actorType: string;
	requestLogId: string | null;
	changePayload: string | null;
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
		requestLogId: params.requestLogId ?? null,
		changePayload: params.changePayload ?? null,
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
