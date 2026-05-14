/**
 * D1：管理后台分析聚合查询。
 */
import { sqlMoneyRound } from '../../lib/money-precision';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { AdminAnalyticsRepository } from '../../storage/gateway-repository-interfaces';
import type {
	ModelAnalyticsRow,
	ModelProviderReliabilityRow,
	ProviderAnalyticsRow,
	ProviderReliabilityRow,
	UserAnalyticsRow,
} from '../../storage/repository-dtos';

export function createD1AdminAnalyticsRepository(db: D1DatabaseClient): AdminAnalyticsRepository {
	const raw = db.raw;
	return {
		async queryModelAnalytics(options: { start: string; end: string; tag?: string }): Promise<ModelAnalyticsRow[]> {
			const joins: string[] = [];
			const bindValues: unknown[] = [];
			if (options.tag) {
				joins.push('INNER JOIN model_tags mt ON mt.model_id = rl.model_id AND mt.tag = ?');
				bindValues.push(options.tag);
			}
			bindValues.push(options.start, options.end);
			const rows = await raw
				.prepare(
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
			 WHERE rl.created_at >= ? AND rl.created_at <= ? AND rl.model_id IS NOT NULL
			 GROUP BY rl.model_id, rl.route_group`
				)
				.bind(...bindValues)
				.all<ModelAnalyticsRow>();
			return rows.results ?? [];
		},

		async queryDistinctModelTags(): Promise<string[]> {
			const tags = await raw.prepare('SELECT DISTINCT tag FROM model_tags ORDER BY tag ASC').all<{ tag: string }>();
			return (tags.results ?? []).map((t) => t.tag);
		},

		async queryUserAnalytics(options: { start: string; end: string; email?: string }): Promise<UserAnalyticsRow[]> {
			const conditions: string[] = ['rl.created_at >= ?', 'rl.created_at <= ?', "rl.user_email IS NOT NULL AND rl.user_email != ''"];
			const bindValues: unknown[] = [options.start, options.end];
			if (options.email) {
				conditions.push('rl.user_email LIKE ?');
				bindValues.push(`%${options.email}%`);
			}
			const rows = await raw
				.prepare(
					`SELECT
				rl.user_email as user_email,
				COUNT(*) as request_count,
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
			 GROUP BY rl.user_email`
				)
				.bind(...bindValues)
				.all<UserAnalyticsRow>();
			return rows.results ?? [];
		},

		async queryProviderAnalytics(options: { start: string; end: string; tag?: string }): Promise<ProviderAnalyticsRow[]> {
			const joins: string[] = ['LEFT JOIN providers p ON p.id = rl.provider_id'];
			const bindValues: unknown[] = [];
			if (options.tag) {
				joins.push('INNER JOIN model_tags mt ON mt.model_id = rl.model_id AND mt.tag = ?');
				bindValues.push(options.tag);
			}
			bindValues.push(options.start, options.end);
			const rows = await raw
				.prepare(
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
			 GROUP BY rl.provider_id`
				)
				.bind(...bindValues)
				.all<ProviderAnalyticsRow>();
			return rows.results ?? [];
		},

		async queryProviderReliability(options: { start: string; end: string }): Promise<ProviderReliabilityRow[]> {
			const providers = await raw
				.prepare(
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
			 GROUP BY provider_id`
				)
				.bind(options.start, options.end)
				.all<ProviderReliabilityRow>();
			return providers.results ?? [];
		},

		async queryModelProviderReliability(options: { start: string; end: string }): Promise<ModelProviderReliabilityRow[]> {
			const modelProviders = await raw
				.prepare(
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
			 GROUP BY model_id, provider_id`
				)
				.bind(options.start, options.end)
				.all<ModelProviderReliabilityRow>();
			return modelProviders.results ?? [];
		},
	};
}
