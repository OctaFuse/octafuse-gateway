/**
 * Postgres：`api_key_audit_logs`（Drizzle）。
 */
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import type {
	ApiKeyBudgetAuditEventType,
	ApiKeyBudgetAuditLogRow,
	ApiKeyBudgetAuditActorType,
	GlobalApiKeyBudgetAuditLogRow,
} from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { ApiKeyBudgetAuditLogsRepository } from '../../storage/gateway-repository-interfaces';
import { apiKeyAuditLogsTable as pgAuditTable, apiKeysTable as pgApiKeysTable } from '../../storage/drizzle/schema.pg';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';

async function insertApiKeyBudgetAuditLogPg(db: PostgresDatabaseClient, params: InsertApiKeyBudgetAuditLogParams): Promise<void> {
	const now = new Date().toISOString();
	await db.drizzle.insert(pgAuditTable).values({
		id: params.id,
		apiKeyId: params.apiKeyId,
		eventType: params.eventType,
		actorType: params.actorType,
		actorId: params.actorId ?? null,
		reasonCode: params.reasonCode ?? null,
		reasonText: params.reasonText ?? null,
		beforeSpent: String(roundGatewayMoney(params.beforeSpent)),
		deltaSpent: String(roundGatewayMoney(params.deltaSpent)),
		afterSpent: String(roundGatewayMoney(params.afterSpent)),
		beforeBudgetMax: params.beforeBudgetMax == null ? null : String(roundGatewayMoney(params.beforeBudgetMax)),
		afterBudgetMax: params.afterBudgetMax == null ? null : String(roundGatewayMoney(params.afterBudgetMax)),
		beforeBudgetBase: params.beforeBudgetBase == null ? null : String(roundGatewayMoney(params.beforeBudgetBase)),
		afterBudgetBase: params.afterBudgetBase == null ? null : String(roundGatewayMoney(params.afterBudgetBase)),
		beforeBudgetPeriod: params.beforeBudgetPeriod ?? null,
		afterBudgetPeriod: params.afterBudgetPeriod ?? null,
		beforeBudgetResetAt: params.beforeBudgetResetAt ?? null,
		afterBudgetResetAt: params.afterBudgetResetAt ?? null,
		requestLogId: params.requestLogId ?? null,
		metadata: params.metadata ?? null,
		createdAt: now,
	});
}

function mapPgAuditRow(r: {
	id: string;
	apiKeyId: string;
	eventType: string;
	actorType: string;
	actorId: string | null;
	reasonCode: string | null;
	reasonText: string | null;
	beforeSpent: string;
	deltaSpent: string;
	afterSpent: string;
	beforeBudgetMax: string | null;
	afterBudgetMax: string | null;
	beforeBudgetBase?: string | null;
	afterBudgetBase?: string | null;
	beforeBudgetPeriod: string | null;
	afterBudgetPeriod: string | null;
	beforeBudgetResetAt: string | null;
	afterBudgetResetAt: string | null;
	requestLogId: string | null;
	metadata: string | null;
	createdAt: string;
}): ApiKeyBudgetAuditLogRow {
	return {
		id: r.id,
		api_key_id: r.apiKeyId,
		event_type: r.eventType as ApiKeyBudgetAuditEventType,
		actor_type: r.actorType as ApiKeyBudgetAuditActorType,
		actor_id: r.actorId,
		reason_code: r.reasonCode,
		reason_text: r.reasonText,
		before_spent: roundGatewayMoney(Number(r.beforeSpent)),
		delta_spent: roundGatewayMoney(Number(r.deltaSpent)),
		after_spent: roundGatewayMoney(Number(r.afterSpent)),
		before_budget_max: r.beforeBudgetMax == null ? null : roundGatewayMoney(Number(r.beforeBudgetMax)),
		after_budget_max: r.afterBudgetMax == null ? null : roundGatewayMoney(Number(r.afterBudgetMax)),
		before_budget_base: r.beforeBudgetBase == null ? null : roundGatewayMoney(Number(r.beforeBudgetBase)),
		after_budget_base: r.afterBudgetBase == null ? null : roundGatewayMoney(Number(r.afterBudgetBase)),
		before_budget_period: r.beforeBudgetPeriod,
		after_budget_period: r.afterBudgetPeriod,
		before_budget_reset_at: r.beforeBudgetResetAt,
		after_budget_reset_at: r.afterBudgetResetAt,
		request_log_id: r.requestLogId,
		metadata: r.metadata,
		created_at: r.createdAt,
	};
}

