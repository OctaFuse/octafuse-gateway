/**
 * Postgres：管理后台分析聚合查询。
 */
import { sqlMoneyRound } from '../../lib/money-precision';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { AdminAnalyticsRepository } from '../../storage/gateway-repository-interfaces';
import type {
	ModelAnalyticsRow,
	ModelProviderReliabilityRow,
	ProviderAnalyticsRow,
	ProviderReliabilityRow,
	UserAnalyticsRow,
} from '../../storage/repository-dtos';

export function createPostgresAdminAnalyticsRepository(db: PostgresDatabaseClient): AdminAnalyticsRepository {
	const pg = db.raw;
	return {
		async queryModelAnalytics(options: { start: string; end: string; tag?: string; providerId?: string; userEmail?: string }): Promise<ModelAnalyticsRow[]> {
			const baseSelect = `SELECT
				rl.model_id as model_id,
				rl.route_group as route_group,
				COUNT(*)::bigint as request_count,
				COALESCE(${sqlMoneyRound('SUM(rl.charged_cost)')}, 0) as charged_cost,
				COALESCE(${sqlMoneyRound('SUM(rl.metered_cost)')}, 0) as metered_cost,
				COALESCE(${sqlMoneyRound('SUM(rl.standard_cost)')}, 0) as standard_cost,
				COALESCE(SUM(rl.input_tokens), 0)::bigint as input_tokens,
				COALESCE(SUM(rl.output_tokens), 0)::bigint as output_tokens,
				SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END)::bigint as success_count,
				SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END)::bigint as error_count,
				AVG(rl.latency_ms) as avg_latency_ms`;
			const joins: string[] = [];
			const conditions: string[] = [];
			const values: string[] = [];
			if (options.tag) {
				values.push(options.tag);
				joins.push(`INNER JOIN model_tags mt ON mt.model_id = rl.model_id AND mt.tag = $${values.length}`);
			}
			values.push(options.start);
			conditions.push(`rl.created_at >= $${values.length}`);
			values.push(options.end);
			conditions.push(`rl.created_at <= $${values.length}`);
			conditions.push('rl.model_id IS NOT NULL');
			if (options.providerId) {
				values.push(options.providerId);
				conditions.push(`rl.provider_id = $${values.length}`);
			}
			if (options.userEmail) {
				values.push(options.userEmail);
				conditions.push(`rl.user_email = $${values.length}`);
			}
			const q = `${baseSelect}
		FROM api_key_request_logs rl
		${joins.join(' ')}
		WHERE ${conditions.join(' AND ')}
		GROUP BY rl.model_id, rl.route_group`;
			return (await pg.unsafe(q, values)) as ModelAnalyticsRow[];
		},

		async queryDistinctModelTags(): Promise<string[]> {
			const rows = await pg<{ tag: string }[]>`SELECT DISTINCT tag FROM model_tags ORDER BY tag ASC`;
			return rows.map((t) => t.tag);
		},

		async queryUserAnalytics(options: { start: string; end: string; email?: string }): Promise<UserAnalyticsRow[]> {
			const userSel = `SELECT
				rl.user_email as user_email,
				COUNT(*)::bigint as request_count,
				COALESCE(SUM(rl.input_tokens), 0)::bigint as input_tokens,
				COALESCE(SUM(rl.output_tokens), 0)::bigint as output_tokens,
				COALESCE(${sqlMoneyRound('SUM(rl.charged_cost)')}, 0) as charged_cost,
				COALESCE(${sqlMoneyRound('SUM(rl.metered_cost)')}, 0) as metered_cost,
				COALESCE(${sqlMoneyRound('SUM(rl.standard_cost)')}, 0) as standard_cost,
				COUNT(DISTINCT rl.model_id)::bigint as distinct_models,
				MAX(rl.created_at) as last_active_at,
				${sqlMoneyRound('MAX(u.budget_max)')} as budget_max,
				${sqlMoneyRound('MAX(u.budget_spent)')} as budget_spent,
				SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END)::bigint as success_count,
				SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END)::bigint as error_count
			FROM api_key_request_logs rl
			LEFT JOIN users u ON u.id = rl.user_id`;
			if (options.email) {
				const like = `%${options.email}%`;
				const q = `${userSel}
			WHERE rl.created_at >= $1 AND rl.created_at <= $2
				AND rl.user_email IS NOT NULL AND rl.user_email != ''
				AND rl.user_email LIKE $3
			GROUP BY rl.user_email`;
				return (await pg.unsafe(q, [options.start, options.end, like])) as UserAnalyticsRow[];
			}
			const q = `${userSel}
		WHERE rl.created_at >= $1 AND rl.created_at <= $2
			AND rl.user_email IS NOT NULL AND rl.user_email != ''
		GROUP BY rl.user_email`;
			return (await pg.unsafe(q, [options.start, options.end])) as UserAnalyticsRow[];
		},

		async queryProviderAnalytics(options: { start: string; end: string; tag?: string; modelId?: string; routeGroup?: string }): Promise<ProviderAnalyticsRow[]> {
			const provSel = `SELECT
				rl.provider_id as provider_id,
				MAX(p.name) as provider_name,
				COUNT(*)::bigint as request_count,
				COALESCE(${sqlMoneyRound('SUM(rl.charged_cost)')}, 0) as charged_cost,
				COALESCE(${sqlMoneyRound('SUM(rl.metered_cost)')}, 0) as metered_cost,
				COALESCE(${sqlMoneyRound('SUM(rl.standard_cost)')}, 0) as standard_cost,
				COALESCE(SUM(rl.input_tokens), 0)::bigint as input_tokens,
				COALESCE(SUM(rl.output_tokens), 0)::bigint as output_tokens,
				COUNT(DISTINCT rl.model_id)::bigint as distinct_models,
				SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END)::bigint as success_count,
				SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END)::bigint as error_count,
				AVG(rl.latency_ms) as avg_latency_ms
			FROM api_key_request_logs rl
			LEFT JOIN providers p ON p.id = rl.provider_id`;
			const joins: string[] = [];
			const conditions: string[] = [];
			const values: string[] = [];
			if (options.tag) {
				values.push(options.tag);
				joins.push(`INNER JOIN model_tags mt ON mt.model_id = rl.model_id AND mt.tag = $${values.length}`);
			}
			values.push(options.start);
			conditions.push(`rl.created_at >= $${values.length}`);
			values.push(options.end);
			conditions.push(`rl.created_at <= $${values.length}`);
			conditions.push('rl.provider_id IS NOT NULL');
			if (options.modelId) {
				values.push(options.modelId);
				conditions.push(`rl.model_id = $${values.length}`);
			}
			if (options.routeGroup) {
				values.push(options.routeGroup);
				conditions.push(`rl.route_group = $${values.length}`);
			}
			const q = `${provSel}
		${joins.join(' ')}
		WHERE ${conditions.join(' AND ')}
		GROUP BY rl.provider_id`;
			return (await pg.unsafe(q, values)) as ProviderAnalyticsRow[];
		},

		async queryProviderReliability(options: { start: string; end: string }): Promise<ProviderReliabilityRow[]> {
			const q = `SELECT
			rl.provider_id as provider_id,
			MAX(p.name) as provider_name,
			COUNT(*)::bigint as request_count,
			SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END)::bigint as success_count,
			SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END)::bigint as error_count,
			AVG(rl.latency_ms) as avg_latency_ms,
			COALESCE(${sqlMoneyRound('SUM(rl.charged_cost)')}, 0) as charged_cost,
			COALESCE(${sqlMoneyRound('SUM(rl.metered_cost)')}, 0) as metered_cost,
			COALESCE(${sqlMoneyRound('SUM(rl.standard_cost)')}, 0) as standard_cost
		FROM api_key_request_logs rl
		LEFT JOIN providers p ON p.id = rl.provider_id
		WHERE rl.created_at >= $1 AND rl.created_at <= $2 AND rl.provider_id IS NOT NULL
		GROUP BY rl.provider_id`;
			return (await pg.unsafe(q, [options.start, options.end])) as ProviderReliabilityRow[];
		},

		async queryModelProviderReliability(options: { start: string; end: string }): Promise<ModelProviderReliabilityRow[]> {
			const q = `SELECT
			rl.model_id as model_id,
			rl.provider_id as provider_id,
			MAX(p.name) as provider_name,
			COUNT(*)::bigint as request_count,
			SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END)::bigint as success_count,
			AVG(rl.latency_ms) as avg_latency_ms,
			COALESCE(${sqlMoneyRound('SUM(rl.charged_cost)')}, 0) as charged_cost,
			COALESCE(${sqlMoneyRound('SUM(rl.metered_cost)')}, 0) as metered_cost,
			COALESCE(${sqlMoneyRound('SUM(rl.standard_cost)')}, 0) as standard_cost
		FROM api_key_request_logs rl
		LEFT JOIN providers p ON p.id = rl.provider_id
		WHERE rl.created_at >= $1 AND rl.created_at <= $2 AND rl.model_id IS NOT NULL AND rl.provider_id IS NOT NULL
		GROUP BY rl.model_id, rl.provider_id`;
			return (await pg.unsafe(q, [options.start, options.end])) as ModelProviderReliabilityRow[];
		},
	};
}
