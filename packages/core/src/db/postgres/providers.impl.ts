/**
 * Postgres：`providers` 表（Drizzle）。
 */
import { desc, eq } from 'drizzle-orm';
import type { ProviderRow } from '../../types';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { ProvidersRepository } from '../../storage/gateway-repository-interfaces';
import { providersTable as pgProvidersTable } from '../../storage/drizzle/schema.pg';
import type { ProviderProtocolBases } from '../providers-types';
import type { ProviderAdminRow } from '../../storage/repository-dtos';
import { PROVIDER_PATCH_COLS } from '../patch-allowlists';

function snakeToCamel(key: string): string {
	return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function mapPgProviderRow(r: {
	id: string;
	name: string;
	endpoints: string | null;
	description: string | null;
	createdAt: string;
}): ProviderRow {
	return {
		id: r.id,
		name: r.name,
		endpoints: r.endpoints,
		description: r.description,
		created_at: r.createdAt,
	};
}

function providerRecordFromPg(r: {
	id: string;
	name: string;
	endpoints: string | null;
	description: string | null;
	createdAt: string;
}): ProviderAdminRow {
	return {
		id: r.id,
		name: r.name,
		endpoints: r.endpoints,
		description: r.description,
		created_at: r.createdAt,
	};
}

export function createPostgresProvidersRepository(db: PostgresDatabaseClient): ProvidersRepository {
	const drizzle = db.drizzle;
	return {
		async listProviders(): Promise<ProviderAdminRow[]> {
			const rows = await drizzle.select().from(pgProvidersTable).orderBy(desc(pgProvidersTable.createdAt));
			return rows.map(providerRecordFromPg);
		},

		async providerIdExists(id: string): Promise<boolean> {
			const row = await drizzle.select({ id: pgProvidersTable.id }).from(pgProvidersTable).where(eq(pgProvidersTable.id, id)).limit(1);
			return row.length > 0;
		},

		async insertProvider(params: {
			id: string;
			name: string;
			endpoints: string | null;
			description: unknown;
		}): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(pgProvidersTable).values({
				id: params.id,
				name: params.name,
				endpoints: params.endpoints,
				description: params.description == null ? null : String(params.description),
				createdAt: now,
			});
		},

		async updateProviderByPatch(id: string, body: Record<string, unknown>): Promise<number> {
			const set: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(body)) {
				if (key === 'id' || value === undefined) continue;
				if (!PROVIDER_PATCH_COLS.has(key)) continue;
				const camel = snakeToCamel(key);
				set[camel] = value;
			}
			if (Object.keys(set).length === 0) return 0;
			const updated = await drizzle
				.update(pgProvidersTable)
				.set(set as Record<string, never>)
				.where(eq(pgProvidersTable.id, id))
				.returning({ id: pgProvidersTable.id });
			return updated.length;
		},

		async deleteProviderById(id: string): Promise<number> {
			const deleted = await drizzle.delete(pgProvidersTable).where(eq(pgProvidersTable.id, id)).returning({ id: pgProvidersTable.id });
			return deleted.length;
		},

		async getProviderById(id: string): Promise<ProviderRow | null> {
			const rows = await drizzle.select().from(pgProvidersTable).where(eq(pgProvidersTable.id, id)).limit(1);
			return rows[0] ? mapPgProviderRow(rows[0]) : null;
		},

		async getProviderRowById(id: string): Promise<ProviderAdminRow | null> {
			const row = await drizzle.select().from(pgProvidersTable).where(eq(pgProvidersTable.id, id)).limit(1);
			return row[0] ? providerRecordFromPg(row[0]) : null;
		},

		async getProviderProtocolBases(providerId: string): Promise<ProviderProtocolBases | null> {
			const rows = await drizzle
				.select({
					id: pgProvidersTable.id,
					endpoints: pgProvidersTable.endpoints,
				})
				.from(pgProvidersTable)
				.where(eq(pgProvidersTable.id, providerId))
				.limit(1);
			return rows[0] ?? null;
		},
	};
}
