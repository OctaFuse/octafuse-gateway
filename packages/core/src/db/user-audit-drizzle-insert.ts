import type { InsertUserAuditLogParams } from './user-audit-logs-types';
import { assertAndFinalizeUserAuditInsert } from './user-audit-catalog';

/** Drizzle / MySQL / Postgres 写入 `user_audit_logs` 的统一值形状。 */
export function toUserAuditLogDrizzleInsert(
	params: InsertUserAuditLogParams,
	createdAt: string
): {
	id: string;
	userId: string | null;
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
	const p = assertAndFinalizeUserAuditInsert(params);
	return {
		id: p.id,
		userId: p.userId,
		apiKeyId: p.apiKeyId ?? null,
		eventType: p.eventType,
		actorType: p.actorType,
		requestLogId: p.requestLogId ?? null,
		changePayload: p.changePayload ?? null,
		beforeUserSnapshot: p.beforeUserSnapshot ?? null,
		afterUserSnapshot: p.afterUserSnapshot ?? null,
		changedFields: p.changedFields ?? null,
		correlationId: p.correlationId ?? null,
		source: p.source ?? null,
		actorId: p.actorId ?? null,
		reasonCode: p.reasonCode ?? null,
		reasonText: p.reasonText ?? null,
		createdAt,
	};
}
