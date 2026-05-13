/**
 * D1：`api_key_audit_logs`。
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { ApiKeyBudgetAuditLogRow, GlobalApiKeyBudgetAuditLogRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { ApiKeyBudgetAuditLogsRepository } from '../../storage/gateway-repository-interfaces';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';

export function buildInsertApiKeyBudgetAuditLogStatement(
	db: D1Database,
	params: InsertApiKeyBudgetAuditLogParams
): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO api_key_audit_logs (
        id,
        api_key_id,
        event_type,
        actor_type,
        actor_id,
        reason_code,
        reason_text,
        before_spent,
        delta_spent,
        after_spent,
        before_budget_max,
        after_budget_max,
        before_budget_base,
        after_budget_base,
        before_budget_period,
        after_budget_period,
        before_budget_reset_at,
        after_budget_reset_at,
        request_log_id,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			params.id,
			params.apiKeyId,
			params.eventType,
			params.actorType,
			params.actorId ?? null,
			params.reasonCode ?? null,
			params.reasonText ?? null,
			roundGatewayMoney(params.beforeSpent),
			roundGatewayMoney(params.deltaSpent),
			roundGatewayMoney(params.afterSpent),
			params.beforeBudgetMax != null ? roundGatewayMoney(params.beforeBudgetMax) : null,
			params.afterBudgetMax != null ? roundGatewayMoney(params.afterBudgetMax) : null,
			params.beforeBudgetBase != null ? roundGatewayMoney(params.beforeBudgetBase) : null,
			params.afterBudgetBase != null ? roundGatewayMoney(params.afterBudgetBase) : null,
			params.beforeBudgetPeriod ?? null,
			params.afterBudgetPeriod ?? null,
			params.beforeBudgetResetAt ?? null,
			params.afterBudgetResetAt ?? null,
			params.requestLogId ?? null,
			params.metadata ?? null
		);
}

export function createD1ApiKeyBudgetAuditLogsRepository(db: D1DatabaseClient): ApiKeyBudgetAuditLogsRepository {
	const raw = db.raw;
	return {
		async insertApiKeyBudgetAuditLog(params: InsertApiKeyBudgetAuditLogParams): Promise<void> {
			await buildInsertApiKeyBudgetAuditLogStatement(raw, params).run();
		},

		async getApiKeyBudgetAuditLogsByKeyId(
			apiKeyId: string,
			page: number,
			pageSize: number
		): Promise<{ logs: ApiKeyBudgetAuditLogRow[]; total: number }> {
			const offset = (page - 1) * pageSize;
			const countRow = await raw
				.prepare('SELECT COUNT(*) AS total FROM api_key_audit_logs WHERE api_key_id = ?')
				.bind(apiKeyId)
				.first<{ total: number }>();
			const logsRes = await raw
				.prepare(
					`SELECT *
       FROM api_key_audit_logs
       WHERE api_key_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
				)
				.bind(apiKeyId, pageSize, offset)
				.all<ApiKeyBudgetAuditLogRow>();
			return {
				logs: logsRes.results ?? [],
				total: Number(countRow?.total ?? 0),
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

			const countRow = await raw
				.prepare(`SELECT COUNT(*) AS total ${baseFrom} ${whereClause}`)
				.bind(...bindValues)
				.first<{ total: number }>();
			const total = Number(countRow?.total ?? 0);

			const selectSql = `SELECT
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
    LIMIT ? OFFSET ?`;

			const rows = await raw.prepare(selectSql).bind(...bindValues, pageSize, offset).all<GlobalApiKeyBudgetAuditLogRow>();
			return { logs: rows.results ?? [], total };
		},
	};
}
