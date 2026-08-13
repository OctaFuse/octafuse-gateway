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
					`SELECT p.id, p.name, p.endpoints, p.api_key, p.status, p.description, p.created_at,
				(SELECT COUNT(*) FROM model_routes WHERE provider_id = p.id) AS routes_count,
				(SELECT COUNT(*) FROM model_routes WHERE provider_id = p.id AND status = 'active') AS active_routes_count
			 FROM providers p ORDER BY p.created_at DESC`
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
			apiKey?: string;
			status?: string;
		}): Promise<void> {
			await raw
				.prepare(
					`INSERT INTO providers (id, name, endpoints, api_key, status, description)
			 VALUES (?, ?, ?, ?, ?, ?)`
				)
				.bind(
					params.id,
					params.name,
					params.endpoints,
					params.apiKey ?? '',
					params.status ?? 'active',
					params.description ?? null
				)
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
			const row = await raw
				.prepare(
					`SELECT p.id, p.name, p.endpoints, p.api_key, p.status, p.description, p.created_at,
				(SELECT COUNT(*) FROM model_routes WHERE provider_id = p.id) AS routes_count,
				(SELECT COUNT(*) FROM model_routes WHERE provider_id = p.id AND status = 'active') AS active_routes_count
			 FROM providers p WHERE p.id = ?`
				)
				.bind(id)
				.first<ProviderAdminRow>();
			return row ?? null;
		},

		async getProviderProtocolBases(providerId: string): Promise<ProviderProtocolBases | null> {
			return raw
				.prepare('SELECT id, endpoints FROM providers WHERE id = ?')
				.bind(providerId)
				.first<ProviderProtocolBases>();
		},

		async getProviderApiKeyPlaintext(providerId: string): Promise<{ api_key: string } | null> {
			const row = await raw
				.prepare('SELECT api_key FROM providers WHERE id = ?')
				.bind(providerId)
				.first<{ api_key: string }>();
			return row ?? null;
		},
	};
}
