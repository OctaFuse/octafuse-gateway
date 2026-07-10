/**
 * D1：`user_audit_logs`。
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { GlobalUserAuditLogRow, UserAuditLogRow } from '../../types';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { UserAuditLogsRepository } from '../../storage/gateway-repository-interfaces';
import type { InsertUserAuditLogParams } from '../user-audit-logs-types';
import { assertAndFinalizeUserAuditInsert } from '../user-audit-catalog';
import { deriveUserAuditBudgetFromSnapshots } from '../user-audit-log-derived';

type AuditSqlRow = {
	id: string;
	user_id: string | null;
	api_key_id: string | null;
	event_type: string;
	actor_type: string;
	request_log_id: string | null;
	change_payload: string | null;
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
	const derived = deriveUserAuditBudgetFromSnapshots(r.before_user_snapshot, r.after_user_snapshot);
	return {
		id: r.id,
		user_id: r.user_id,
		api_key_id: r.api_key_id,
		event_type: r.event_type,
		actor_type: r.actor_type,
		before_spent: derived.before_spent,
		delta_spent: derived.delta_spent,
		after_spent: derived.after_spent,
		before_budget_max: derived.before_budget_max,
		after_budget_max: derived.after_budget_max,
		before_budget_base: derived.before_budget_base,
		after_budget_base: derived.after_budget_base,
		request_log_id: r.request_log_id,
		change_payload: r.change_payload,
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
	const p = assertAndFinalizeUserAuditInsert(params);
	return db
		.prepare(
			`INSERT INTO user_audit_logs (
        id, user_id, api_key_id, event_type, actor_type,
        request_log_id, change_payload,
        before_user_snapshot, after_user_snapshot, changed_fields,
        correlation_id, source, actor_id, reason_code, reason_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			p.id,
			p.userId,
			p.apiKeyId ?? null,
			p.eventType,
			p.actorType,
			p.requestLogId ?? null,
			p.changePayload ?? null,
			p.beforeUserSnapshot ?? null,
			p.afterUserSnapshot ?? null,
			p.changedFields ?? null,
			p.correlationId ?? null,
			p.source ?? null,
			p.actorId ?? null,
			p.reasonCode ?? null,
			p.reasonText ?? null
		);
}

const auditRowColumnsNoAlias = `id,
      user_id,
      api_key_id,
      event_type,
      actor_type,
      request_log_id,
      change_payload,
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
      a.request_log_id,
      a.change_payload,
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
			eventTypes?: string[];
			actorTypes?: string[];
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
			if (options.eventTypes && options.eventTypes.length > 0) {
				conditions.push(`a.event_type IN (${options.eventTypes.map(() => '?').join(', ')})`);
				bindValues.push(...options.eventTypes);
			}
			if (options.actorTypes && options.actorTypes.length > 0) {
				conditions.push(`a.actor_type IN (${options.actorTypes.map(() => '?').join(', ')})`);
				bindValues.push(...options.actorTypes);
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
