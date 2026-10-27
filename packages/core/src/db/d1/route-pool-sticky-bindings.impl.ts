/**
 * D1：`route_pool_sticky_bindings` with token / expiry CAS.
 */
import type { D1DatabaseClient } from '../../storage/database-client';
import type { RoutePoolStickyBindingsRepository } from '../../storage/gateway-repository-interfaces';
import type {
	RoutePoolStickyActiveBindingRow,
	RoutePoolStickyBindingRow,
	RoutePoolStickyBindingTargetCount,
} from '../route-pool-sticky-types';

export function createD1RoutePoolStickyBindingsRepository(
	db: D1DatabaseClient
): RoutePoolStickyBindingsRepository {
	const raw = db.raw;
	return {
		async getBinding(routePoolId, affinityHash): Promise<RoutePoolStickyBindingRow | null> {
			return (
				(await raw
					.prepare(
						`SELECT route_pool_id, affinity_hash, route_target_id, binding_token,
						        pool_epoch, expires_at, created_at, updated_at, affinity_key
						 FROM route_pool_sticky_bindings
						 WHERE route_pool_id = ? AND affinity_hash = ?`
					)
					.bind(routePoolId, affinityHash)
					.first<RoutePoolStickyBindingRow>()) ?? null
			);
		},

		async tryBind(params): Promise<boolean> {
			const expectedToken = params.expectedToken?.trim() || '';
			const result = await raw
				.prepare(
					`INSERT INTO route_pool_sticky_bindings (
						route_pool_id, affinity_hash, route_target_id, binding_token,
						pool_epoch, expires_at, created_at, updated_at, affinity_key
					) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
					ON CONFLICT(route_pool_id, affinity_hash) DO UPDATE SET
						route_target_id = excluded.route_target_id,
						binding_token = excluded.binding_token,
						pool_epoch = excluded.pool_epoch,
						expires_at = excluded.expires_at,
						updated_at = datetime('now'),
						affinity_key = COALESCE(excluded.affinity_key, route_pool_sticky_bindings.affinity_key)
					WHERE route_pool_sticky_bindings.expires_at <= ?
					   OR route_pool_sticky_bindings.pool_epoch != excluded.pool_epoch
					   OR (? != '' AND route_pool_sticky_bindings.binding_token = ?)`
				)
				.bind(
					params.routePoolId,
					params.affinityHash,
					params.routeTargetId,
					params.bindingToken,
					params.poolEpoch,
					params.expiresAt,
					params.affinityKey ?? null,
					params.nowIso,
					expectedToken,
					expectedToken
				)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async touchBinding(params): Promise<boolean> {
			const result = await raw
				.prepare(
					`UPDATE route_pool_sticky_bindings
					 SET expires_at = ?, updated_at = datetime('now'),
					     affinity_key = COALESCE(affinity_key, ?)
					 WHERE route_pool_id = ?
					   AND affinity_hash = ?
					   AND binding_token = ?`
				)
				.bind(
					params.expiresAt,
					params.affinityKey ?? null,
					params.routePoolId,
					params.affinityHash,
					params.expectedToken
				)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async clearBinding(params): Promise<boolean> {
			const result = await raw
				.prepare(
					`DELETE FROM route_pool_sticky_bindings
					 WHERE route_pool_id = ?
					   AND affinity_hash = ?
					   AND binding_token = ?`
				)
				.bind(params.routePoolId, params.affinityHash, params.expectedToken)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async forceClearBinding(params): Promise<boolean> {
			const result = await raw
				.prepare(
					`DELETE FROM route_pool_sticky_bindings
					 WHERE route_pool_id = ?
					   AND affinity_hash = ?`
				)
				.bind(params.routePoolId, params.affinityHash)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async listBindingTargetCounts(
			routePoolId,
			nowIso
		): Promise<RoutePoolStickyBindingTargetCount[]> {
			const { results } = await raw
				.prepare(
					`SELECT b.route_target_id AS route_target_id,
					        COUNT(*) AS active_count,
					        MAX(b.updated_at) AS last_updated_at
					 FROM route_pool_sticky_bindings b
					 JOIN route_pools p ON p.id = b.route_pool_id
					 WHERE b.route_pool_id = ?
					   AND b.pool_epoch = p.sticky_epoch
					   AND b.expires_at > ?
					 GROUP BY b.route_target_id
					 ORDER BY active_count DESC, b.route_target_id ASC`
				)
				.bind(routePoolId, nowIso)
				.all<{
					route_target_id: string;
					active_count: number;
					last_updated_at: string | null;
				}>();
			return (results ?? []).map((r) => ({
				route_target_id: r.route_target_id,
				active_count: Number(r.active_count) || 0,
				last_updated_at: r.last_updated_at ?? null,
			}));
		},

		async listActiveBindings(params): Promise<{
			rows: RoutePoolStickyActiveBindingRow[];
			total: number;
		}> {
			const target = params.routeTargetId?.trim() || '';
			const targetSql = target ? 'AND b.route_target_id = ?' : '';
			const filterArgs = target
				? [params.routePoolId, params.nowIso, target]
				: [params.routePoolId, params.nowIso];
			const base = `FROM route_pool_sticky_bindings b
					 JOIN route_pools p ON p.id = b.route_pool_id
					 WHERE b.route_pool_id = ?
					   AND b.pool_epoch = p.sticky_epoch
					   AND b.expires_at > ?
					   ${targetSql}`;
			const [list, count] = await Promise.all([
				raw
					.prepare(
						`SELECT b.affinity_hash AS affinity_hash, b.affinity_key AS affinity_key,
						        b.route_target_id AS route_target_id, b.expires_at AS expires_at,
						        b.updated_at AS updated_at
						 ${base}
						 ORDER BY b.updated_at DESC, b.affinity_hash ASC
						 LIMIT ? OFFSET ?`
					)
					.bind(...filterArgs, params.limit, params.offset)
					.all<RoutePoolStickyActiveBindingRow>(),
				raw
					.prepare(`SELECT COUNT(*) AS cnt ${base}`)
					.bind(...filterArgs)
					.first<{ cnt: number }>(),
			]);
			return {
				rows: (list.results ?? []).map((r) => ({
					affinity_hash: r.affinity_hash,
					affinity_key: r.affinity_key ?? null,
					route_target_id: r.route_target_id,
					expires_at: r.expires_at,
					updated_at: r.updated_at ?? null,
				})),
				total: Number(count?.cnt) || 0,
			};
		},

		async countStaleBindings(routePoolId, nowIso): Promise<number> {
			const row = await raw
				.prepare(
					`SELECT COUNT(*) AS cnt
					 FROM route_pool_sticky_bindings b
					 JOIN route_pools p ON p.id = b.route_pool_id
					 WHERE b.route_pool_id = ?
					   AND (b.expires_at <= ? OR b.pool_epoch != p.sticky_epoch)`
				)
				.bind(routePoolId, nowIso)
				.first<{ cnt: number }>();
			return Number(row?.cnt) || 0;
		},

		async deleteStaleBefore(cutoffIso, limit): Promise<number> {
			const result = await raw
				.prepare(
					`DELETE FROM route_pool_sticky_bindings
					 WHERE rowid IN (
						SELECT b.rowid FROM route_pool_sticky_bindings b
						LEFT JOIN route_pools p ON p.id = b.route_pool_id
						WHERE b.expires_at < ?
						   OR (p.id IS NOT NULL AND b.pool_epoch != p.sticky_epoch)
						LIMIT ?
					 )`
				)
				.bind(cutoffIso, limit)
				.run();
			return result.meta.changes ?? 0;
		},
	};
}
