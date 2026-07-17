/**
 * D1：`providers` 表。
 */
import type { ProviderRow } from '../../types';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { ProvidersRepository } from '../../storage/gateway-repository-interfaces';
import type { ProviderAdminRow } from '../../storage/repository-dtos';
import type { ProviderProtocolBases } from '../providers-types';
import { PROVIDER_PATCH_COLS } from '../patch-allowlists';

export function createD1ProvidersRepository(db: D1DatabaseClient): ProvidersRepository {
	const raw = db.raw;
	return {
		async listProviders(): Promise<ProviderAdminRow[]> {
			const rows = await raw
				.prepare(
					`SELECT id, name, endpoints, description, created_at
			 FROM providers ORDER BY created_at DESC`
				)
				.all<ProviderAdminRow>();
			return rows.results ?? [];
		},

		async providerIdExists(id: string): Promise<boolean> {
			const row = await raw.prepare('SELECT id FROM providers WHERE id = ?').bind(id).first();
			return !!row;
		},

		async insertProvider(params: {
			id: string;
			name: string;
			endpoints: string | null;
			description: unknown;
		}): Promise<void> {
			await raw
				.prepare(
					`INSERT INTO providers (id, name, endpoints, description)
			 VALUES (?, ?, ?, ?)`
				)
				.bind(params.id, params.name, params.endpoints, params.description ?? null)
				.run();
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
			const result = await raw.prepare(`UPDATE providers SET ${patch.join(', ')} WHERE id = ?`).bind(...bindValues, id).run();
			return result.meta.changes;
		},

		async deleteProviderById(id: string): Promise<number> {
			const deleted = await raw.prepare('DELETE FROM providers WHERE id = ?').bind(id).run();
			return deleted.meta.changes;
		},

		async getProviderById(id: string): Promise<ProviderRow | null> {
			return raw.prepare('SELECT * FROM providers WHERE id = ?').bind(id).first<ProviderRow>();
		},

		async getProviderRowById(id: string): Promise<ProviderAdminRow | null> {
			const row = await raw.prepare('SELECT * FROM providers WHERE id = ?').bind(id).first<ProviderAdminRow>();
			return row ?? null;
		},

		async getProviderProtocolBases(providerId: string): Promise<ProviderProtocolBases | null> {
			return raw
				.prepare('SELECT id, endpoints FROM providers WHERE id = ?')
				.bind(providerId)
				.first<ProviderProtocolBases>();
		},
	};
}
