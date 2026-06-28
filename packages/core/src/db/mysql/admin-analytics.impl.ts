/**
 * MySQL：管理后台分析聚合查询。
 */
import { sqlMoneyRound } from '../../lib/money-precision';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { AdminAnalyticsRepository } from '../../storage/gateway-repository-interfaces';
import type {
	ModelAnalyticsRow,
	ModelProviderReliabilityRow,
	ProviderAnalyticsRow,
	ProviderReliabilityRow,
	UserAnalyticsRow,
} from '../../storage/repository-dtos';
import { asMySqlPool } from './mysql2-compat';

export function createMySqlAdminAnalyticsRepository(db: MySqlDatabaseClient): AdminAnalyticsRepository {
	const pool = asMySqlPool(db.raw);
	return {
		async queryModelAnalytics(options: { start: string; end: string; tag?: string; providerId?: string }): Promise<ModelAnalyticsRow[]> {
			const joins: string[] = [];
			const conditions: string[] = ['rl.created_at >= ?', 'rl.created_at <= ?', 'rl.model_id IS NOT NULL'];
			const bindValues: unknown[] = [];
			if (options.tag) {
				joins.push('INNER JOIN model_tags mt ON mt.model_id = rl.model_id AND mt.tag = ?');
				bindValues.push(options.tag);
			}
			bindValues.push(options.start, options.end);
			if (options.providerId) {
				conditions.push('rl.provider_id = ?');
				bindValues.push(options.providerId);
			}
			const [rows] = await pool.query<ModelAnalyticsRow[]>(
				`SELECT
					rl.model_id as model_id,
					rl.route_group as route_group,
					COUNT(*) as request_count,
					COALESCE(${sqlMoneyRound('SUM(rl.charged_cost)')}, 0) as charged_cost,
					COALESCE(${sqlMoneyRound('SUM(rl.metered_cost)')}, 0) as metered_cost,
					COALESCE(${sqlMoneyRound('SUM(rl.standard_cost)')}, 0) as standard_cost,
					COALESCE(SUM(rl.input_tokens), 0) as input_tokens,
					COALESCE(SUM(rl.output_tokens), 0) as output_tokens,
					SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as success_count,
					SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END) as error_count,
					AVG(rl.latency_ms) as avg_latency_ms
				 FROM api_key_request_logs rl ${joins.join(' ')}
				 WHERE ${conditions.join(' AND ')}
				 GROUP BY rl.model_id, rl.route_group`,
				bindValues
			);
			return rows;
		},

		async queryDistinctModelTags(): Promise<string[]> {
			const [rows] = await pool.query<{ tag: string }[]>('SELECT DISTINCT tag FROM model_tags ORDER BY tag ASC');
			return rows.map((t) => t.tag);
		},

		async queryUserAnalytics(options: { start: string; end: string; email?: string }): Promise<UserAnalyticsRow[]> {
			const conditions: string[] = ['rl.created_at >= ?', 'rl.created_at <= ?', "rl.user_email IS NOT NULL AND rl.user_email != ''"];
			const bindValues: unknown[] = [options.start, options.end];
			if (options.email) {
				conditions.push('rl.user_email LIKE ?');
				bindValues.push(`%${options.email}%`);
			}
			const [rows] = await pool.query<UserAnalyticsRow[]>(
				`SELECT
					rl.user_email as user_email,
					COUNT(*) as request_count,
					COALESCE(SUM(rl.input_tokens), 0) as input_tokens,
					COALESCE(SUM(rl.output_tokens), 0) as output_tokens,
					COALESCE(${sqlMoneyRound('SUM(rl.charged_cost)')}, 0) as charged_cost,
					COALESCE(${sqlMoneyRound('SUM(rl.metered_cost)')}, 0) as metered_cost,
					COALESCE(${sqlMoneyRound('SUM(rl.standard_cost)')}, 0) as standard_cost,
					COUNT(DISTINCT rl.model_id) as distinct_models,
					MAX(rl.created_at) as last_active_at,
				${sqlMoneyRound('MAX(u.budget_max)')} as budget_max,
				${sqlMoneyRound('MAX(u.budget_spent)')} as budget_spent,
				SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as success_count,
				SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END) as error_count
			 FROM api_key_request_logs rl
			 LEFT JOIN users u ON u.id = rl.user_id
				 WHERE ${conditions.join(' AND ')}
				 GROUP BY rl.user_email`,
				bindValues
			);
			return rows;
		},

		async queryProviderAnalytics(options: { start: string; end: string; tag?: string }): Promise<ProviderAnalyticsRow[]> {
			const joins: string[] = ['LEFT JOIN providers p ON p.id = rl.provider_id'];
			const bindValues: unknown[] = [];
			if (options.tag) {
				joins.push('INNER JOIN model_tags mt ON mt.model_id = rl.model_id AND mt.tag = ?');
				bindValues.push(options.tag);
			}
			bindValues.push(options.start, options.end);
			const [rows] = await pool.query<ProviderAnalyticsRow[]>(
				`SELECT
					rl.provider_id as provider_id,
					MAX(p.name) as provider_name,
					COUNT(*) as request_count,
					COALESCE(${sqlMoneyRound('SUM(rl.charged_cost)')}, 0) as charged_cost,
					COALESCE(${sqlMoneyRound('SUM(rl.metered_cost)')}, 0) as metered_cost,
					COALESCE(${sqlMoneyRound('SUM(rl.standard_cost)')}, 0) as standard_cost,
					COALESCE(SUM(rl.input_tokens), 0) as input_tokens,
					COALESCE(SUM(rl.output_tokens), 0) as output_tokens,
					COUNT(DISTINCT rl.model_id) as distinct_models,
					SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as success_count,
					SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END) as error_count,
					AVG(rl.latency_ms) as avg_latency_ms
				 FROM api_key_request_logs rl ${joins.join(' ')}
				 WHERE rl.created_at >= ? AND rl.created_at <= ? AND rl.provider_id IS NOT NULL
				 GROUP BY rl.provider_id`,
				bindValues
			);
			return rows;
		},

		async queryProviderReliability(options: { start: string; end: string }): Promise<ProviderReliabilityRow[]> {
			const [rows] = await pool.query<ProviderReliabilityRow[]>(
				`SELECT
					provider_id,
					COUNT(*) as request_count,
					SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
					SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
					AVG(latency_ms) as avg_latency_ms,
					COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) as charged_cost,
					COALESCE(${sqlMoneyRound('SUM(metered_cost)')}, 0) as metered_cost,
					COALESCE(${sqlMoneyRound('SUM(standard_cost)')}, 0) as standard_cost
				 FROM api_key_request_logs
				 WHERE created_at >= ? AND created_at <= ? AND provider_id IS NOT NULL
				 GROUP BY provider_id`,
				[options.start, options.end]
			);
			return rows;
		},

		async queryModelProviderReliability(options: { start: string; end: string }): Promise<ModelProviderReliabilityRow[]> {
			const [rows] = await pool.query<ModelProviderReliabilityRow[]>(
				`SELECT
					model_id,
					provider_id,
					COUNT(*) as request_count,
					SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
					AVG(latency_ms) as avg_latency_ms,
					COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) as charged_cost,
					COALESCE(${sqlMoneyRound('SUM(metered_cost)')}, 0) as metered_cost,
					COALESCE(${sqlMoneyRound('SUM(standard_cost)')}, 0) as standard_cost
				 FROM api_key_request_logs
				 WHERE created_at >= ? AND created_at <= ? AND model_id IS NOT NULL AND provider_id IS NOT NULL
				 GROUP BY model_id, provider_id`,
				[options.start, options.end]
			);
			return rows;
		},
	};
}
