/**
 * Postgres：推理路径模型/路由查询。
 */
import { and, desc, eq } from 'drizzle-orm';
import type { ModelRow, ModelRouteRow } from '../../types';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { ModelRoutingRepository } from '../../storage/gateway-repository-interfaces';
import { modelRoutesTable as pgModelRoutesTable } from '../../storage/drizzle/schema.pg';

function mapPgModelRouteToRow(r: {
	id: string;
	modelId: string;
	providerId: string;
	providerModelName: string;
	priority: number;
	status: string;
	routeGroup: string;
	priceOverride: string | null;
	customParams: string | null;
	upstreamProtocol: string;
	createdAt: string;
}): ModelRouteRow {
	return {
		id: r.id,
		model_id: r.modelId,
		provider_id: r.providerId,
		provider_model_name: r.providerModelName,
		priority: r.priority,
		status: r.status,
		route_group: r.routeGroup,
		price_override: r.priceOverride,
		custom_params: r.customParams,
		upstream_protocol: r.upstreamProtocol,
	};
}

export function createPostgresModelRoutingRepository(db: PostgresDatabaseClient): ModelRoutingRepository {
	const drizzle = db.drizzle;
	const pg = db.raw;
	return {
		async getModelById(id: string): Promise<ModelRow | null> {
			const rows = await pg<ModelRow[]>`
		SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
			(SELECT COALESCE(json_agg(tag ORDER BY tag)::text, '[]') FROM model_tags WHERE model_id = m.id) AS tags,
			m.description, m.metadata, m.input_modalities, m.output_modalities, m.released_at, m.created_at::text
		FROM models m WHERE m.id = ${id}
	`;
			return rows[0] ?? null;
		},

		async listModelsWithActiveRoutes(): Promise<ModelRow[]> {
			const rows = await pg<ModelRow[]>`
		SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
			(SELECT COALESCE(json_agg(mt.tag ORDER BY mt.tag)::text, '[]') FROM model_tags mt WHERE mt.model_id = m.id) AS tags,
			(SELECT COALESCE(json_agg(r.route_group ORDER BY r.route_group)::text, '[]') FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active') AS route_groups,
			m.description, m.metadata, m.input_modalities, m.output_modalities, m.released_at, m.created_at::text
		FROM models m
		WHERE EXISTS (SELECT 1 FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active')
		ORDER BY m.id
	`;
			return rows;
		},

		async getModelRoutesByModelId(modelId: string): Promise<ModelRouteRow[]> {
			const rows = await drizzle
				.select()
				.from(pgModelRoutesTable)
				.where(and(eq(pgModelRoutesTable.modelId, modelId), eq(pgModelRoutesTable.status, 'active')))
				.orderBy(desc(pgModelRoutesTable.priority));
			return rows.map(mapPgModelRouteToRow);
		},
	};
}
