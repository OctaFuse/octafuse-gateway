/**
 * D1：`model_routes`。
 */
import type { D1DatabaseClient } from '../../storage/database-client';
import type {
	ListModelRoutesWithJoinsFilters,
	ModelRoutesRepository,
} from '../../storage/gateway-repository-interfaces';
import type { ModelRouteDetailRow, ModelRouteJoinRow } from '../../storage/repository-dtos';
import { MODEL_ROUTE_PATCH_COLS } from '../patch-allowlists';

const MODEL_ROUTE_LIST_JOIN_SQL = `SELECT mr.id, mr.model_id, mr.provider_id, mr.provider_model_name, mr.priority, mr.status,
				mr.route_group, mr.weight, mr.price_override, mr.custom_params, mr.upstream_protocol,
				mr.route_pool_id, mr.upstream_operation, mr.adapter,
				rp.name AS pool_name, rp.strategy AS pool_strategy, rp.tier_strategies AS pool_tier_strategies, rp.status AS pool_status,
				rp.sticky_enabled AS pool_sticky_enabled,
				rp.sticky_idle_ttl_seconds AS pool_sticky_idle_ttl_seconds,
				rp.sticky_epoch AS pool_sticky_epoch,
				(SELECT json_group_array(json_object(
					'id', ms.id,
					'request_protocol', ms.request_protocol,
					'request_operation', ms.request_operation,
					'status', ms.status
				)) FROM model_surfaces ms WHERE ms.route_pool_id = mr.route_pool_id) AS surfaces,
				m.display_name as model_name, p.name as provider_name
			 FROM model_routes mr
			 LEFT JOIN models m ON mr.model_id = m.id
			 LEFT JOIN providers p ON mr.provider_id = p.id
			 LEFT JOIN route_pools rp ON mr.route_pool_id = rp.id`;

export function createD1ModelRoutesRepository(db: D1DatabaseClient): ModelRoutesRepository {
	const raw = db.raw;
	return {
		async listModelRoutesWithJoins(filters: ListModelRoutesWithJoinsFilters): Promise<ModelRouteJoinRow[]> {
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
			if (filters.status === 'active') {
				conditions.push("mr.status = 'active'");
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
			weight?: number;
			priceOverride: unknown;
			customParams: string | null;
			upstreamProtocol: string;
			routePoolId: string;
			upstreamOperation: string;
			adapter: string;
		}): Promise<void> {
			await raw
				.prepare(
					`INSERT INTO model_routes (id, model_id, provider_id, provider_model_name, priority, status, route_group, weight, price_override, custom_params, upstream_protocol, route_pool_id, upstream_operation, adapter, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
				)
				.bind(
					params.id,
					params.modelId,
					params.providerId,
					params.providerModelName,
					params.priority,
					params.status,
					params.routeGroup,
					params.weight ?? 1,
					params.priceOverride ?? null,
					params.customParams,
					params.upstreamProtocol,
					params.routePoolId,
					params.upstreamOperation,
					params.adapter
				)
				.run();
		},

		async getModelRouteRowById(id: string): Promise<ModelRouteDetailRow | null> {
			return raw.prepare('SELECT * FROM model_routes WHERE id = ?').bind(id).first<ModelRouteDetailRow>();
		},

		async ensureModelSurfacePool(params): Promise<{ poolId: string; surfaceId: string }> {
			const existing = await raw
				.prepare(
					`SELECT id, route_pool_id FROM model_surfaces
					 WHERE model_id = ? AND lower(route_group) = lower(?)
					   AND lower(request_protocol) = lower(?) AND request_operation = ?
					 LIMIT 1`
				)
				.bind(
					params.modelId,
					params.routeGroup,
					params.requestProtocol,
					params.requestOperation
				)
				.first<{ id: string; route_pool_id: string }>();
			if (existing) return { poolId: existing.route_pool_id, surfaceId: existing.id };

			await raw.batch([
				raw
					.prepare(
						`INSERT INTO route_pools
						 (id, model_id, route_group, name, strategy, status, created_at, updated_at)
						 VALUES (?, ?, ?, ?, NULL, 'active', datetime('now'), datetime('now'))`
					)
					.bind(params.poolId, params.modelId, params.routeGroup, params.poolName),
				raw
					.prepare(
						`INSERT INTO model_surfaces
						 (id, model_id, route_group, request_protocol, request_operation, route_pool_id, status, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`
					)
					.bind(
						params.surfaceId,
						params.modelId,
						params.routeGroup,
						params.requestProtocol,
						params.requestOperation,
						params.poolId
					),
			]);
			return { poolId: params.poolId, surfaceId: params.surfaceId };
		},

		async updateRoutePoolPolicy(
			poolId: string,
			patch: {
				strategy?: string | null;
				tierStrategies?: string | null;
				stickyEnabled?: boolean;
				stickyIdleTtlSeconds?: number;
			}
		): Promise<number> {
			const sets: string[] = [];
			const bindValues: unknown[] = [];
			if (patch.strategy !== undefined) {
				sets.push('strategy = ?');
				bindValues.push(patch.strategy);
			}
			if (patch.tierStrategies !== undefined) {
				sets.push('tier_strategies = ?');
				bindValues.push(patch.tierStrategies);
			}
			const stickyTouched =
				patch.stickyEnabled !== undefined || patch.stickyIdleTtlSeconds !== undefined;
			if (patch.stickyEnabled !== undefined) {
				sets.push('sticky_enabled = ?');
				bindValues.push(patch.stickyEnabled ? 1 : 0);
			}
			if (patch.stickyIdleTtlSeconds !== undefined) {
				sets.push('sticky_idle_ttl_seconds = ?');
				bindValues.push(patch.stickyIdleTtlSeconds);
			}
			if (stickyTouched) {
				sets.push('sticky_epoch = sticky_epoch + 1');
			}
			if (sets.length === 0) return 0;
			sets.push(`updated_at = datetime('now')`);
			const updated = await raw
				.prepare(`UPDATE route_pools SET ${sets.join(', ')} WHERE id = ?`)
				.bind(...bindValues, poolId)
				.run();
			return updated.meta.changes;
		},

		async bumpRoutePoolStickyEpoch(poolId: string): Promise<number | null> {
			const updated = await raw
				.prepare(
					`UPDATE route_pools
					 SET sticky_epoch = sticky_epoch + 1,
					     updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(poolId)
				.run();
			if ((updated.meta.changes ?? 0) === 0) return null;
			const row = await raw
				.prepare(`SELECT sticky_epoch FROM route_pools WHERE id = ?`)
				.bind(poolId)
				.first<{ sticky_epoch: number }>();
			if (!row) return null;
			return Number(row.sticky_epoch);
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

		async deleteRoutePoolIfEmpty(poolId: string): Promise<boolean> {
			const remaining = await raw
				.prepare('SELECT 1 AS ok FROM model_routes WHERE route_pool_id = ? LIMIT 1')
				.bind(poolId)
				.first<{ ok: number }>();
			if (remaining) return false;
			await raw.batch([
				raw.prepare('DELETE FROM model_surfaces WHERE route_pool_id = ?').bind(poolId),
				raw.prepare('DELETE FROM route_pools WHERE id = ?').bind(poolId),
			]);
			return true;
		},
	};
}
