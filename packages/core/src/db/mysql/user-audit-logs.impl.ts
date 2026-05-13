/**
 * MySQL：`user_audit_logs`。
 */
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { GlobalUserAuditLogRow, UserAuditLogRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { UserAuditLogsRepository } from '../../storage/gateway-repository-interfaces';
import {
	userAuditLogsTable as myUserAuditLogsTable,
	usersTable as myUsersTable,
} from '../../storage/drizzle/schema.mysql';
import type { InsertUserAuditLogParams } from '../user-audit-logs-types';
import { parseMoney } from '../../storage/critical-write-paths-utils';

function mapMyAuditRow(r: {
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
	createdAt: string;
}): UserAuditLogRow {
	return {
		id: r.id,
		user_id: r.userId,
		api_key_id: r.apiKeyId,
		event_type: r.eventType,
		actor_type: r.actorType,
		before_spent: parseMoney(r.beforeSpent),
		delta_spent: parseMoney(r.deltaSpent),
		after_spent: parseMoney(r.afterSpent),
		before_budget_max: r.beforeBudgetMax == null ? null : parseMoney(r.beforeBudgetMax),
		after_budget_max: r.afterBudgetMax == null ? null : parseMoney(r.afterBudgetMax),
		request_log_id: r.requestLogId,
		metadata: r.metadata,
		created_at: r.createdAt,
	};
}

export function createMySqlUserAuditLogsRepository(db: MySqlDatabaseClient): UserAuditLogsRepository {
	const drizzle = db.drizzle;
	return {
		async insertUserAuditLog(params: InsertUserAuditLogParams): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(myUserAuditLogsTable).values({
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
				createdAt: now,
			});
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
			return { logs: rows.map(mapMyAuditRow), total };
		},

		async getGlobalUserAuditLogs(options: {
			page?: number;
			pageSize?: number;
			userId?: string;
			apiKeyId?: string;
			userEmail?: string;
			eventType?: string;
			actorType?: string;
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
			if (options.eventType) conditions.push(eq(myUserAuditLogsTable.eventType, options.eventType));
			if (options.actorType) conditions.push(eq(myUserAuditLogsTable.actorType, options.actorType));
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
					beforeSpent: myUserAuditLogsTable.beforeSpent,
					deltaSpent: myUserAuditLogsTable.deltaSpent,
					afterSpent: myUserAuditLogsTable.afterSpent,
					beforeBudgetMax: myUserAuditLogsTable.beforeBudgetMax,
					afterBudgetMax: myUserAuditLogsTable.afterBudgetMax,
					requestLogId: myUserAuditLogsTable.requestLogId,
					metadata: myUserAuditLogsTable.metadata,
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
					return { ...mapMyAuditRow(rest), user_email };
				}),
				total,
			};
		},
	};
}
