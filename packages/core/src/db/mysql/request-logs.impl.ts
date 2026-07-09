/**
 * MySQL：`api_key_request_logs` 读查询。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { sqlMoneyRound } from '../../lib/money-precision';
import {
	mapRequestStatsByRangeRow,
	mapRequestTimeseriesRows,
	mapThroughputSnapshot,
	mapUserTokenTimeseriesRows,
	REQUEST_STATS_SELECT_SQL,
	REQUEST_TIMESERIES_SELECT_SQL,
} from '../../lib/dashboard-request-stats';
import type { RequestLogRow } from '../../types';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { RequestLogsRepository } from '../../storage/gateway-repository-interfaces';
import { asMySqlPool } from './mysql2-compat';
import { filterAllowedRequestLogStatuses } from '../request-log-status-filter';

export function createMySqlRequestLogsRepository(db: MySqlDatabaseClient): RequestLogsRepository {
	const pool = asMySqlPool(db.raw);
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
				const placeholders = include.map(() => '?').join(', ');
				const [countRows] = await pool.query<(RowDataPacket & { total: string | number })[]>(
					`SELECT COUNT(*) AS total FROM api_key_request_logs
					 WHERE api_key_id = ? AND status IN (${placeholders})`,
					[apiKeyId, ...include]
				);
				const [rows] = await pool.query<RequestLogRow[]>(
					`SELECT * FROM api_key_request_logs
					 WHERE api_key_id = ? AND status IN (${placeholders})
					 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
					[apiKeyId, ...include, pageSize, offset]
				);
				return {
					logs: rows,
					total: Number(countRows[0]?.total ?? 0),
				};
			}

			const excludeStatus = filter?.excludeStatus;
			if (excludeStatus) {
				const [countRows] = await pool.query<(RowDataPacket & { total: string | number })[]>(
					`SELECT COUNT(*) AS total FROM api_key_request_logs
					 WHERE api_key_id = ? AND (status IS NULL OR status <> ?)`,
					[apiKeyId, excludeStatus]
				);
				const [rows] = await pool.query<RequestLogRow[]>(
					`SELECT * FROM api_key_request_logs
					 WHERE api_key_id = ? AND (status IS NULL OR status <> ?)
					 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
					[apiKeyId, excludeStatus, pageSize, offset]
				);
				return {
					logs: rows,
					total: Number(countRows[0]?.total ?? 0),
				};
			}

			const [countRows] = await pool.query<(RowDataPacket & { total: string | number })[]>(
				'SELECT COUNT(*) AS total FROM api_key_request_logs WHERE api_key_id = ?',
				[apiKeyId]
			);
			const [rows] = await pool.query<RequestLogRow[]>(
				'SELECT * FROM api_key_request_logs WHERE api_key_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
				[apiKeyId, pageSize, offset]
			);
			return {
				logs: rows,
				total: Number(countRows[0]?.total ?? 0),
			};
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
			const [countRows] = await pool.query<(RowDataPacket & { total: string | number })[]>(
				`SELECT COUNT(*) AS total FROM api_key_request_logs ${whereClause}`,
				bindValues
			);
			const [rows] = await pool.query<RequestLogRow[]>(
				`SELECT * FROM api_key_request_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
				[...bindValues, pageSize, offset]
			);
			return {
				logs: rows,
				total: Number(countRows[0]?.total ?? 0),
			};
		},

		async getRequestStatsByRange(options: {
			startDate: string;
			endDate: string;
			endExclusive?: boolean;
		}) {
			const comparator = options.endExclusive ? '<' : '<=';
			const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
				`SELECT
					${REQUEST_STATS_SELECT_SQL},
					COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) AS charged_cost,
					COALESCE(${sqlMoneyRound('SUM(metered_cost)')}, 0) AS metered_cost,
					COALESCE(${sqlMoneyRound('SUM(standard_cost)')}, 0) AS standard_cost
				 FROM api_key_request_logs WHERE created_at >= ? AND created_at ${comparator} ?`,
				[options.startDate, options.endDate]
			);
			return mapRequestStatsByRangeRow(rows[0] as Parameters<typeof mapRequestStatsByRangeRow>[0]);
		},

		async queryRequestTimeseries(options: {
			startDate: string;
			endDate: string;
			granularity: 'hour' | 'day';
		}) {
			const bucketExpr =
				options.granularity === 'hour'
					? "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')"
					: "DATE_FORMAT(created_at, '%Y-%m-%d')";
			const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
				`SELECT
					${bucketExpr} AS bucket,
					${REQUEST_TIMESERIES_SELECT_SQL},
					COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) AS charged_cost
				 FROM api_key_request_logs
				 WHERE created_at >= ? AND created_at <= ?
				 GROUP BY bucket
				 ORDER BY bucket ASC`,
				[options.startDate, options.endDate]
			);
			return mapRequestTimeseriesRows(rows as Parameters<typeof mapRequestTimeseriesRows>[0]);
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
					? "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')"
					: "DATE_FORMAT(created_at, '%Y-%m-%d')";
			const placeholders = options.userEmails.map(() => '?').join(', ');
			const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
				`SELECT
					${bucketExpr} AS bucket,
					user_email,
					COALESCE(SUM(total_tokens), 0) AS total_tokens
				 FROM api_key_request_logs
				 WHERE created_at >= ? AND created_at <= ?
				   AND user_email IN (${placeholders})
				 GROUP BY bucket, user_email
				 ORDER BY bucket ASC`,
				[options.startDate, options.endDate, ...options.userEmails]
			);
			return mapUserTokenTimeseriesRows(rows as Parameters<typeof mapUserTokenTimeseriesRows>[0]);
		},

		async getThroughputLastMinute() {
			const end = new Date();
			const start = new Date(end.getTime() - 60 * 1000);
			const startDate = start.toISOString().slice(0, 19).replace('T', ' ');
			const endDate = end.toISOString().slice(0, 19).replace('T', ' ');
			const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
				`SELECT
					COUNT(*) AS request_count,
					COALESCE(SUM(total_tokens), 0) AS total_tokens
				 FROM api_key_request_logs
				 WHERE created_at >= ? AND created_at <= ?`,
				[startDate, endDate]
			);
			return mapThroughputSnapshot(rows[0] as Parameters<typeof mapThroughputSnapshot>[0]);
		},

		async getRecentLogs(limit: number): Promise<RequestLogRow[]> {
			const [rows] = await pool.query<RequestLogRow[]>('SELECT * FROM api_key_request_logs ORDER BY created_at DESC LIMIT ?', [limit]);
			return rows;
		},

		async getRecentErrors(limit: number): Promise<RequestLogRow[]> {
			const [rows] = await pool.query<RequestLogRow[]>(
				`SELECT * FROM api_key_request_logs WHERE status = 'error' ORDER BY created_at DESC LIMIT ?`,
				[limit]
			);
			return rows;
		},

		async getDistinctActiveUsersCount(options: { startDate: string; endDate: string; endExclusive?: boolean }): Promise<number> {
			const comparator = options.endExclusive ? '<' : '<=';
			const [rows] = await pool.query<(RowDataPacket & { active_users?: string | number })[]>(
				`SELECT
					COUNT(DISTINCT CASE WHEN user_email IS NOT NULL AND user_email != '' THEN user_email END) AS active_users
				 FROM api_key_request_logs WHERE created_at >= ? AND created_at ${comparator} ?`,
				[options.startDate, options.endDate]
			);
			return Number(rows[0]?.active_users ?? 0);
		},
	};
}
