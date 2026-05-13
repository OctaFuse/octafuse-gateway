/**
 * Postgres：`models` / `model_tags`。
 */
import { eq } from 'drizzle-orm';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { ModelsRepository } from '../../storage/gateway-repository-interfaces';
import type { ModelWithRouteCountsRow } from '../../storage/repository-dtos';
import { modelsTable as pgModelsTable } from '../../storage/drizzle/schema.pg';

function snakeToCamel(key: string): string {
	return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function createPostgresModelsRepository(db: PostgresDatabaseClient): ModelsRepository {
	const drizzle = db.drizzle;
	const pg = db.raw;
	return {
		async listModelsWithRouteCounts(): Promise<ModelWithRouteCountsRow[]> {
			const rows = await pg<ModelWithRouteCountsRow[]>`
		SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens,
			m.pricing_profile, m.supports_images,
			(SELECT COALESCE(json_agg(mt.tag ORDER BY mt.tag)::text, '[]') FROM model_tags mt WHERE mt.model_id = m.id) AS tags,
			m.description, m.metadata, m.created_at::text,
			(SELECT COUNT(*)::int FROM model_routes WHERE model_id = m.id) AS routes_count,
			(SELECT COUNT(*)::int FROM model_routes WHERE model_id = m.id AND status = 'active') AS active_routes_count
		FROM models m ORDER BY m.id ASC
	`;
			return rows;
		},

		async getModelDetailWithRouteCounts(id: string): Promise<ModelWithRouteCountsRow | null> {
			const rows = await pg<ModelWithRouteCountsRow[]>`
		SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens,
			m.pricing_profile, m.supports_images,
			(SELECT COALESCE(json_agg(mt.tag ORDER BY mt.tag)::text, '[]') FROM model_tags mt WHERE mt.model_id = m.id) AS tags,
			m.description, m.metadata, m.created_at::text,
			(SELECT COUNT(*)::int FROM model_routes WHERE model_id = m.id) AS routes_count,
			(SELECT COUNT(*)::int FROM model_routes WHERE model_id = m.id AND status = 'active') AS active_routes_count
		FROM models m WHERE m.id = ${id}
	`;
			return rows[0] ?? null;
		},

		async insertModel(params: {
			id: string;
			displayName: unknown;
			vendor: string;
			contextWindow: unknown;
			maxTokens: unknown;
			pricingProfile?: unknown;
			supportsImages: unknown;
			description: unknown;
			metadata: unknown;
		}): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(pgModelsTable).values({
				id: params.id,
				displayName: params.displayName == null ? null : String(params.displayName),
				vendor: params.vendor,
				contextWindow: params.contextWindow == null ? null : Number(params.contextWindow),
				maxTokens: params.maxTokens == null ? 8192 : Number(params.maxTokens),
				pricingProfile: params.pricingProfile == null ? null : String(params.pricingProfile),
				supportsImages: Number(params.supportsImages ?? 0),
				description: params.description == null ? null : String(params.description),
				metadata: params.metadata == null ? null : String(params.metadata),
				createdAt: now,
			});
		},

		async replaceModelTags(modelId: string, tags: string[]): Promise<void> {
			await pg.begin(async (sqlTx) => {
				await sqlTx`DELETE FROM model_tags WHERE model_id = ${modelId}`;
				for (const tag of tags) {
					const t = String(tag).trim();
					if (t) {
						await sqlTx`INSERT INTO model_tags (model_id, tag) VALUES (${modelId}, ${t})`;
					}
				}
			});
		},

		async updateModelByPatch(id: string, rest: Record<string, unknown>): Promise<number> {
			const set: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(rest)) {
				if (key === 'id' || value === undefined) continue;
				const camel = snakeToCamel(key);
				if (camel === 'pricingProfile' && value != null) {
					set[camel] = String(value);
				} else {
					set[camel] = value;
				}
			}
			if (Object.keys(set).length === 0) return 0;
			const updated = await drizzle
				.update(pgModelsTable)
				.set(set as Record<string, never>)
				.where(eq(pgModelsTable.id, id))
				.returning({ id: pgModelsTable.id });
			return updated.length;
		},

		async deleteModelCascade(id: string): Promise<number> {
			let n = 0;
			await pg.begin(async (sqlTx) => {
				await sqlTx`DELETE FROM model_routes WHERE model_id = ${id}`;
				await sqlTx`DELETE FROM model_tags WHERE model_id = ${id}`;
				const deleted = await sqlTx<{ id: string }[]>`DELETE FROM models WHERE id = ${id} RETURNING id`;
				n = deleted.length;
			});
			return n;
		},
	};
}
