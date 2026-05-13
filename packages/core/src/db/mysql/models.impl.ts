/**
 * MySQL：`models` / `model_tags`。
 */
import type { ResultSetHeader } from 'mysql2/promise';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { ModelsRepository } from '../../storage/gateway-repository-interfaces';
import type { ModelWithRouteCountsRow } from '../../storage/repository-dtos';
import { modelsTable as myModelsTable } from '../../storage/drizzle/schema.mysql';
import { MODEL_PATCH_COLS } from '../patch-allowlists';
import { asMySqlPool } from './mysql2-compat';

const MODEL_LIST_WITH_ROUTE_COUNTS_SQL = `SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens,
		m.pricing_profile, m.supports_images,
		CAST(COALESCE((SELECT JSON_ARRAYAGG(mt.tag ORDER BY mt.tag) FROM model_tags mt WHERE mt.model_id = m.id), JSON_ARRAY()) AS CHAR) AS tags,
		m.description, m.metadata, m.created_at,
		(SELECT COUNT(*) FROM model_routes WHERE model_id = m.id) AS routes_count,
		(SELECT COUNT(*) FROM model_routes WHERE model_id = m.id AND status = 'active') AS active_routes_count
	FROM models m ORDER BY m.id ASC`;

const MODEL_DETAIL_WITH_ROUTE_COUNTS_SQL = `SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens,
		m.pricing_profile, m.supports_images,
		CAST(COALESCE((SELECT JSON_ARRAYAGG(mt.tag ORDER BY mt.tag) FROM model_tags mt WHERE mt.model_id = m.id), JSON_ARRAY()) AS CHAR) AS tags,
		m.description, m.metadata, m.created_at,
		(SELECT COUNT(*) FROM model_routes WHERE model_id = m.id) AS routes_count,
		(SELECT COUNT(*) FROM model_routes WHERE model_id = m.id AND status = 'active') AS active_routes_count
	FROM models m WHERE m.id = ?`;

export function createMySqlModelsRepository(db: MySqlDatabaseClient): ModelsRepository {
	const drizzle = db.drizzle;
	const pool = asMySqlPool(db.raw);

	return {
		async listModelsWithRouteCounts(): Promise<ModelWithRouteCountsRow[]> {
			const [rows] = await pool.query<ModelWithRouteCountsRow[]>(MODEL_LIST_WITH_ROUTE_COUNTS_SQL);
			return rows;
		},

		async getModelDetailWithRouteCounts(id: string): Promise<ModelWithRouteCountsRow | null> {
			const [rows] = await pool.query<ModelWithRouteCountsRow[]>(MODEL_DETAIL_WITH_ROUTE_COUNTS_SQL, [id]);
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
			await drizzle.insert(myModelsTable).values({
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
			const conn = await pool.getConnection();
			try {
				await conn.beginTransaction();
				await conn.execute('DELETE FROM model_tags WHERE model_id = ?', [modelId]);
				for (const tag of tags) {
					const t = String(tag).trim();
					if (t) {
						await conn.execute('INSERT INTO model_tags (model_id, tag) VALUES (?, ?)', [modelId, t]);
					}
				}
				await conn.commit();
			} catch (error) {
				await conn.rollback();
				throw error;
			} finally {
				conn.release();
			}
		},

		async updateModelByPatch(id: string, rest: Record<string, unknown>): Promise<number> {
			const patch: string[] = [];
			const bindValues: unknown[] = [];
			for (const [key, value] of Object.entries(rest)) {
				if (key === 'id' || value === undefined) continue;
				if (!MODEL_PATCH_COLS.has(key)) continue;
				patch.push(`${key} = ?`);
				bindValues.push(value);
			}
			if (patch.length === 0) return 0;
			const [result] = await pool.execute<ResultSetHeader>(`UPDATE models SET ${patch.join(', ')} WHERE id = ?`, [...bindValues, id]);
			return result.affectedRows;
		},

		async deleteModelCascade(id: string): Promise<number> {
			const conn = await pool.getConnection();
			try {
				await conn.beginTransaction();
				await conn.execute('DELETE FROM model_routes WHERE model_id = ?', [id]);
				await conn.execute('DELETE FROM model_tags WHERE model_id = ?', [id]);
				const [result] = await conn.execute<ResultSetHeader>('DELETE FROM models WHERE id = ?', [id]);
				await conn.commit();
				return result.affectedRows;
			} catch (error) {
				await conn.rollback();
				throw error;
			} finally {
				conn.release();
			}
		},
	};
}
