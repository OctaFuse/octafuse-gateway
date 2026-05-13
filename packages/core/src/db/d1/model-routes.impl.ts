/**
 * D1：`model_routes`。
 */
import type { D1DatabaseClient } from '../../storage/database-client';
import type { ModelRoutesRepository } from '../../storage/gateway-repository-interfaces';
import type { ModelRouteDetailRow, ModelRouteJoinRow } from '../../storage/repository-dtos';
import { MODEL_ROUTE_PATCH_COLS } from '../patch-allowlists';

const MODEL_ROUTE_LIST_JOIN_SQL = `SELECT mr.id, mr.model_id, mr.provider_id, mr.provider_model_name, mr.priority, mr.status,
				mr.route_group, mr.price_override, mr.custom_params, mr.upstream_protocol,
				m.display_name as model_name, p.name as provider_name
			 FROM model_routes mr
			 LEFT JOIN models m ON mr.model_id = m.id
			 LEFT JOIN providers p ON mr.provider_id = p.id`;

export function createD1ModelRoutesRepository(db: D1DatabaseClient): ModelRoutesRepository {
	const raw = db.raw;
	return {
		async listModelRoutesWithJoins(filters: { modelId?: string; providerId?: string }): Promise<ModelRouteJoinRow[]> {
			const conditions: string[] = [];
			const bindValues: unknown[] = [];
			if (filters.modelId) {
				conditions.push('mr.model_id = ?');
				bindValues.push(filters.modelId);
			}
			if (filters.providerId) {
				conditions.push('mr.provider_id = ?');
				bindValues.push(filters.providerId);
			}
			const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const sqlText = `${MODEL_ROUTE_LIST_JOIN_SQL} ${where} ORDER BY mr.model_id, mr.priority DESC`;
			const rows = await raw.prepare(sqlText).bind(...bindValues).all<ModelRouteJoinRow>();
			return rows.results ?? [];
		},

		async insertModelRoute(params: {
			id: string;
			modelId: string;
			providerId: string;
			providerModelName: string;
			priority: number;
			status: string;
			routeGroup: string;
			priceOverride: unknown;
			customParams: string | null;
			upstreamProtocol: string;
		}): Promise<void> {
			await raw
				.prepare(
					`INSERT INTO model_routes (id, model_id, provider_id, provider_model_name, priority, status, route_group, price_override, custom_params, upstream_protocol, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
				)
				.bind(
					params.id,
					params.modelId,
					params.providerId,
					params.providerModelName,
					params.priority,
					params.status,
					params.routeGroup,
					params.priceOverride ?? null,
					params.customParams,
					params.upstreamProtocol
				)
				.run();
		},

		async getModelRouteRowById(id: string): Promise<ModelRouteDetailRow | null> {
			return raw.prepare('SELECT * FROM model_routes WHERE id = ?').bind(id).first<ModelRouteDetailRow>();
		},

		async updateModelRouteByPatch(id: string, patch: Record<string, unknown>): Promise<number> {
			const updateFields: string[] = [];
			const bindValues: unknown[] = [];
			for (const [key, value] of Object.entries(patch)) {
				if (value !== undefined && MODEL_ROUTE_PATCH_COLS.has(key)) {
					updateFields.push(`${key} = ?`);
					bindValues.push(value);
				}
			}
			if (updateFields.length === 0) return 0;
			const updated = await raw
				.prepare(`UPDATE model_routes SET ${updateFields.join(', ')} WHERE id = ?`)
				.bind(...bindValues, id)
				.run();
			return updated.meta.changes;
		},

		async deleteModelRouteById(id: string): Promise<number> {
			const deleted = await raw.prepare('DELETE FROM model_routes WHERE id = ?').bind(id).run();
			return deleted.meta.changes;
		},
	};
}
