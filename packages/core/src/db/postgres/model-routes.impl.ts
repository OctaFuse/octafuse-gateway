/**
 * Postgres：`model_routes`（Drizzle）。
 */
import { and, desc, eq } from 'drizzle-orm';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type {
	ListModelRoutesWithJoinsFilters,
	ModelRoutesRepository,
} from '../../storage/gateway-repository-interfaces';
import type { ModelRouteDetailRow, ModelRouteJoinRow } from '../../storage/repository-dtos';
import {
	modelRoutesTable as pgMr,
	modelsTable as pgModels,
	providersTable as pgProviders,
	routePoolsTable as pgPools,
} from '../../storage/drizzle/schema.pg';

function snakeToCamel(key: string): string {
	return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function createPostgresModelRoutesRepository(db: PostgresDatabaseClient): ModelRoutesRepository {
	const drizzle = db.drizzle;
	const pg = db.raw;
	return {
		async listModelRoutesWithJoins(filters: ListModelRoutesWithJoinsFilters): Promise<ModelRouteJoinRow[]> {
			const conditions = [];
			if (filters.modelId) conditions.push(eq(pgMr.modelId, filters.modelId));
			if (filters.providerId) conditions.push(eq(pgMr.providerId, filters.providerId));
			if (filters.status === 'active') conditions.push(eq(pgMr.status, 'active'));
			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;
			let q = drizzle
				.select({
					id: pgMr.id,
					model_id: pgMr.modelId,
					provider_id: pgMr.providerId,
					provider_model_name: pgMr.providerModelName,
					priority: pgMr.priority,
					status: pgMr.status,
					route_group: pgMr.routeGroup,
					weight: pgMr.weight,
					price_override: pgMr.priceOverride,
					custom_params: pgMr.customParams,
					upstream_protocol: pgMr.upstreamProtocol,
					route_pool_id: pgMr.routePoolId,
					upstream_operation: pgMr.upstreamOperation,
					adapter: pgMr.adapter,
					pool_name: pgPools.name,
					pool_strategy: pgPools.strategy,
					pool_tier_strategies: pgPools.tierStrategies,
					pool_status: pgPools.status,
					pool_sticky_enabled: pgPools.stickyEnabled,
					pool_sticky_idle_ttl_seconds: pgPools.stickyIdleTtlSeconds,
					pool_sticky_epoch: pgPools.stickyEpoch,
					model_name: pgModels.displayName,
					provider_name: pgProviders.name,
				})
				.from(pgMr)
				.leftJoin(pgModels, eq(pgMr.modelId, pgModels.id))
				.leftJoin(pgProviders, eq(pgMr.providerId, pgProviders.id))
				.leftJoin(pgPools, eq(pgMr.routePoolId, pgPools.id))
				.orderBy(pgMr.modelId, desc(pgMr.priority));
			if (whereExpr) {
				q = q.where(whereExpr) as typeof q;
			}
			const list = await q;
			const surfacesByPool = new Map<string, string>();
			const poolIds = [...new Set(list.map((r) => r.route_pool_id).filter((id): id is string => Boolean(id)))];
			if (poolIds.length > 0) {
				const surfaceRows = await pg<Array<{ route_pool_id: string; surfaces: string }>>`
					SELECT route_pool_id,
						json_agg(json_build_object(
							'id', id,
							'request_protocol', request_protocol,
							'request_operation', request_operation,
							'status', status
						) ORDER BY request_protocol, request_operation)::text AS surfaces
					FROM model_surfaces
					WHERE route_pool_id = ANY(${poolIds})
					GROUP BY route_pool_id
				`;
				for (const row of surfaceRows) surfacesByPool.set(row.route_pool_id, row.surfaces);
			}
			return list.map((r) => ({
				id: r.id,
				model_id: r.model_id,
				provider_id: r.provider_id,
				provider_model_name: r.provider_model_name,
				priority: Number(r.priority),
				status: r.status,
				route_group: r.route_group,
				weight: Number(r.weight),
				price_override: r.price_override,
				custom_params: r.custom_params,
				upstream_protocol: r.upstream_protocol,
				route_pool_id: r.route_pool_id,
				upstream_operation: r.upstream_operation,
				adapter: r.adapter,
				surfaces: r.route_pool_id ? (surfacesByPool.get(r.route_pool_id) ?? '[]') : '[]',
				pool_name: r.pool_name,
				pool_strategy: r.pool_strategy,
				pool_tier_strategies: r.pool_tier_strategies,
				pool_status: r.pool_status,
				pool_sticky_enabled: r.pool_sticky_enabled,
				pool_sticky_idle_ttl_seconds:
					r.pool_sticky_idle_ttl_seconds == null
						? null
						: Number(r.pool_sticky_idle_ttl_seconds),
				pool_sticky_epoch:
					r.pool_sticky_epoch == null ? null : Number(r.pool_sticky_epoch),
				model_name: r.model_name,
				provider_name: r.provider_name,
			}));
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
			const now = new Date().toISOString();
			await drizzle.insert(pgMr).values({
				id: params.id,
				modelId: params.modelId,
				providerId: params.providerId,
				providerModelName: params.providerModelName,
				priority: params.priority,
				status: params.status,
				routeGroup: params.routeGroup,
				weight: params.weight ?? 1,
				priceOverride: params.priceOverride == null ? null : String(params.priceOverride),
				customParams: params.customParams,
				upstreamProtocol: params.upstreamProtocol,
				routePoolId: params.routePoolId,
				upstreamOperation: params.upstreamOperation,
				adapter: params.adapter,
				createdAt: now,
			});
		},

		async getModelRouteRowById(id: string): Promise<ModelRouteDetailRow | null> {
			const rows = await drizzle.select().from(pgMr).where(eq(pgMr.id, id)).limit(1);
			if (!rows[0]) return null;
			const r = rows[0];
			return {
				id: r.id,
				model_id: r.modelId,
				provider_id: r.providerId,
				provider_model_name: r.providerModelName,
				priority: r.priority,
				status: r.status,
				route_group: r.routeGroup,
				weight: r.weight,
				price_override: r.priceOverride,
				custom_params: r.customParams,
				upstream_protocol: r.upstreamProtocol,
				route_pool_id: r.routePoolId,
				upstream_operation: r.upstreamOperation,
				adapter: r.adapter,
				created_at: r.createdAt,
			};
		},

		async ensureModelSurfacePool(params): Promise<{ poolId: string; surfaceId: string }> {
			const existing = await pg<Array<{ id: string; route_pool_id: string }>>`
				SELECT id, route_pool_id
				FROM model_surfaces
				WHERE model_id = ${params.modelId}
				  AND lower(route_group) = lower(${params.routeGroup})
				  AND lower(request_protocol) = lower(${params.requestProtocol})
				  AND request_operation = ${params.requestOperation}
				LIMIT 1
			`;
			if (existing[0]) {
				return { poolId: existing[0].route_pool_id, surfaceId: existing[0].id };
			}

			await pg.begin(async (tx) => {
				await tx`
					INSERT INTO route_pools
						(id, model_id, route_group, name, strategy, status, created_at, updated_at)
					VALUES (
						${params.poolId}, ${params.modelId}, ${params.routeGroup}, ${params.poolName},
						NULL, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
					)
				`;
				await tx`
					INSERT INTO model_surfaces
						(id, model_id, route_group, request_protocol, request_operation, route_pool_id, status, created_at, updated_at)
					VALUES (
						${params.surfaceId}, ${params.modelId}, ${params.routeGroup},
						${params.requestProtocol}, ${params.requestOperation}, ${params.poolId},
						'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
					)
				`;
			});
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
			const stickyTouched =
				patch.stickyEnabled !== undefined || patch.stickyIdleTtlSeconds !== undefined;
			if (
				patch.strategy === undefined &&
				patch.tierStrategies === undefined &&
				!stickyTouched
			) {
				return 0;
			}
			const rows = await pg<Array<{ id: string }>>`
				UPDATE route_pools
				SET
					strategy = CASE WHEN ${patch.strategy !== undefined} THEN ${patch.strategy ?? null} ELSE strategy END,
					tier_strategies = CASE WHEN ${patch.tierStrategies !== undefined} THEN ${patch.tierStrategies ?? null} ELSE tier_strategies END,
					sticky_enabled = CASE WHEN ${patch.stickyEnabled !== undefined} THEN ${patch.stickyEnabled ?? false} ELSE sticky_enabled END,
					sticky_idle_ttl_seconds = CASE WHEN ${patch.stickyIdleTtlSeconds !== undefined} THEN ${patch.stickyIdleTtlSeconds ?? 3600} ELSE sticky_idle_ttl_seconds END,
					sticky_epoch = CASE WHEN ${stickyTouched} THEN sticky_epoch + 1 ELSE sticky_epoch END,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ${poolId}
				RETURNING id
			`;
			return rows.length;
		},

		async bumpRoutePoolStickyEpoch(poolId: string): Promise<number | null> {
			const rows = await pg<Array<{ sticky_epoch: number | string }>>`
				UPDATE route_pools
				SET sticky_epoch = sticky_epoch + 1,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ${poolId}
				RETURNING sticky_epoch
			`;
			if (!rows[0]) return null;
			return Number(rows[0].sticky_epoch);
		},

		async updateModelRouteByPatch(id: string, patch: Record<string, unknown>): Promise<number> {
			const set: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(patch)) {
				if (value === undefined) continue;
				const camel = snakeToCamel(key);
				set[camel] = value;
			}
			if (Object.keys(set).length === 0) return 0;
			const updated = await drizzle
				.update(pgMr)
				.set(set as Record<string, never>)
				.where(eq(pgMr.id, id))
				.returning({ id: pgMr.id });
			return updated.length;
		},

		async deleteModelRouteById(id: string): Promise<number> {
			const deleted = await drizzle.delete(pgMr).where(eq(pgMr.id, id)).returning({ id: pgMr.id });
			return deleted.length;
		},

		async deleteRoutePoolIfEmpty(poolId: string): Promise<boolean> {
			const remaining = await pg<Array<{ ok: number }>>`
				SELECT 1 AS ok FROM model_routes WHERE route_pool_id = ${poolId} LIMIT 1
			`;
			if (remaining[0]) return false;
			await pg.begin(async (tx) => {
				await tx`DELETE FROM model_surfaces WHERE route_pool_id = ${poolId}`;
				await tx`DELETE FROM route_pools WHERE id = ${poolId}`;
			});
			return true;
		},
	};
}
