/**
 * MySQL：`model_routes`。
 */
import type { ResultSetHeader } from 'mysql2/promise';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { ModelRoutesRepository } from '../../storage/gateway-repository-interfaces';
import type { ModelRouteDetailRow, ModelRouteJoinRow } from '../../storage/repository-dtos';
import { MODEL_ROUTE_PATCH_COLS } from '../patch-allowlists';
import { asMySqlPool } from './mysql2-compat';

const MODEL_ROUTE_LIST_JOIN_SQL = `SELECT mr.id, mr.model_id, mr.provider_id, mr.provider_model_name, mr.priority, mr.status,
		mr.route_group, mr.price_override, mr.custom_params, mr.upstream_protocol,
		m.display_name as model_name, p.name as provider_name
	 FROM model_routes mr
	 LEFT JOIN models m ON mr.model_id = m.id
	 LEFT JOIN providers p ON mr.provider_id = p.id`;

export function createMySqlModelRoutesRepository(db: MySqlDatabaseClient): ModelRoutesRepository {
	const pool = asMySqlPool(db.raw);
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
			const [rows] = await pool.query<ModelRouteJoinRow[]>(sqlText, bindValues);
			return rows;
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
			const now = new Date().toISOString();
			await pool.execute(
				`INSERT INTO model_routes (id, model_id, provider_id, provider_model_name, priority, status, route_group, price_override, custom_params, upstream_protocol, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					params.id,
					params.modelId,
					params.providerId,
					params.providerModelName,
					params.priority,
					params.status,
					params.routeGroup,
					params.priceOverride ?? null,
					params.customParams,
					params.upstreamProtocol,
					now,
				]
			);
		},

		async getModelRouteRowById(id: string): Promise<ModelRouteDetailRow | null> {
			const [rows] = await pool.query<ModelRouteDetailRow[]>('SELECT * FROM model_routes WHERE id = ?', [id]);
			return rows[0] ?? null;
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
			const [result] = await pool.execute<ResultSetHeader>(
				`UPDATE model_routes SET ${updateFields.join(', ')} WHERE id = ?`,
				[...bindValues, id]
			);
			return result.affectedRows;
		},

		async deleteModelRouteById(id: string): Promise<number> {
			const [result] = await pool.execute<ResultSetHeader>('DELETE FROM model_routes WHERE id = ?', [id]);
			return result.affectedRows;
		},
	};
}
