/**
 * Postgres：`api_key_request_logs`（postgres.js + unsafe）。
 */
import { sqlMoneyRound } from '../../lib/money-precision';
import {
	mapRequestStatsByRangeRow,
	mapRequestTimeseriesRows,
	mapThroughputSnapshot,
	mapUserTokenTimeseriesRows,
} from '../../lib/dashboard-request-stats';
import type { RequestLogRow } from '../../types';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { RequestLogsRepository } from '../../storage/gateway-repository-interfaces';
import { sqlitePlaceholdersToPg } from '../shared/sql-placeholders';
import { filterAllowedRequestLogStatuses } from '../request-log-status-filter';

export function createPostgresRequestLogsRepository(db: PostgresDatabaseClient): RequestLogsRepository {
	const pg = db.raw;
	return {
		async getRequestLogsByKeyId(
			apiKeyId: string,
			page: number,
			pageSize: number,
			filter?: { excludeStatus?: string; includeStatuses?: string[] }
		): Promise<{ logs: RequestLogRow[]; total: number }> {
			const offset = (page - 1) * pageSize;
			const include = filterAllowedRequestLogStatuses(filter?.includeStatuses);
			if (include.length > 0) {
				const countRows = await pg<{ total: string | number }[]>`
			SELECT COUNT(*)::bigint AS total FROM api_key_request_logs
			WHERE api_key_id = ${apiKeyId} AND status IN ${pg(include)}
		`;
				const total = Number(countRows[0]?.total ?? 0);
				const logs = await pg<RequestLogRow[]>`
			SELECT * FROM api_key_request_logs
			WHERE api_key_id = ${apiKeyId} AND status IN ${pg(include)}
			ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
		`;
				return { logs, total };
			}
			const excludeStatus = filter?.excludeStatus;
			if (excludeStatus) {
				const countRows = await pg<{ total: string | number }[]>`
			SELECT COUNT(*)::bigint AS total FROM api_key_request_logs
			WHERE api_key_id = ${apiKeyId} AND (status IS NULL OR status <> ${excludeStatus})
		`;
				const total = Number(countRows[0]?.total ?? 0);
				const logs = await pg<RequestLogRow[]>`
			SELECT * FROM api_key_request_logs
			WHERE api_key_id = ${apiKeyId} AND (status IS NULL OR status <> ${excludeStatus})
			ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
		`;
				return { logs, total };
			}
			const countRows = await pg<{ total: string | number }[]>`
		SELECT COUNT(*)::bigint AS total FROM api_key_request_logs WHERE api_key_id = ${apiKeyId}
	`;
			const total = Number(countRows[0]?.total ?? 0);
			const logs = await pg<RequestLogRow[]>`
		SELECT * FROM api_key_request_logs WHERE api_key_id = ${apiKeyId}
		ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
	`;
			return { logs, total };
		},

		async getRequestLogs(options: {
			page?: number;
			pageSize?: number;
			apiKeyId?: string;
			userId?: string;
			userEmail?: string;
			modelId?: string;
			providerId?: string;
			routeGroup?: string;
			protocol?: string;
			status?: string;
			startDate?: string;
			endDate?: string;
		}): Promise<{ logs: RequestLogRow[]; total: number }> {
			const page = options.page || 1;
			const pageSize = Math.min(options.pageSize || 20, 100);
			const offset = (page - 1) * pageSize;
			const conditions: string[] = [];
			const bindValues: unknown[] = [];

			if (options.apiKeyId) {
				conditions.push('api_key_id = ?');
				bindValues.push(options.apiKeyId);
			}
			if (options.userId) {
				conditions.push('user_id = ?');
				bindValues.push(options.userId);
			}
			if (options.userEmail) {
				conditions.push('user_email = ?');
				bindValues.push(options.userEmail);
			}
			if (options.modelId) {
				conditions.push('model_id = ?');
				bindValues.push(options.modelId);
			}
			if (options.providerId) {
				conditions.push('provider_id = ?');
				bindValues.push(options.providerId);
			}
			if (options.routeGroup) {
				conditions.push('route_group = ?');
				bindValues.push(options.routeGroup);
			}
			if (options.protocol) {
				conditions.push("COALESCE(NULLIF(request_protocol, ''), upstream_protocol) = ?");
				bindValues.push(options.protocol);
			}
			if (options.status) {
				conditions.push('status = ?');
				bindValues.push(options.status);
			}
			if (options.startDate) {
				conditions.push('created_at >= ?');
				bindValues.push(options.startDate);
			}
			if (options.endDate) {
				conditions.push('created_at <= ?');
				bindValues.push(options.endDate);
			}

			const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

			const countSql = sqlitePlaceholdersToPg(`SELECT COUNT(*) as total FROM api_key_request_logs ${whereClause}`);
			const countRows = (await pg.unsafe(
				countSql,
				bindValues as Parameters<typeof pg.unsafe>[1]
			)) as { total: string | number }[];
			const total = Number(countRows[0]?.total ?? 0);

			const selectSql = sqlitePlaceholdersToPg(
				`SELECT * FROM api_key_request_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
			);
			const dataRows = (await pg.unsafe(
				selectSql,
				[...bindValues, pageSize, offset] as Parameters<typeof pg.unsafe>[1]
			)) as RequestLogRow[];
			return { logs: dataRows, total };
		},

		async getRequestStatsByRange(options: {
			startDate: string;
			endDate: string;
			endExclusive?: boolean;
		}) {
			const comparator = options.endExclusive ? '<' : '<=';
			const q = `SELECT
				COUNT(*)::bigint as total_requests,
				SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::bigint as success_count,
				SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::bigint as error_count,
				COALESCE(SUM(input_tokens), 0)::bigint as input_tokens,
				COALESCE(SUM(output_tokens), 0)::bigint as output_tokens,
				COALESCE(SUM(cache_read_tokens), 0)::bigint as cache_read_tokens,
				COALESCE(SUM(cache_write_tokens), 0)::bigint as cache_write_tokens,
				COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
				AVG(latency_ms) as avg_latency_ms,
				COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) as charged_cost,
				COALESCE(${sqlMoneyRound('SUM(metered_cost)')}, 0) as metered_cost,
				COALESCE(${sqlMoneyRound('SUM(standard_cost)')}, 0) as standard_cost
			 FROM api_key_request_logs WHERE created_at >= $1 AND created_at ${comparator} $2`;
			const rows = (await pg.unsafe(q, [options.startDate, options.endDate])) as Record<string, unknown>[];
			return mapRequestStatsByRangeRow(rows[0]);
		},

		async queryRequestTimeseries(options: {
			startDate: string;
			endDate: string;
			granularity: 'hour' | 'day';
		}) {
			const bucketExpr =
				options.granularity === 'hour'
					? "to_char(date_trunc('hour', created_at::timestamp), 'YYYY-MM-DD HH24:MI:SS')"
					: "to_char(date_trunc('day', created_at::timestamp), 'YYYY-MM-DD')";
			const q = `SELECT
				${bucketExpr} as bucket,
				COUNT(*)::bigint as request_count,
				COALESCE(SUM(input_tokens), 0)::bigint as input_tokens,
				COALESCE(SUM(output_tokens), 0)::bigint as output_tokens,
				COALESCE(SUM(cache_read_tokens), 0)::bigint as cache_read_tokens,
				COALESCE(SUM(cache_write_tokens), 0)::bigint as cache_write_tokens,
				COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
				AVG(latency_ms) as avg_latency_ms,
				COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) as charged_cost
			 FROM api_key_request_logs
			 WHERE created_at >= $1 AND created_at <= $2
			 GROUP BY 1
			 ORDER BY 1 ASC`;
			const rows = (await pg.unsafe(q, [options.startDate, options.endDate])) as Record<string, unknown>[];
			return mapRequestTimeseriesRows(rows);
		},

		async queryUserTokenTimeseries(options: {
			startDate: string;
			endDate: string;
			granularity: 'hour' | 'day';
			userEmails: string[];
		}) {
			if (options.userEmails.length === 0) return [];
			const bucketExpr =
				options.granularity === 'hour'
					? "to_char(date_trunc('hour', created_at::timestamp), 'YYYY-MM-DD HH24:MI:SS')"
					: "to_char(date_trunc('day', created_at::timestamp), 'YYYY-MM-DD')";
			const emailParams = options.userEmails.map((_, i) => `$${i + 3}`).join(', ');
			const q = `SELECT
				${bucketExpr} as bucket,
				user_email,
				COALESCE(SUM(total_tokens), 0)::bigint as total_tokens
			 FROM api_key_request_logs
			 WHERE created_at >= $1 AND created_at <= $2
			   AND user_email IN (${emailParams})
			 GROUP BY 1, user_email
			 ORDER BY 1 ASC`;
			const rows = (await pg.unsafe(q, [options.startDate, options.endDate, ...options.userEmails])) as Record<string, unknown>[];
			return mapUserTokenTimeseriesRows(rows);
		},

		async getThroughputLastMinute() {
			const end = new Date();
			const start = new Date(end.getTime() - 60 * 1000);
			const startDate = start.toISOString().slice(0, 19).replace('T', ' ');
			const endDate = end.toISOString().slice(0, 19).replace('T', ' ');
			const q = `SELECT
				COUNT(*)::bigint as request_count,
				COALESCE(SUM(total_tokens), 0)::bigint as total_tokens
			 FROM api_key_request_logs
			 WHERE created_at >= $1 AND created_at <= $2`;
			const rows = (await pg.unsafe(q, [startDate, endDate])) as Record<string, unknown>[];
			return mapThroughputSnapshot(rows[0]);
		},

		async getRecentLogs(limit: number): Promise<RequestLogRow[]> {
			return (await pg.unsafe('SELECT * FROM api_key_request_logs ORDER BY created_at DESC LIMIT $1', [limit])) as RequestLogRow[];
		},

		async getRecentErrors(limit: number): Promise<RequestLogRow[]> {
			return (await pg.unsafe(
				`SELECT * FROM api_key_request_logs WHERE status = 'error' ORDER BY created_at DESC LIMIT $1`,
				[limit]
			)) as RequestLogRow[];
		},

		async getDistinctActiveUsersCount(options: { startDate: string; endDate: string; endExclusive?: boolean }): Promise<number> {
			const comparator = options.endExclusive ? '<' : '<=';
			const q = `SELECT
				COUNT(DISTINCT CASE WHEN user_email IS NOT NULL AND user_email != '' THEN user_email END)::bigint as active_users
			 FROM api_key_request_logs WHERE created_at >= $1 AND created_at ${comparator} $2`;
			const rows = (await pg.unsafe(q, [options.startDate, options.endDate])) as { active_users?: string | number }[];
			return Number(rows[0]?.active_users ?? 0);
		},
	};
}
