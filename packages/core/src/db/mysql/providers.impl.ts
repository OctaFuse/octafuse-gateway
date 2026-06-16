/**
 * MySQL：`providers` 表（Drizzle + mysql2）。
 */
import { desc, eq } from 'drizzle-orm';
import type { ResultSetHeader } from 'mysql2/promise';
import type { ProviderRow } from '../../types';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { ProvidersRepository } from '../../storage/gateway-repository-interfaces';
import { providersTable as myProvidersTable } from '../../storage/drizzle/schema.mysql';
import type { ProviderProtocolBases } from '../providers-types';
import type { ProviderAdminRow } from '../../storage/repository-dtos';
import { PROVIDER_PATCH_COLS } from '../patch-allowlists';
import { asMySqlPool } from './mysql2-compat';

function providerRecordFromMy(r: {
	id: string;
	name: string;
	baseUrlOpenai: string | null;
	baseUrlAnthropic: string | null;
	baseUrlGemini: string | null;
	description: string | null;
	createdAt: string;
}): ProviderAdminRow {
	return {
		id: r.id,
		name: r.name,
		base_url_openai: r.baseUrlOpenai,
		base_url_anthropic: r.baseUrlAnthropic,
		base_url_gemini: r.baseUrlGemini,
		description: r.description,
		created_at: r.createdAt,
	};
}

function mapMyProviderRow(r: {
	id: string;
	name: string;
	baseUrlOpenai: string | null;
	baseUrlAnthropic: string | null;
	baseUrlGemini: string | null;
	description: string | null;
	createdAt: string;
}): ProviderRow {
	return {
		id: r.id,
		name: r.name,
		base_url_openai: r.baseUrlOpenai,
		base_url_anthropic: r.baseUrlAnthropic,
		base_url_gemini: r.baseUrlGemini,
		description: r.description,
		created_at: r.createdAt,
	};
}

export function createMySqlProvidersRepository(db: MySqlDatabaseClient): ProvidersRepository {
	const drizzle = db.drizzle;
	const pool = asMySqlPool(db.raw);

	return {
		async listProviders(): Promise<ProviderAdminRow[]> {
			const rows = await drizzle.select().from(myProvidersTable).orderBy(desc(myProvidersTable.createdAt));
			return rows.map(providerRecordFromMy);
		},

		async providerIdExists(id: string): Promise<boolean> {
			const row = await drizzle.select({ id: myProvidersTable.id }).from(myProvidersTable).where(eq(myProvidersTable.id, id)).limit(1);
			return row.length > 0;
		},

		async insertProvider(params: {
			id: string;
			name: string;
			baseUrlOpenai: string | null;
			baseUrlAnthropic: string | null;
			baseUrlGemini: string | null;
			description: unknown;
		}): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(myProvidersTable).values({
				id: params.id,
				name: params.name,
				baseUrlOpenai: params.baseUrlOpenai,
				baseUrlAnthropic: params.baseUrlAnthropic,
				baseUrlGemini: params.baseUrlGemini,
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
			const rows = await drizzle.select().from(myProvidersTable).where(eq(myProvidersTable.id, id)).limit(1);
			return rows[0] ? providerRecordFromMy(rows[0]) : null;
		},

		async getProviderProtocolBases(providerId: string): Promise<ProviderProtocolBases | null> {
			const rows = await drizzle
				.select({
					id: myProvidersTable.id,
					base_url_openai: myProvidersTable.baseUrlOpenai,
					base_url_anthropic: myProvidersTable.baseUrlAnthropic,
					base_url_gemini: myProvidersTable.baseUrlGemini,
				})
				.from(myProvidersTable)
				.where(eq(myProvidersTable.id, providerId))
				.limit(1);
			return rows[0] ?? null;
		},
	};
}
