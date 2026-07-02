/**
 * D1：`api_key_request_logs` 读路径与插入语句构造。
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { roundGatewayMoney, sqlMoneyRound } from '../../lib/money-precision';
import type { RequestLogRow } from '../../types';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { RequestLogsRepository } from '../../storage/gateway-repository-interfaces';
import type { RequestLogsD1Statements } from './d1-repository-extras';
import type { InsertRequestLogParams } from '../request-logs-types';
import { filterAllowedRequestLogStatuses } from '../request-log-status-filter';

export function buildInsertRequestLogStatement(db: D1Database, params: InsertRequestLogParams): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO api_key_request_logs (id, user_id, api_key_id, user_email, model_id, provider_id, provider_model_name, model_name, provider_name, request_body, upstream_request_body, request_protocol, upstream_protocol, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens, metered_cost, standard_cost, charged_cost, route_group, status, latency_ms, error_message, raw_usage, pricing_audit, provider_key_id, provider_key_label, provider_key_fingerprint, upstream_request_id, upstream_message_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			params.id,
			params.userId,
			params.apiKeyId,
			params.userEmail,
			params.modelId,
			params.providerId,
			params.providerModelName,
			params.modelName,
			params.providerName,
			params.requestBody,
			params.upstreamRequestBody,
			params.requestProtocol,
			params.upstreamProtocol,
			params.inputTokens,
			params.outputTokens,
			params.cacheReadTokens,
			params.cacheWriteTokens,
			params.reasoningTokens,
			params.totalTokens,
			roundGatewayMoney(params.meteredCost),
			roundGatewayMoney(params.standardCost),
			roundGatewayMoney(params.chargedCost),
			params.routeGroup,
			params.status,
			params.latencyMs,
			params.errorMessage,
			params.rawUsage,
			params.pricingAudit ?? null,
			params.providerKeyId ?? null,
			params.providerKeyLabel ?? null,
			params.providerKeyFingerprint ?? null,
			params.upstreamRequestId ?? null,
			params.upstreamMessageId ?? null
		);
}

export function createD1RequestLogsRepository(db: D1DatabaseClient): RequestLogsRepository & RequestLogsD1Statements {
	const raw = db.raw;
	return {
		buildInsertRequestLogStatement,

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
				const countWhere = `api_key_id = ? AND status IN (${placeholders})`;
				const countBind = raw
					.prepare(`SELECT COUNT(*) as total FROM api_key_request_logs WHERE ${countWhere}`)
					.bind(apiKeyId, ...include);
				const countRow = await countBind.first<{ total: number }>();
				const total = countRow?.total ?? 0;

				const selectBind = raw
					.prepare(
						`SELECT * FROM api_key_request_logs WHERE ${countWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`
					)
					.bind(apiKeyId, ...include, pageSize, offset);
				const rows = await selectBind.all<RequestLogRow>();
				return { logs: rows.results ?? [], total };
			}

			const excludeStatus = filter?.excludeStatus;
			const countWhere = excludeStatus
				? 'api_key_id = ? AND (status IS NULL OR status != ?)'
				: 'api_key_id = ?';
			const countBind = excludeStatus
				? raw.prepare(`SELECT COUNT(*) as total FROM api_key_request_logs WHERE ${countWhere}`).bind(apiKeyId, excludeStatus)
				: raw.prepare(`SELECT COUNT(*) as total FROM api_key_request_logs WHERE ${countWhere}`).bind(apiKeyId);
			const countRow = await countBind.first<{ total: number }>();
			const total = countRow?.total ?? 0;

			const selectWhere = excludeStatus
				? 'api_key_id = ? AND (status IS NULL OR status != ?)'
				: 'api_key_id = ?';
			const selectBind = excludeStatus
				? raw
						.prepare(`SELECT * FROM api_key_request_logs WHERE ${selectWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
						.bind(apiKeyId, excludeStatus, pageSize, offset)
				: raw
						.prepare(`SELECT * FROM api_key_request_logs WHERE ${selectWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
						.bind(apiKeyId, pageSize, offset);
			const rows = await selectBind.all<RequestLogRow>();
			return { logs: rows.results ?? [], total };
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
			const conditionsRl: string[] = [];
			const bindValues: unknown[] = [];

			if (options.apiKeyId) {
				conditions.push('api_key_id = ?');
				conditionsRl.push('rl.api_key_id = ?');
				bindValues.push(options.apiKeyId);
			}
			if (options.userId) {
				conditions.push('user_id = ?');
				conditionsRl.push('rl.user_id = ?');
				bindValues.push(options.userId);
			}
			if (options.userEmail) {
				conditions.push('user_email = ?');
				conditionsRl.push('rl.user_email = ?');
				bindValues.push(options.userEmail);
			}
			if (options.modelId) {
				conditions.push('model_id = ?');
				conditionsRl.push('rl.model_id = ?');
				bindValues.push(options.modelId);
			}
			if (options.providerId) {
				conditions.push('provider_id = ?');
				conditionsRl.push('rl.provider_id = ?');
				bindValues.push(options.providerId);
			}
			if (options.routeGroup) {
				conditions.push('route_group = ?');
				conditionsRl.push('rl.route_group = ?');
				bindValues.push(options.routeGroup);
			}
			if (options.protocol) {
				conditions.push("COALESCE(NULLIF(request_protocol, ''), upstream_protocol) = ?");
				conditionsRl.push("COALESCE(NULLIF(rl.request_protocol, ''), rl.upstream_protocol) = ?");
				bindValues.push(options.protocol);
			}
			if (options.status) {
				conditions.push('status = ?');
				conditionsRl.push('rl.status = ?');
				bindValues.push(options.status);
			}
			if (options.startDate) {
				conditions.push('created_at >= ?');
				conditionsRl.push('rl.created_at >= ?');
				bindValues.push(options.startDate);
			}
			if (options.endDate) {
				conditions.push('created_at <= ?');
				conditionsRl.push('rl.created_at <= ?');
				bindValues.push(options.endDate);
			}

			const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const whereClauseRl = conditionsRl.length > 0 ? `WHERE ${conditionsRl.join(' AND ')}` : '';

			const countRow = await raw
				.prepare(`SELECT COUNT(*) as total FROM api_key_request_logs ${whereClause}`)
				.bind(...bindValues)
				.first<{ total: number }>();
			const total = Number(countRow?.total ?? 0);

			const rows = await raw
				.prepare(`SELECT * FROM api_key_request_logs rl ${whereClauseRl} ORDER BY rl.created_at DESC LIMIT ? OFFSET ?`)
				.bind(...bindValues, pageSize, offset)
				.all<RequestLogRow>();
			return { logs: rows.results ?? [], total };
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
			const row = await raw
				.prepare(
					`SELECT
				COUNT(*) as total_requests,
				SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
				SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
				COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) as charged_cost,
				COALESCE(${sqlMoneyRound('SUM(metered_cost)')}, 0) as metered_cost,
				COALESCE(${sqlMoneyRound('SUM(standard_cost)')}, 0) as standard_cost
			 FROM api_key_request_logs WHERE created_at >= ? AND created_at ${comparator} ?`
				)
				.bind(options.startDate, options.endDate)
				.first<{
					total_requests: number;
					success_count: number;
					error_count: number;
					charged_cost: number;
					metered_cost: number;
					standard_cost: number;
				}>();

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
			const rows = await raw
				.prepare('SELECT * FROM api_key_request_logs ORDER BY created_at DESC LIMIT ?')
				.bind(limit)
				.all<RequestLogRow>();
			return rows.results ?? [];
		},

		async getRecentErrors(limit: number): Promise<RequestLogRow[]> {
			const rows = await raw
				.prepare(`SELECT * FROM api_key_request_logs WHERE status = 'error' ORDER BY created_at DESC LIMIT ?`)
				.bind(limit)
				.all<RequestLogRow>();
			return rows.results ?? [];
		},

		async getDistinctActiveUsersCount(options: { startDate: string; endDate: string; endExclusive?: boolean }): Promise<number> {
			const comparator = options.endExclusive ? '<' : '<=';
			const row = await raw
				.prepare(
					`SELECT
				COUNT(DISTINCT CASE WHEN user_email IS NOT NULL AND user_email != '' THEN user_email END) as active_users
			 FROM api_key_request_logs WHERE created_at >= ? AND created_at ${comparator} ?`
				)
				.bind(options.startDate, options.endDate)
				.first<{ active_users: number }>();
			return Number(row?.active_users ?? 0);
		},
	};
}