export function createPostgresApiKeyBudgetAuditLogsRepository(db: PostgresDatabaseClient): ApiKeyBudgetAuditLogsRepository {
	const drizzle = db.drizzle;
	return {
		async insertApiKeyBudgetAuditLog(params: InsertApiKeyBudgetAuditLogParams): Promise<void> {
			await insertApiKeyBudgetAuditLogPg(db, params);
		},

		async getApiKeyBudgetAuditLogsByKeyId(
			apiKeyId: string,
			page: number,
			pageSize: number
		): Promise<{ logs: ApiKeyBudgetAuditLogRow[]; total: number }> {
			const offset = (page - 1) * pageSize;
			const whereEq = eq(pgAuditTable.apiKeyId, apiKeyId);
			const totalRow = await drizzle.select({ total: count() }).from(pgAuditTable).where(whereEq);
			const total = Number(totalRow[0]?.total ?? 0);
			const rows = await drizzle
				.select()
				.from(pgAuditTable)
				.where(whereEq)
				.orderBy(desc(pgAuditTable.createdAt))
				.limit(pageSize)
				.offset(offset);
			return { logs: rows.map((r) => mapPgAuditRow(r)), total };
		},

		async getGlobalApiKeyBudgetAuditLogs(options: {
			page?: number;
			pageSize?: number;
			apiKeyId?: string;
			userEmail?: string;
			eventType?: string;
			actorType?: string;
			startDate?: string;
			endDate?: string;
		}): Promise<{ logs: GlobalApiKeyBudgetAuditLogRow[]; total: number }> {
			const page = options.page || 1;
			const pageSize = Math.min(options.pageSize || 20, 100);
			const offset = (page - 1) * pageSize;
			const conditions = [];
			if (options.apiKeyId) conditions.push(eq(pgAuditTable.apiKeyId, options.apiKeyId));
			if (options.eventType) conditions.push(eq(pgAuditTable.eventType, options.eventType));
			if (options.actorType) conditions.push(eq(pgAuditTable.actorType, options.actorType));
			if (options.startDate) conditions.push(gte(pgAuditTable.createdAt, options.startDate));
			if (options.endDate) conditions.push(lte(pgAuditTable.createdAt, options.endDate));
			if (options.userEmail) conditions.push(eq(pgApiKeysTable.userEmail, options.userEmail));

			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

			let countQ = drizzle.select({ total: count() }).from(pgAuditTable).leftJoin(pgApiKeysTable, eq(pgAuditTable.apiKeyId, pgApiKeysTable.id));
			if (whereExpr) {
				countQ = countQ.where(whereExpr) as typeof countQ;
			}
			const totalRow = await countQ;
			const total = Number(totalRow[0]?.total ?? 0);

			let dataQ = drizzle
				.select({
					id: pgAuditTable.id,
					api_key_id: pgAuditTable.apiKeyId,
					event_type: pgAuditTable.eventType,
					actor_type: pgAuditTable.actorType,
					actor_id: pgAuditTable.actorId,
					reason_code: pgAuditTable.reasonCode,
					reason_text: pgAuditTable.reasonText,
					before_spent: pgAuditTable.beforeSpent,
					delta_spent: pgAuditTable.deltaSpent,
					after_spent: pgAuditTable.afterSpent,
					before_budget_max: pgAuditTable.beforeBudgetMax,
					after_budget_max: pgAuditTable.afterBudgetMax,
					before_budget_base: pgAuditTable.beforeBudgetBase,
					after_budget_base: pgAuditTable.afterBudgetBase,
					before_budget_period: pgAuditTable.beforeBudgetPeriod,
					after_budget_period: pgAuditTable.afterBudgetPeriod,
					before_budget_reset_at: pgAuditTable.beforeBudgetResetAt,
					after_budget_reset_at: pgAuditTable.afterBudgetResetAt,
					request_log_id: pgAuditTable.requestLogId,
					metadata: pgAuditTable.metadata,
					created_at: pgAuditTable.createdAt,
					user_email: pgApiKeysTable.userEmail,
				})
				.from(pgAuditTable)
				.leftJoin(pgApiKeysTable, eq(pgAuditTable.apiKeyId, pgApiKeysTable.id));
			if (whereExpr) {
				dataQ = dataQ.where(whereExpr) as typeof dataQ;
			}
			const pageRows = await dataQ.orderBy(desc(pgAuditTable.createdAt)).limit(pageSize).offset(offset);
			const logs: GlobalApiKeyBudgetAuditLogRow[] = pageRows.map((row) => ({
				id: row.id,
				api_key_id: row.api_key_id,
				event_type: row.event_type as ApiKeyBudgetAuditEventType,
				actor_type: row.actor_type as ApiKeyBudgetAuditActorType,
				actor_id: row.actor_id,
				reason_code: row.reason_code,
				reason_text: row.reason_text,
				before_spent: roundGatewayMoney(Number(row.before_spent)),
				delta_spent: roundGatewayMoney(Number(row.delta_spent)),
				after_spent: roundGatewayMoney(Number(row.after_spent)),
				before_budget_max: row.before_budget_max == null ? null : roundGatewayMoney(Number(row.before_budget_max)),
				after_budget_max: row.after_budget_max == null ? null : roundGatewayMoney(Number(row.after_budget_max)),
				before_budget_base: row.before_budget_base == null ? null : roundGatewayMoney(Number(row.before_budget_base)),
				after_budget_base: row.after_budget_base == null ? null : roundGatewayMoney(Number(row.after_budget_base)),
				before_budget_period: row.before_budget_period,
				after_budget_period: row.after_budget_period,
				before_budget_reset_at: row.before_budget_reset_at,
				after_budget_reset_at: row.after_budget_reset_at,
				request_log_id: row.request_log_id,
				metadata: row.metadata,
				created_at: row.created_at,
				user_email: row.user_email,
			}));
			return { logs, total };
		},
	};
}
