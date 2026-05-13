/**
 * Postgres：`system_config`（Drizzle）。
 */
import { eq } from 'drizzle-orm';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { SystemConfigRepository } from '../../storage/gateway-repository-interfaces';
import { systemConfigTable as pgSystemConfigTable } from '../../storage/drizzle/schema.pg';
import type { SystemConfigRow } from '../system-config-types';

export function createPostgresSystemConfigRepository(db: PostgresDatabaseClient): SystemConfigRepository {
	const drizzle = db.drizzle;
	return {
		async listSystemConfigRows(): Promise<SystemConfigRow[]> {
			return drizzle
				.select({
					key: pgSystemConfigTable.key,
					value: pgSystemConfigTable.value,
					description: pgSystemConfigTable.description,
				})
				.from(pgSystemConfigTable)
				.orderBy(pgSystemConfigTable.key);
		},

		async upsertSystemConfigValue(key: string, value: string): Promise<void> {
			const now = new Date().toISOString();
			await drizzle
				.insert(pgSystemConfigTable)
				.values({ key, value, description: null, updatedAt: now })
				.onConflictDoUpdate({
					target: pgSystemConfigTable.key,
					set: { value, updatedAt: now },
				});
		},

		async getConfig(key: string): Promise<string | null> {
			const row = await drizzle
				.select({ value: pgSystemConfigTable.value })
				.from(pgSystemConfigTable)
				.where(eq(pgSystemConfigTable.key, key))
				.limit(1);
			return row[0]?.value ?? null;
		},

		async getAllConfig(): Promise<Record<string, string>> {
			const rows = await drizzle.select({ key: pgSystemConfigTable.key, value: pgSystemConfigTable.value }).from(pgSystemConfigTable);
			const out: Record<string, string> = {};
			for (const row of rows) {
				if (row.value != null) out[row.key] = row.value;
			}
			return out;
		},
	};
}
