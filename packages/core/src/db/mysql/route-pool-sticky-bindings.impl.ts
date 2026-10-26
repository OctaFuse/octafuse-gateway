/**
 * MySQL：`route_pool_sticky_bindings` with token / expiry CAS.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { RoutePoolStickyBindingsRepository } from '../../storage/gateway-repository-interfaces';
import type {
	RoutePoolStickyActiveBindingRow,
	RoutePoolStickyBindingRow,
	RoutePoolStickyBindingTargetCount,
} from '../route-pool-sticky-types';
import { asMySqlPool } from './mysql2-compat';

type StickyBindingPacket = RoutePoolStickyBindingRow & RowDataPacket;

/** Convert ISO-8601 (with optional `Z`) to MySQL `TIMESTAMP(6)` literal. */
function toMySqlDateTime(iso: string): string {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) {
		// Best-effort strip: `2026-08-07T11:22:33.123Z` → `2026-08-07 11:22:33.123000`
		const trimmed = iso.trim().replace('T', ' ').replace(/Z$/i, '');
		if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
			const [head, frac = ''] = trimmed.split('.');
			return `${head}.${frac.padEnd(6, '0').slice(0, 6)}`;
		}
		return trimmed;
	}
	const d = new Date(ms);
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(d.getUTCDate()).padStart(2, '0');
	const hh = String(d.getUTCHours()).padStart(2, '0');
	const mi = String(d.getUTCMinutes()).padStart(2, '0');
	const ss = String(d.getUTCSeconds()).padStart(2, '0');
	const micros = String(d.getUTCMilliseconds()).padStart(3, '0') + '000';
	return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${micros}`;
}

function stringifyMySqlTime(value: unknown): string | null {
	if (value == null) return null;
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

export function createMySqlRoutePoolStickyBindingsRepository(
	db: MySqlDatabaseClient
): RoutePoolStickyBindingsRepository {
	const pool = asMySqlPool(db.raw);
	return {
		async getBinding(routePoolId, affinityHash): Promise<RoutePoolStickyBindingRow | null> {
			const [rows] = await pool.query<StickyBindingPacket[]>(
				`SELECT route_pool_id, affinity_hash, route_target_id, binding_token,
				        pool_epoch, expires_at, created_at, updated_at, affinity_key
				 FROM route_pool_sticky_bindings
				 WHERE route_pool_id = ? AND affinity_hash = ?
				 LIMIT 1`,
				[routePoolId, affinityHash]
			);
			return rows[0] ?? null;
		},

		async tryBind(params): Promise<boolean> {
			const expiresAt = toMySqlDateTime(params.expiresAt);
			const nowIso = toMySqlDateTime(params.nowIso);
			const expectedToken = params.expectedToken?.trim() || '';
			const [insertResult] = await pool.execute<ResultSetHeader>(
				`INSERT IGNORE INTO route_pool_sticky_bindings (
					route_pool_id, affinity_hash, route_target_id, binding_token,
					pool_epoch, expires_at, created_at, updated_at, affinity_key
				) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6), ?)`,
				[
					params.routePoolId,
					params.affinityHash,
					params.routeTargetId,
					params.bindingToken,
					params.poolEpoch,
					expiresAt,
					params.affinityKey ?? null,
				]
			);
			if (insertResult.affectedRows === 1) return true;

			const [updateResult] = await pool.execute<ResultSetHeader>(
				`UPDATE route_pool_sticky_bindings
				 SET route_target_id = ?,
				     binding_token = ?,
				     pool_epoch = ?,
				     expires_at = ?,
				     affinity_key = COALESCE(?, affinity_key),
				     updated_at = CURRENT_TIMESTAMP(6)
				 WHERE route_pool_id = ?
				   AND affinity_hash = ?
				   AND (expires_at <= ? OR pool_epoch <> ? OR (? <> '' AND binding_token = ?))`,
				[
					params.routeTargetId,
					params.bindingToken,
					params.poolEpoch,
					expiresAt,
					params.affinityKey ?? null,
					params.routePoolId,
					params.affinityHash,
					nowIso,
					params.poolEpoch,
					expectedToken,
					expectedToken,
				]
			);
			return updateResult.affectedRows > 0;
		},

		async touchBinding(params): Promise<boolean> {
			const [result] = await pool.execute<ResultSetHeader>(
				`UPDATE route_pool_sticky_bindings
				 SET expires_at = ?, affinity_key = COALESCE(affinity_key, ?), updated_at = CURRENT_TIMESTAMP(6)
				 WHERE route_pool_id = ?
				   AND affinity_hash = ?
				   AND binding_token = ?`,
				[
					toMySqlDateTime(params.expiresAt),
					params.affinityKey ?? null,
					params.routePoolId,
					params.affinityHash,
					params.expectedToken,
				]
			);
			return result.affectedRows > 0;
		},

		async clearBinding(params): Promise<boolean> {
			const [result] = await pool.execute<ResultSetHeader>(
				`DELETE FROM route_pool_sticky_bindings
				 WHERE route_pool_id = ?
				   AND affinity_hash = ?
				   AND binding_token = ?`,
				[params.routePoolId, params.affinityHash, params.expectedToken]
			);
			return result.affectedRows > 0;
		},

		async forceClearBinding(params): Promise<boolean> {
			const [result] = await pool.execute<ResultSetHeader>(
				`DELETE FROM route_pool_sticky_bindings
				 WHERE route_pool_id = ?
				   AND affinity_hash = ?`,
				[params.routePoolId, params.affinityHash]
			);
			return result.affectedRows > 0;
		},

		async listBindingTargetCounts(
			routePoolId,
			nowIso
		): Promise<RoutePoolStickyBindingTargetCount[]> {
			const [rows] = await pool.query<
				Array<
					{
						route_target_id: string;
						active_count: number;
						last_updated_at: string | null;
					} & RowDataPacket
				>
			>(
				`SELECT b.route_target_id AS route_target_id,
				        COUNT(*) AS active_count,
				        MAX(b.updated_at) AS last_updated_at
				 FROM route_pool_sticky_bindings b
				 JOIN route_pools p ON p.id = b.route_pool_id
				 WHERE b.route_pool_id = ?
				   AND b.pool_epoch = p.sticky_epoch
				   AND b.expires_at > ?
				 GROUP BY b.route_target_id
				 ORDER BY active_count DESC, b.route_target_id ASC`,
				[routePoolId, toMySqlDateTime(nowIso)]
			);
			return rows.map((r) => ({
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
			const nowSql = toMySqlDateTime(params.nowIso);
			const filterArgs = target
				? [params.routePoolId, nowSql, target]
				: [params.routePoolId, nowSql];
			const base = `FROM route_pool_sticky_bindings b
				 JOIN route_pools p ON p.id = b.route_pool_id
				 WHERE b.route_pool_id = ?
				   AND b.pool_epoch = p.sticky_epoch
				   AND b.expires_at > ?
				   ${targetSql}`;
			const [[list], [count]] = await Promise.all([
				pool.query<
					Array<
						{
							affinity_hash: string;
							affinity_key: string | null;
							route_target_id: string;
							expires_at: string;
							updated_at: string | null;
						} & RowDataPacket
					>
				>(
					`SELECT b.affinity_hash AS affinity_hash, b.affinity_key AS affinity_key,
					        b.route_target_id AS route_target_id, b.expires_at AS expires_at,
					        b.updated_at AS updated_at
					 ${base}
					 ORDER BY b.updated_at DESC, b.affinity_hash ASC
					 LIMIT ? OFFSET ?`,
					[...filterArgs, params.limit, params.offset]
				),
				pool.query<Array<{ cnt: number } & RowDataPacket>>(
					`SELECT COUNT(*) AS cnt ${base}`,
					filterArgs
				),
			]);
			return {
				rows: list.map((r) => ({
					affinity_hash: r.affinity_hash,
					affinity_key: r.affinity_key ?? null,
					route_target_id: r.route_target_id,
					expires_at: stringifyMySqlTime(r.expires_at) ?? '',
					updated_at: stringifyMySqlTime(r.updated_at),
				})),
				total: Number(count[0]?.cnt) || 0,
			};
		},

		async countStaleBindings(routePoolId, nowIso): Promise<number> {
			const [rows] = await pool.query<Array<{ cnt: number } & RowDataPacket>>(
				`SELECT COUNT(*) AS cnt
				 FROM route_pool_sticky_bindings b
				 JOIN route_pools p ON p.id = b.route_pool_id
				 WHERE b.route_pool_id = ?
				   AND (b.expires_at <= ? OR b.pool_epoch <> p.sticky_epoch)`,
				[routePoolId, toMySqlDateTime(nowIso)]
			);
			return Number(rows[0]?.cnt) || 0;
		},

		async deleteStaleBefore(cutoffIso, limit): Promise<number> {
			// Multi-table DELETE cannot use LIMIT in MySQL; select keys first.
			const [candidates] = await pool.query<
				Array<{ route_pool_id: string; affinity_hash: string } & RowDataPacket>
			>(
				`SELECT b.route_pool_id AS route_pool_id, b.affinity_hash AS affinity_hash
				 FROM route_pool_sticky_bindings b
				 LEFT JOIN route_pools p ON p.id = b.route_pool_id
				 WHERE b.expires_at < ?
				    OR (p.id IS NOT NULL AND b.pool_epoch <> p.sticky_epoch)
				 LIMIT ?`,
				[toMySqlDateTime(cutoffIso), limit]
			);
			if (candidates.length === 0) return 0;
			let deleted = 0;
			for (const row of candidates) {
				const [result] = await pool.execute<ResultSetHeader>(
					`DELETE FROM route_pool_sticky_bindings
					 WHERE route_pool_id = ? AND affinity_hash = ?`,
					[row.route_pool_id, row.affinity_hash]
				);
				deleted += result.affectedRows;
			}
			return deleted;
		},
	};
}
