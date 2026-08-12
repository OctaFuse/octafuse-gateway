/**
 * MySQL：`providers` 表（Drizzle + mysql2）。
 */
import { eq } from 'drizzle-orm';
import type { ResultSetHeader } from 'mysql2/promise';
import type { ProviderRow } from '../../types';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { ProvidersRepository } from '../../storage/gateway-repository-interfaces';
import { providersTable as myProvidersTable } from '../../storage/drizzle/schema.mysql';
import type { ProviderProtocolBases } from '../providers-types';
import type { ProviderAdminRow } from '../../storage/repository-dtos';
import { PROVIDER_PATCH_COLS } from '../patch-allowlists';
import { asMySqlPool } from './mysql2-compat';

const PROVIDER_LIST_WITH_ROUTE_COUNTS_SQL = `SELECT p.id, p.name, p.endpoints, p.api_key, p.status, p.description, p.created_at,
		(SELECT COUNT(*) FROM model_routes WHERE provider_id = p.id) AS routes_count,
		(SELECT COUNT(*) FROM model_routes WHERE provider_id = p.id AND status = 'active') AS active_routes_count
	FROM providers p ORDER BY p.created_at DESC`;

const PROVIDER_DETAIL_WITH_ROUTE_COUNTS_SQL = `SELECT p.id, p.name, p.endpoints, p.api_key, p.status, p.description, p.created_at,
		(SELECT COUNT(*) FROM model_routes WHERE provider_id = p.id) AS routes_count,
		(SELECT COUNT(*) FROM model_routes WHERE provider_id = p.id AND status = 'active') AS active_routes_count
	FROM providers p WHERE p.id = ?`;

function mapMyProviderRow(r: {
	id: string;
	name: string;
	endpoints: string | null;
	apiKey: string;
	status: string;
	description: string | null;
	createdAt: string;
}): ProviderRow {
	return {
		id: r.id,
		name: r.name,
		endpoints: r.endpoints,
		api_key: r.apiKey,
		status: r.status,
		description: r.description,
		created_at: r.createdAt,
	};
}

export function createMySqlProvidersRepository(db: MySqlDatabaseClient): ProvidersRepository {
	const drizzle = db.drizzle;
	const pool = asMySqlPool(db.raw);

	return {
		async listProviders(): Promise<ProviderAdminRow[]> {
			const [rows] = await pool.query<
				Array<{
					id: string;
					name: string;
					endpoints: string | null;
					api_key: string;
					status: string;
					description: string | null;
					created_at: string;
					routes_count: number;
					active_routes_count: number;
				}>
			>(PROVIDER_LIST_WITH_ROUTE_COUNTS_SQL);
			return rows.map((r) => ({
				id: r.id,
				name: r.name,
				endpoints: r.endpoints,
				api_key: r.api_key,
				status: r.status,
				description: r.description,
				created_at: r.created_at,
				routes_count: Number(r.routes_count ?? 0),
				active_routes_count: Number(r.active_routes_count ?? 0),
			}));
		},

		async providerIdExists(id: string): Promise<boolean> {
			const row = await drizzle.select({ id: myProvidersTable.id }).from(myProvidersTable).where(eq(myProvidersTable.id, id)).limit(1);
			return row.length > 0;
		},

		async insertProvider(params: {
			id: string;
			name: string;
			endpoints: string | null;
			description: unknown;
			apiKey?: string;
			status?: string;
		}): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(myProvidersTable).values({
				id: params.id,
				name: params.name,
				endpoints: params.endpoints,
				apiKey: params.apiKey ?? '',
				status: params.status ?? 'active',
				description: params.description == null ? null : String(params.description),
				createdAt: now,
			});
		},

		async updateProviderByPatch(id: string, body: Record<string, unknown>): Promise<number> {
			const patch: string[] = [];
			const bindValues: unknown[] = [];
			for (const [key, value] of Object.entries(body)) {
				if (key === 'id' || value === undefined) continue;
				if (!PROVIDER_PATCH_COLS.has(key)) continue;
				patch.push(`${key} = ?`);
				bindValues.push(value);
			}
			if (patch.length === 0) return 0;
			const [result] = await pool.execute<ResultSetHeader>(`UPDATE providers SET ${patch.join(', ')} WHERE id = ?`, [...bindValues, id]);
			return result.affectedRows;
		},

		async deleteProviderById(id: string): Promise<number> {
			const [result] = await pool.execute<ResultSetHeader>('DELETE FROM providers WHERE id = ?', [id]);
			return result.affectedRows;
		},

		async getProviderById(id: string): Promise<ProviderRow | null> {
			const rows = await drizzle.select().from(myProvidersTable).where(eq(myProvidersTable.id, id)).limit(1);
			return rows[0] ? mapMyProviderRow(rows[0]) : null;
		},

		async getProviderRowById(id: string): Promise<ProviderAdminRow | null> {
			const [rows] = await pool.query<
				Array<{
					id: string;
					name: string;
					endpoints: string | null;
					api_key: string;
					status: string;
					description: string | null;
					created_at: string;
					routes_count: number;
					active_routes_count: number;
				}>
			>(PROVIDER_DETAIL_WITH_ROUTE_COUNTS_SQL, [id]);
			const r = rows[0];
			if (!r) return null;
			return {
				id: r.id,
				name: r.name,
				endpoints: r.endpoints,
				api_key: r.api_key,
				status: r.status,
				description: r.description,
				created_at: r.created_at,
				routes_count: Number(r.routes_count ?? 0),
				active_routes_count: Number(r.active_routes_count ?? 0),
			};
		},

		async getProviderProtocolBases(providerId: string): Promise<ProviderProtocolBases | null> {
			const rows = await drizzle
				.select({
					id: myProvidersTable.id,
					endpoints: myProvidersTable.endpoints,
				})
				.from(myProvidersTable)
				.where(eq(myProvidersTable.id, providerId))
				.limit(1);
			return rows[0] ?? null;
		},

		async getProviderApiKeyPlaintext(providerId: string): Promise<{ api_key: string } | null> {
			const rows = await drizzle
				.select({ api_key: myProvidersTable.apiKey })
				.from(myProvidersTable)
				.where(eq(myProvidersTable.id, providerId))
				.limit(1);
			return rows[0] ?? null;
		},
	};
}
