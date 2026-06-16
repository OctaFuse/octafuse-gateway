/**
 * Postgres：`provider_api_keys` 表（Drizzle）。
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { ProviderApiKeysRepository } from '../../storage/gateway-repository-interfaces';
import {
	providerApiKeysTable as pgProviderApiKeysTable,
} from '../../storage/drizzle/schema.pg';
import type {
	ActiveProviderApiKeyRow,
	InsertProviderApiKeyParams,
	ProviderApiKeyAdminRow,
	UpdateProviderApiKeyPatch,
} from '../provider-api-keys-types';
import { fingerprintProviderApiKey, isPendingProviderImportApiKey } from '../provider-key-utils';

function mapAdminRow(r: {
	id: string;
	providerId: string;
	label: string;
	apiKey: string;
	status: string;
	weight: number;
	priority: number;
	createdAt: string;
	updatedAt: string;
}): ProviderApiKeyAdminRow {
	return {
		id: r.id,
		provider_id: r.providerId,
		label: r.label,
		status: r.status,
		weight: r.weight,
		priority: r.priority,
		fingerprint: fingerprintProviderApiKey(r.apiKey),
		is_pending_import: isPendingProviderImportApiKey(r.apiKey),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function createPostgresProviderApiKeysRepository(db: PostgresDatabaseClient): ProviderApiKeysRepository {
	const drizzle = db.drizzle;
	return {
		async listProviderKeys(providerId: string): Promise<ProviderApiKeyAdminRow[]> {
			const rows = await drizzle
				.select()
				.from(pgProviderApiKeysTable)
				.where(eq(pgProviderApiKeysTable.providerId, providerId))
				.orderBy(desc(pgProviderApiKeysTable.priority), asc(pgProviderApiKeysTable.createdAt));
			return rows.map(mapAdminRow);
		},

		async getActiveProviderKeys(providerId: string): Promise<ActiveProviderApiKeyRow[]> {
			const rows = await drizzle
				.select({
					id: pgProviderApiKeysTable.id,
					label: pgProviderApiKeysTable.label,
					api_key: pgProviderApiKeysTable.apiKey,
					weight: pgProviderApiKeysTable.weight,
					priority: pgProviderApiKeysTable.priority,
				})
				.from(pgProviderApiKeysTable)
				.where(and(eq(pgProviderApiKeysTable.providerId, providerId), eq(pgProviderApiKeysTable.status, 'active')))
				.orderBy(desc(pgProviderApiKeysTable.priority), asc(pgProviderApiKeysTable.createdAt));
			const keys: ActiveProviderApiKeyRow[] = rows.map((r) => ({
				id: r.id,
				label: r.label,
				api_key: r.api_key,
				weight: r.weight,
				priority: r.priority,
			}));
			return keys;
		},

		async createProviderKey(params: InsertProviderApiKeyParams): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(pgProviderApiKeysTable).values({
				id: params.id,
				providerId: params.providerId,
				label: params.label,
				apiKey: params.apiKey,
				status: params.status ?? 'active',
				weight: params.weight ?? 1,
				priority: params.priority ?? 0,
				createdAt: now,
				updatedAt: now,
			});
		},

		async updateProviderKeyByPatch(keyId: string, patch: UpdateProviderApiKeyPatch): Promise<number> {
			const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
			if (patch.label !== undefined) set.label = patch.label;
			if (patch.apiKey !== undefined) set.apiKey = patch.apiKey;
			if (patch.status !== undefined) set.status = patch.status;
			if (patch.weight !== undefined) set.weight = patch.weight;
			if (patch.priority !== undefined) set.priority = patch.priority;
			if (Object.keys(set).length <= 1) return 0;
			const updated = await drizzle
				.update(pgProviderApiKeysTable)
				.set(set as Record<string, never>)
				.where(eq(pgProviderApiKeysTable.id, keyId))
				.returning({ id: pgProviderApiKeysTable.id });
			return updated.length;
		},

		async deleteProviderKeyById(keyId: string): Promise<number> {
			const deleted = await drizzle
				.delete(pgProviderApiKeysTable)
				.where(eq(pgProviderApiKeysTable.id, keyId))
				.returning({ id: pgProviderApiKeysTable.id });
			return deleted.length;
		},

		async getProviderKeyById(keyId: string): Promise<ProviderApiKeyAdminRow | null> {
			const rows = await drizzle.select().from(pgProviderApiKeysTable).where(eq(pgProviderApiKeysTable.id, keyId)).limit(1);
			return rows[0] ? mapAdminRow(rows[0]) : null;
		},

		async countActiveProviderKeys(providerId: string): Promise<number> {
			const rows = await drizzle
				.select({ cnt: sql<number>`count(*)::int` })
				.from(pgProviderApiKeysTable)
				.where(and(eq(pgProviderApiKeysTable.providerId, providerId), eq(pgProviderApiKeysTable.status, 'active')));
			return rows[0]?.cnt ?? 0;
		},
	};
}
