/**
 * D1：推理路径模型/路由查询。
 */
import type { ModelRow, ModelRouteRow } from '../../types';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { ModelRoutingRepository } from '../../storage/gateway-repository-interfaces';

const LIST_MODELS_WITH_ACTIVE_ROUTES_SQL = `SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
  (SELECT json_group_array(mt.tag) FROM model_tags mt WHERE mt.model_id = m.id) AS tags,
  (SELECT json_group_array(r.route_group) FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active') AS route_groups,
  m.description, m.metadata, m.input_modalities, m.output_modalities, m.released_at, m.created_at
FROM models m
WHERE EXISTS (SELECT 1 FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active')
ORDER BY m.id`;

export function createD1ModelRoutingRepository(db: D1DatabaseClient): ModelRoutingRepository {
	const raw = db.raw;
	return {
		async getModelById(id: string): Promise<ModelRow | null> {
			return raw
				.prepare(
					`SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
       (SELECT json_group_array(tag) FROM model_tags WHERE model_id = m.id) AS tags,
       m.description, m.metadata, m.input_modalities, m.output_modalities, m.released_at, m.sticky_config, m.created_at
       FROM models m WHERE m.id = ?`
				)
				.bind(id)
				.first<ModelRow>();
		},

		async listModelsWithActiveRoutes(): Promise<ModelRow[]> {
			try {
				const rows = await raw.prepare(LIST_MODELS_WITH_ACTIVE_ROUTES_SQL).all<ModelRow>();
				return rows.results ?? [];
			} catch {
				const list: ModelRow[] = [];
				let offset = 0;
				const sqlWithLimit = `${LIST_MODELS_WITH_ACTIVE_ROUTES_SQL} LIMIT 1 OFFSET ?`;
				while (true) {
					const row = await raw.prepare(sqlWithLimit).bind(offset).first<ModelRow>();
					if (!row) break;
					list.push(row);
					offset += 1;
				}
				return list;
			}
		},

		async getModelRoutesByModelId(modelId: string): Promise<ModelRouteRow[]> {
			const rows = await raw
				.prepare('SELECT * FROM model_routes WHERE model_id = ? AND status = \'active\' ORDER BY priority DESC')
				.bind(modelId)
				.all<ModelRouteRow>();
			return rows.results ?? [];
		},
	};
}
