/**
 * MySQL：`user_audit_logs`。
 */
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { GlobalUserAuditLogRow, UserAuditLogRow } from '../../types';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { UserAuditLogsRepository } from '../../storage/gateway-repository-interfaces';
import {
	userAuditLogsTable as myUserAuditLogsTable,
	usersTable as myUsersTable,
} from '../../storage/drizzle/schema.mysql';
import type { InsertUserAuditLogParams } from '../user-audit-logs-types';
import { toUserAuditLogDrizzleInsert } from '../user-audit-drizzle-insert';
import { deriveUserAuditBudgetFromSnapshots } from '../user-audit-log-derived';

type MyAuditSelectRow = {
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

function mapMyAuditRow(r: MyAuditSelectRow): UserAuditLogRow {
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

export function createMySqlUserAuditLogsRepository(db: MySqlDatabaseClient): UserAuditLogsRepository {
	const drizzle = db.drizzle;
	return {
		async insertUserAuditLog(params: InsertUserAuditLogParams): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(myUserAuditLogsTable).values(toUserAuditLogDrizzleInsert(params, now));
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
						.from(myUserAuditLogsTable)
						.where(eq(myUserAuditLogsTable.userId, userId))
				)[0]?.c ?? 0
			);
			const rows = await drizzle
				.select()
				.from(myUserAuditLogsTable)
				.where(eq(myUserAuditLogsTable.userId, userId))
				.orderBy(desc(myUserAuditLogsTable.createdAt))
				.limit(pageSize)
				.offset(offset);
			return { logs: rows.map((r) => mapMyAuditRow(r as MyAuditSelectRow)), total };
		},

		async getGlobalUserAuditLogs(options: {
			page?: number;
			pageSize?: number;
			userId?: string;
			apiKeyId?: string;
			userEmail?: string;
			eventTypes?: string[];
			actorTypes?: string[];
			reasonCodes?: string[];
			sources?: string[];
			correlationId?: string;
			startDate?: string;
			endDate?: string;
		}): Promise<{ logs: GlobalUserAuditLogRow[]; total: number }> {
			const page = options.page || 1;
			const pageSize = Math.min(options.pageSize || 20, 100);
			const offset = (page - 1) * pageSize;
			const conditions = [];
			if (options.userId) conditions.push(eq(myUserAuditLogsTable.userId, options.userId));
			if (options.apiKeyId) conditions.push(eq(myUserAuditLogsTable.apiKeyId, options.apiKeyId));
			if (options.userEmail) conditions.push(eq(myUsersTable.email, options.userEmail));
			if (options.eventTypes && options.eventTypes.length > 0) {
				conditions.push(inArray(myUserAuditLogsTable.eventType, options.eventTypes));
			}
			if (options.actorTypes && options.actorTypes.length > 0) {
				conditions.push(inArray(myUserAuditLogsTable.actorType, options.actorTypes));
			}
			if (options.reasonCodes && options.reasonCodes.length > 0) {
				conditions.push(inArray(myUserAuditLogsTable.reasonCode, options.reasonCodes));
			}
			if (options.sources && options.sources.length > 0) {
				conditions.push(inArray(myUserAuditLogsTable.source, options.sources));
			}
			if (options.correlationId) conditions.push(eq(myUserAuditLogsTable.correlationId, options.correlationId));
			if (options.startDate) conditions.push(sql`${myUserAuditLogsTable.createdAt} >= ${options.startDate}`);
			if (options.endDate) conditions.push(sql`${myUserAuditLogsTable.createdAt} <= ${options.endDate}`);
			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

			let countQ = drizzle
				.select({ total: count() })
				.from(myUserAuditLogsTable)
				.leftJoin(myUsersTable, eq(myUserAuditLogsTable.userId, myUsersTable.id));
			if (whereExpr) countQ = countQ.where(whereExpr) as typeof countQ;
			const total = Number((await countQ)[0]?.total ?? 0);

			let listQ = drizzle
				.select({
					id: myUserAuditLogsTable.id,
					userId: myUserAuditLogsTable.userId,
					apiKeyId: myUserAuditLogsTable.apiKeyId,
					eventType: myUserAuditLogsTable.eventType,
					actorType: myUserAuditLogsTable.actorType,
					requestLogId: myUserAuditLogsTable.requestLogId,
					changePayload: myUserAuditLogsTable.changePayload,
					beforeUserSnapshot: myUserAuditLogsTable.beforeUserSnapshot,
					afterUserSnapshot: myUserAuditLogsTable.afterUserSnapshot,
					changedFields: myUserAuditLogsTable.changedFields,
					correlationId: myUserAuditLogsTable.correlationId,
					source: myUserAuditLogsTable.source,
					actorId: myUserAuditLogsTable.actorId,
					reasonCode: myUserAuditLogsTable.reasonCode,
					reasonText: myUserAuditLogsTable.reasonText,
					createdAt: myUserAuditLogsTable.createdAt,
					user_email: myUsersTable.email,
				})
				.from(myUserAuditLogsTable)
				.leftJoin(myUsersTable, eq(myUserAuditLogsTable.userId, myUsersTable.id));
			if (whereExpr) listQ = listQ.where(whereExpr) as typeof listQ;
			const rows = await listQ
				.orderBy(desc(myUserAuditLogsTable.createdAt))
				.limit(pageSize)
				.offset(offset);

			return {
				logs: rows.map((r) => {
					const { user_email, ...rest } = r;
					return { ...mapMyAuditRow(rest as MyAuditSelectRow), user_email };
				}),
				total,
			};
		},

		async getGlobalUserAuditLogFilterOptions(): Promise<{ reasonCodes: string[] }> {
			const rows = await drizzle
				.select({ reasonCode: myUserAuditLogsTable.reasonCode })
				.from(myUserAuditLogsTable)
				.where(sql`${myUserAuditLogsTable.reasonCode} IS NOT NULL AND ${myUserAuditLogsTable.reasonCode} <> ''`)
				.groupBy(myUserAuditLogsTable.reasonCode)
				.orderBy(myUserAuditLogsTable.reasonCode);
			return { reasonCodes: rows.map((row) => row.reasonCode).filter((value): value is string => !!value) };
		},
	};
}
