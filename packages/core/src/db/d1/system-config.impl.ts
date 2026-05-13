/**
 * D1：`system_config`。
 */
import type { D1DatabaseClient } from '../../storage/database-client';
import type { SystemConfigRepository } from '../../storage/gateway-repository-interfaces';
import type { SystemConfigRow } from '../system-config-types';

export function createD1SystemConfigRepository(db: D1DatabaseClient): SystemConfigRepository {
	const raw = db.raw;
	return {
		async listSystemConfigRows(): Promise<SystemConfigRow[]> {
			const rows = await raw.prepare('SELECT key, value, description FROM system_config ORDER BY key').all<SystemConfigRow>();
			return rows.results ?? [];
		},

		async upsertSystemConfigValue(key: string, value: string): Promise<void> {
			await raw
				.prepare(
					'INSERT INTO system_config (key, value, description, updated_at) VALUES (?, ?, NULL, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')'
				)
				.bind(key, value)
				.run();
		},

		async getConfig(key: string): Promise<string | null> {
			const row = await raw
				.prepare('SELECT value FROM system_config WHERE key = ?')
				.bind(key)
				.first<{ value: string | null }>();
			return row?.value ?? null;
		},

		async getAllConfig(): Promise<Record<string, string>> {
			const rows = await raw.prepare('SELECT key, value FROM system_config').all<{ key: string; value: string | null }>();
			const out: Record<string, string> = {};
			for (const row of rows.results ?? []) {
				if (row.value != null) out[row.key] = row.value;
			}
			return out;
		},
	};
}
