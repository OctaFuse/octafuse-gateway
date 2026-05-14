/**
 * D1：`user_audit_logs`。
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { GlobalUserAuditLogRow, UserAuditLogRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { UserAuditLogsRepository } from '../../storage/gateway-repository-interfaces';
import type { InsertUserAuditLogParams } from '../user-audit-logs-types';

type AuditSqlRow = {
	id: string;
	user_id: string;
	api_key_id: string | null;
	event_type: string;
	actor_type: string;
	before_spent: number;
	delta_spent: number;
	after_spent: number;
	before_budget_max: number | null;
	after_budget_max: number | null;
	request_log_id: string | null;
	metadata: string | null;
	before_user_snapshot: string | null;
	after_user_snapshot: string | null;
	changed_fields: string | null;
	correlation_id: string | null;
	source: string | null;
	actor_id: string | null;
	reason_code: string | null;
	reason_text: string | null;
	created_at: string;
};

function mapAuditRow(r: AuditSqlRow): UserAuditLogRow {
	return {
		id: r.id,
		user_id: r.user_id,
		api_key_id: r.api_key_id,
		event_type: r.event_type,
		actor_type: r.actor_type,
		before_spent: roundGatewayMoney(Number(r.before_spent)),
		delta_spent: roundGatewayMoney(Number(r.delta_spent)),
		after_spent: roundGatewayMoney(Number(r.after_spent)),
		before_budget_max: r.before_budget_max == null ? null : roundGatewayMoney(Number(r.before_budget_max)),
		after_budget_max: r.after_budget_max == null ? null : roundGatewayMoney(Number(r.after_budget_max)),
		request_log_id: r.request_log_id,
		metadata: r.metadata,
		before_user_snapshot: r.before_user_snapshot ?? null,
		after_user_snapshot: r.after_user_snapshot ?? null,
		changed_fields: r.changed_fields ?? null,
		correlation_id: r.correlation_id ?? null,
		source: r.source ?? null,
		actor_id: r.actor_id ?? null,
		reason_code: r.reason_code ?? null,
		reason_text: r.reason_text ?? null,
		created_at: r.created_at,
	};
}

export function buildInsertUserAuditLogStatement(db: D1Database, params: InsertUserAuditLogParams): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO user_audit_logs (
        id, user_id, api_key_id, event_type, actor_type,
        before_spent, delta_spent, after_spent,
        before_budget_max, after_budget_max,
        request_log_id, metadata,
        before_user_snapshot, after_user_snapshot, changed_fields,
        correlation_id, source, actor_id, reason_code, reason_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			params.id,
			params.userId,
			params.apiKeyId ?? null,
			params.eventType,
			params.actorType,
			roundGatewayMoney(params.beforeSpent),
			roundGatewayMoney(params.deltaSpent),
			roundGatewayMoney(params.afterSpent),
			params.beforeBudgetMax != null ? roundGatewayMoney(params.beforeBudgetMax) : null,
			params.afterBudgetMax != null ? roundGatewayMoney(params.afterBudgetMax) : null,
			params.requestLogId ?? null,
			params.metadata ?? null,
			params.beforeUserSnapshot ?? null,
			params.afterUserSnapshot ?? null,
			params.changedFields ?? null,
			params.correlationId ?? null,
			params.source ?? null,
			params.actorId ?? null,
			params.reasonCode ?? null,
			params.reasonText ?? null
		);
}

const auditRowColumnsNoAlias = `id,
      user_id,
      api_key_id,
      event_type,
      actor_type,
      before_spent,
      delta_spent,
      after_spent,
      before_budget_max,
      after_budget_max,
      request_log_id,
      metadata,
      before_user_snapshot,
      after_user_snapshot,
      changed_fields,
      correlation_id,
      source,
      actor_id,
      reason_code,
      reason_text,
      created_at`;

const auditRowColumnsAliased = `a.id,
      a.user_id,
      a.api_key_id,
      a.event_type,
      a.actor_type,
      a.before_spent,
      a.delta_spent,
      a.after_spent,
      a.before_budget_max,
      a.after_budget_max,
      a.request_log_id,
      a.metadata,
      a.before_user_snapshot,
      a.after_user_snapshot,
      a.changed_fields,
      a.correlation_id,
      a.source,
      a.actor_id,
      a.reason_code,
      a.reason_text,
      a.created_at`;

export function createD1UserAuditLogsRepository(db: D1DatabaseClient): UserAuditLogsRepository {
	const raw = db.raw;
	return {
		async insertUserAuditLog(params: InsertUserAuditLogParams): Promise<void> {
			await buildInsertUserAuditLogStatement(raw, params).run();
		},

		async getUserAuditLogsByUserId(
			userId: string,
			page: number,
			pageSize: number
		): Promise<{ logs: UserAuditLogRow[]; total: number }> {
			const offset = (page - 1) * pageSize;
			const countRow = await raw
				.prepare('SELECT COUNT(*) AS total FROM user_audit_logs WHERE user_id = ?')
				.bind(userId)
				.first<{ total: number }>();
			const logsRes = await raw
				.prepare(
					`SELECT ${auditRowColumnsNoAlias} FROM user_audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
				)
				.bind(userId, pageSize, offset)
				.all<AuditSqlRow>();
			return {
				logs: (logsRes.results ?? []).map(mapAuditRow),
				total: Number(countRow?.total ?? 0),
			};
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
			const conditions: string[] = [];
			const bindValues: unknown[] = [];
			if (options.userId) {
				conditions.push('a.user_id = ?');
				bindValues.push(options.userId);
			}
			if (options.apiKeyId) {
				conditions.push('a.api_key_id = ?');
				bindValues.push(options.apiKeyId);
			}
			if (options.userEmail) {
				conditions.push('u.email = ?');
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
			if (options.reasonCode) {
				conditions.push('a.reason_code = ?');
				bindValues.push(options.reasonCode);
			}
			if (options.source) {
				conditions.push('a.source = ?');
				bindValues.push(options.source);
			}
			if (options.correlationId) {
				conditions.push('a.correlation_id = ?');
				bindValues.push(options.correlationId);
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
			const baseFrom = `FROM user_audit_logs a LEFT JOIN users u ON u.id = a.user_id`;
			const countRow = await raw
				.prepare(`SELECT COUNT(*) AS total ${baseFrom} ${whereClause}`)
				.bind(...bindValues)
				.first<{ total: number }>();
			const total = Number(countRow?.total ?? 0);
			const selectSql = `SELECT
      ${auditRowColumnsAliased},
      u.email AS user_email
    ${baseFrom}
    ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?`;
			const rows = await raw.prepare(selectSql).bind(...bindValues, pageSize, offset).all<AuditSqlRow & { user_email: string | null }>();
			return {
				logs: (rows.results ?? []).map((r) => ({ ...mapAuditRow(r), user_email: r.user_email })),
				total,
			};
		},
	};
}
