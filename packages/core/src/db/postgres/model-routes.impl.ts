/**
 * Postgres：`model_routes`（Drizzle）。
 */
import { and, desc, eq } from 'drizzle-orm';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { ModelRoutesRepository } from '../../storage/gateway-repository-interfaces';
import type { ModelRouteDetailRow, ModelRouteJoinRow } from '../../storage/repository-dtos';
import { modelRoutesTable as pgMr, modelsTable as pgModels, providersTable as pgProviders } from '../../storage/drizzle/schema.pg';

function snakeToCamel(key: string): string {
	return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function createPostgresModelRoutesRepository(db: PostgresDatabaseClient): ModelRoutesRepository {
	const drizzle = db.drizzle;
	return {
		async listModelRoutesWithJoins(filters: { modelId?: string; providerId?: string }): Promise<ModelRouteJoinRow[]> {
			const conditions = [];
			if (filters.modelId) conditions.push(eq(pgMr.modelId, filters.modelId));
			if (filters.providerId) conditions.push(eq(pgMr.providerId, filters.providerId));
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
					price_override: pgMr.priceOverride,
					custom_params: pgMr.customParams,
					upstream_protocol: pgMr.upstreamProtocol,
					model_name: pgModels.displayName,
					provider_name: pgProviders.name,
				})
				.from(pgMr)
				.leftJoin(pgModels, eq(pgMr.modelId, pgModels.id))
				.leftJoin(pgProviders, eq(pgMr.providerId, pgProviders.id))
				.orderBy(pgMr.modelId, desc(pgMr.priority));
			if (whereExpr) {
				q = q.where(whereExpr) as typeof q;
			}
			const list = await q;
			return list.map((r) => ({
				id: r.id,
				model_id: r.model_id,
				provider_id: r.provider_id,
				provider_model_name: r.provider_model_name,
				priority: Number(r.priority),
				status: r.status,
				route_group: r.route_group,
				price_override: r.price_override,
				custom_params: r.custom_params,
				upstream_protocol: r.upstream_protocol,
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
			priceOverride: unknown;
			customParams: string | null;
			upstreamProtocol: string;
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
				priceOverride: params.priceOverride == null ? null : String(params.priceOverride),
				customParams: params.customParams,
				upstreamProtocol: params.upstreamProtocol,
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
				price_override: r.priceOverride,
				custom_params: r.customParams,
				upstream_protocol: r.upstreamProtocol,
				created_at: r.createdAt,
			};
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
	};
}
