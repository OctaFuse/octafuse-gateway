/**
 * Postgres：`user_audit_logs`。
 */
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { GlobalUserAuditLogRow, UserAuditLogRow } from '../../types';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { UserAuditLogsRepository } from '../../storage/gateway-repository-interfaces';
import {
	userAuditLogsTable as pgUserAuditLogsTable,
	usersTable as pgUsersTable,
} from '../../storage/drizzle/schema.pg';
import type { InsertUserAuditLogParams } from '../user-audit-logs-types';
import { toUserAuditLogDrizzleInsert } from '../user-audit-drizzle-insert';
import { deriveUserAuditBudgetFromSnapshots } from '../user-audit-log-derived';

type PgAuditSelectRow = {
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
};

function mapPgAuditRow(r: PgAuditSelectRow): UserAuditLogRow {
	const derived = deriveUserAuditBudgetFromSnapshots(r.beforeUserSnapshot, r.afterUserSnapshot);
	return {
		id: r.id,
		user_id: r.userId,
		api_key_id: r.apiKeyId,
		event_type: r.eventType,
		actor_type: r.actorType,
		before_spent: derived.before_spent,
		delta_spent: derived.delta_spent,
		after_spent: derived.after_spent,
		before_budget_max: derived.before_budget_max,
		after_budget_max: derived.after_budget_max,
		before_budget_base: derived.before_budget_base,
		after_budget_base: derived.after_budget_base,
		request_log_id: r.requestLogId,
		change_payload: r.changePayload,
		before_user_snapshot: r.beforeUserSnapshot ?? null,
		after_user_snapshot: r.afterUserSnapshot ?? null,
		changed_fields: r.changedFields ?? null,
		correlation_id: r.correlationId ?? null,
		source: r.source ?? null,
		actor_id: r.actorId ?? null,
		reason_code: r.reasonCode ?? null,
		reason_text: r.reasonText ?? null,
		created_at: r.createdAt,
	};
}

export function createPostgresUserAuditLogsRepository(db: PostgresDatabaseClient): UserAuditLogsRepository {
	const drizzle = db.drizzle;
	return {
		async insertUserAuditLog(params: InsertUserAuditLogParams): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(pgUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(params, now));
		},

		async getUserAuditLogsByUserId(
			userId: string,
			page: number,
			pageSize: number
		): Promise<{ logs: UserAuditLogRow[]; total: number }> {
			const offset = (page - 1) * pageSize;
			const total = Number(
				(
					await drizzle
						.select({ c: count() })
						.from(pgUserAuditLogsTable)
						.where(eq(pgUserAuditLogsTable.userId, userId))
				)[0]?.c ?? 0
			);
			const rows = await drizzle
				.select()
				.from(pgUserAuditLogsTable)
				.where(eq(pgUserAuditLogsTable.userId, userId))
				.orderBy(desc(pgUserAuditLogsTable.createdAt))
				.limit(pageSize)
				.offset(offset);
			return { logs: rows.map((r) => mapPgAuditRow(r as PgAuditSelectRow)), total };
		},

		async getGlobalUserAuditLogs(options: {
			page?: number;
			pageSize?: number;
			userId?: string;
			apiKeyId?: string;
			userEmail?: string;
			eventType?: string;
			actorType?: string;
			reasonCode?: string;
			source?: string;
			correlationId?: string;
			startDate?: string;
			endDate?: string;
		}): Promise<{ logs: GlobalUserAuditLogRow[]; total: number }> {
			const page = options.page || 1;
			const pageSize = Math.min(options.pageSize || 20, 100);
			const offset = (page - 1) * pageSize;
			const conditions = [];
			if (options.userId) conditions.push(eq(pgUserAuditLogsTable.userId, options.userId));
			if (options.apiKeyId) conditions.push(eq(pgUserAuditLogsTable.apiKeyId, options.apiKeyId));
			if (options.userEmail) conditions.push(eq(pgUsersTable.email, options.userEmail));
			if (options.eventType) conditions.push(eq(pgUserAuditLogsTable.eventType, options.eventType));
			if (options.actorType) conditions.push(eq(pgUserAuditLogsTable.actorType, options.actorType));
			if (options.reasonCode) conditions.push(eq(pgUserAuditLogsTable.reasonCode, options.reasonCode));
			if (options.source) conditions.push(eq(pgUserAuditLogsTable.source, options.source));
			if (options.correlationId) conditions.push(eq(pgUserAuditLogsTable.correlationId, options.correlationId));
			if (options.startDate) conditions.push(sql`${pgUserAuditLogsTable.createdAt} >= ${options.startDate}`);
			if (options.endDate) conditions.push(sql`${pgUserAuditLogsTable.createdAt} <= ${options.endDate}`);
			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

			let countQ = drizzle
				.select({ total: count() })
				.from(pgUserAuditLogsTable)
				.leftJoin(pgUsersTable, eq(pgUserAuditLogsTable.userId, pgUsersTable.id));
			if (whereExpr) countQ = countQ.where(whereExpr) as typeof countQ;
			const total = Number((await countQ)[0]?.total ?? 0);

			let listQ = drizzle
				.select({
					id: pgUserAuditLogsTable.id,
					userId: pgUserAuditLogsTable.userId,
					apiKeyId: pgUserAuditLogsTable.apiKeyId,
					eventType: pgUserAuditLogsTable.eventType,
					actorType: pgUserAuditLogsTable.actorType,
					requestLogId: pgUserAuditLogsTable.requestLogId,
					changePayload: pgUserAuditLogsTable.changePayload,
					beforeUserSnapshot: pgUserAuditLogsTable.beforeUserSnapshot,
					afterUserSnapshot: pgUserAuditLogsTable.afterUserSnapshot,
					changedFields: pgUserAuditLogsTable.changedFields,
					correlationId: pgUserAuditLogsTable.correlationId,
					source: pgUserAuditLogsTable.source,
					actorId: pgUserAuditLogsTable.actorId,
					reasonCode: pgUserAuditLogsTable.reasonCode,
					reasonText: pgUserAuditLogsTable.reasonText,
					createdAt: pgUserAuditLogsTable.createdAt,
					user_email: pgUsersTable.email,
				})
				.from(pgUserAuditLogsTable)
				.leftJoin(pgUsersTable, eq(pgUserAuditLogsTable.userId, pgUsersTable.id));
			if (whereExpr) listQ = listQ.where(whereExpr) as typeof listQ;
			const rows = await listQ
				.orderBy(desc(pgUserAuditLogsTable.createdAt))
				.limit(pageSize)
				.offset(offset);

			return {
				logs: rows.map((r) => {
					const { user_email, ...rest } = r;
					return { ...mapPgAuditRow(rest as PgAuditSelectRow), user_email };
				}),
				total,
			};
		},
	};
}
