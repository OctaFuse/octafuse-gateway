/**
 * MySQL：`api_key_audit_logs`。
 */
import { roundGatewayMoney } from '../../lib/money-precision';
import { desc, eq } from 'drizzle-orm';
import type {
	ApiKeyBudgetAuditEventType,
	ApiKeyBudgetAuditLogRow,
	ApiKeyBudgetAuditActorType,
	GlobalApiKeyBudgetAuditLogRow,
} from '../../types';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { ApiKeyBudgetAuditLogsRepository } from '../../storage/gateway-repository-interfaces';
import { apiKeyAuditLogsTable as myAuditTable } from '../../storage/drizzle/schema.mysql';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import { asMySqlPool } from './mysql2-compat';

function mapMyAuditRow(r: {
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

export function createMySqlApiKeyBudgetAuditLogsRepository(db: MySqlDatabaseClient): ApiKeyBudgetAuditLogsRepository {
	const drizzle = db.drizzle;
	const pool = asMySqlPool(db.raw);

	return {
		async insertApiKeyBudgetAuditLog(params: InsertApiKeyBudgetAuditLogParams): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(myAuditTable).values({
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
		},

		async getApiKeyBudgetAuditLogsByKeyId(
			apiKeyId: string,
			page: number,
			pageSize: number
		): Promise<{ logs: ApiKeyBudgetAuditLogRow[]; total: number }> {
			const offset = (page - 1) * pageSize;
			const [countRows] = await pool.query<{ total: number }[]>(
				'SELECT COUNT(*) AS total FROM api_key_audit_logs WHERE api_key_id = ?',
				[apiKeyId]
			);
			const rows = await drizzle
				.select()
				.from(myAuditTable)
				.where(eq(myAuditTable.apiKeyId, apiKeyId))
				.orderBy(desc(myAuditTable.createdAt))
				.limit(pageSize)
				.offset(offset);

			return {
				logs: rows.map((r) => mapMyAuditRow(r)),
				total: Number(countRows[0]?.total ?? 0),
			};
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
			const conditions: string[] = [];
			const bindValues: unknown[] = [];

			if (options.apiKeyId) {
				conditions.push('a.api_key_id = ?');
				bindValues.push(options.apiKeyId);
			}
			if (options.userEmail) {
				conditions.push('k.user_email = ?');
				bindValues.push(options.userEmail);
			}
			if (options.eventType) {
				conditions.push('a.event_type = ?');
				bindValues.push(options.eventType);
			}
			if (options.actorType) {
				conditions.push('a.actor_type = ?');
				bindValues.push(options.actorType);
			}
			if (options.startDate) {
				conditions.push('a.created_at >= ?');
				bindValues.push(options.startDate);
			}
			if (options.endDate) {
				conditions.push('a.created_at <= ?');
				bindValues.push(options.endDate);
			}

			const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const baseFrom = `FROM api_key_audit_logs a LEFT JOIN api_keys k ON k.id = a.api_key_id`;

			const [countRows] = await pool.query<{ total: number }[]>(`SELECT COUNT(*) AS total ${baseFrom} ${whereClause}`, bindValues);
			const total = Number(countRows[0]?.total ?? 0);

			const [rows] = await pool.query<
				{
					id: string;
					api_key_id: string;
					event_type: string;
					actor_type: string;
					actor_id: string | null;
					reason_code: string | null;
					reason_text: string | null;
					before_spent: string;
					delta_spent: string;
					after_spent: string;
					before_budget_max: string | null;
					after_budget_max: string | null;
					before_budget_base: string | null;
					after_budget_base: string | null;
					before_budget_period: string | null;
					after_budget_period: string | null;
					before_budget_reset_at: string | null;
					after_budget_reset_at: string | null;
					request_log_id: string | null;
					metadata: string | null;
					created_at: string;
					user_email: string | null;
				}[]
			>(
				`SELECT
					a.id,
					a.api_key_id,
					a.event_type,
					a.actor_type,
					a.actor_id,
					a.reason_code,
					a.reason_text,
					a.before_spent,
					a.delta_spent,
					a.after_spent,
					a.before_budget_max,
					a.after_budget_max,
					a.before_budget_base,
					a.after_budget_base,
					a.before_budget_period,
					a.after_budget_period,
					a.before_budget_reset_at,
					a.after_budget_reset_at,
					a.request_log_id,
					a.metadata,
					a.created_at,
					k.user_email AS user_email
				 ${baseFrom}
				 ${whereClause}
				 ORDER BY a.created_at DESC
				 LIMIT ? OFFSET ?`,
				[...bindValues, pageSize, offset]
			);

			const logs: GlobalApiKeyBudgetAuditLogRow[] = rows.map((row) => ({
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
