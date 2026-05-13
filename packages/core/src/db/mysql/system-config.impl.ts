/**
 * MySQL：`system_config`。
 */
import { eq } from 'drizzle-orm';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { SystemConfigRepository } from '../../storage/gateway-repository-interfaces';
import { systemConfigTable as mySystemConfigTable } from '../../storage/drizzle/schema.mysql';
import type { SystemConfigRow } from '../system-config-types';
import { asMySqlPool } from './mysql2-compat';

export function createMySqlSystemConfigRepository(db: MySqlDatabaseClient): SystemConfigRepository {
	const drizzle = db.drizzle;
	const pool = asMySqlPool(db.raw);
	return {
		async listSystemConfigRows(): Promise<SystemConfigRow[]> {
			return drizzle
				.select({
					key: mySystemConfigTable.key,
					value: mySystemConfigTable.value,
					description: mySystemConfigTable.description,
				})
				.from(mySystemConfigTable)
				.orderBy(mySystemConfigTable.key);
		},

		async upsertSystemConfigValue(key: string, value: string): Promise<void> {
			const now = new Date().toISOString();
			await pool.execute(
				`INSERT INTO system_config (\`key\`, value, description, updated_at)
				 VALUES (?, ?, NULL, ?)
				 ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
				[key, value, now]
			);
		},

		async getConfig(key: string): Promise<string | null> {
			const row = await drizzle
				.select({ value: mySystemConfigTable.value })
				.from(mySystemConfigTable)
				.where(eq(mySystemConfigTable.key, key))
				.limit(1);
			return row[0]?.value ?? null;
		},

		async getAllConfig(): Promise<Record<string, string>> {
			const rows = await drizzle.select({ key: mySystemConfigTable.key, value: mySystemConfigTable.value }).from(mySystemConfigTable);
			const out: Record<string, string> = {};
			for (const row of rows) {
				if (row.value != null) out[row.key] = row.value;
			}
			return out;
		},
	};
}
