/**
 * MySQL：`api_key_request_logs` 读查询。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { sqlMoneyRound } from '../../lib/money-precision';
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
		}): Promise<{
			totalRequests: number;
			errorCount: number;
			successCount: number;
			chargedCost: number;
			meteredCost: number;
			standardCost: number;
		}> {
			const comparator = options.endExclusive ? '<' : '<=';
			const [rows] = await pool.query<
				(RowDataPacket & {
					total_requests?: string | number;
					success_count?: string | number;
					error_count?: string | number;
					charged_cost?: string | number;
					metered_cost?: string | number;
					standard_cost?: string | number;
				})[]
			>(
				`SELECT
					COUNT(*) AS total_requests,
					SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
					SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
					COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) AS charged_cost,
					COALESCE(${sqlMoneyRound('SUM(metered_cost)')}, 0) AS metered_cost,
					COALESCE(${sqlMoneyRound('SUM(standard_cost)')}, 0) AS standard_cost
				 FROM api_key_request_logs WHERE created_at >= ? AND created_at ${comparator} ?`,
				[options.startDate, options.endDate]
			);
			const row = rows[0];
			return {
				totalRequests: Number(row?.total_requests ?? 0),
				successCount: Number(row?.success_count ?? 0),
				errorCount: Number(row?.error_count ?? 0),
				chargedCost: Number(row?.charged_cost ?? 0),
				meteredCost: Number(row?.metered_cost ?? 0),
				standardCost: Number(row?.standard_cost ?? 0),
			};
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
