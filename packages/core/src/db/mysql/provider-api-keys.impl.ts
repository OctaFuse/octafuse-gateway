/**
 * MySQL：`provider_api_keys` 表（Drizzle）。
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { ProviderApiKeysRepository } from '../../storage/gateway-repository-interfaces';
import {
	providerApiKeysTable as myProviderApiKeysTable,
	providersTable as myProvidersTable,
} from '../../storage/drizzle/schema.mysql';
import type {
	ActiveProviderApiKeyRow,
	InsertProviderApiKeyParams,
	ProviderApiKeyAdminRow,
	UpdateProviderApiKeyPatch,
} from '../provider-api-keys-types';
import { fingerprintProviderApiKey } from '../provider-key-utils';

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
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function createMySqlProviderApiKeysRepository(db: MySqlDatabaseClient): ProviderApiKeysRepository {
	const drizzle = db.drizzle;
	return {
		async listProviderKeys(providerId: string): Promise<ProviderApiKeyAdminRow[]> {
			const rows = await drizzle
				.select()
				.from(myProviderApiKeysTable)
				.where(eq(myProviderApiKeysTable.providerId, providerId))
				.orderBy(desc(myProviderApiKeysTable.priority), asc(myProviderApiKeysTable.createdAt));
			return rows.map(mapAdminRow);
		},

		async getActiveProviderKeys(providerId: string): Promise<ActiveProviderApiKeyRow[]> {
			const rows = await drizzle
				.select({
					id: myProviderApiKeysTable.id,
					label: myProviderApiKeysTable.label,
					api_key: myProviderApiKeysTable.apiKey,
					weight: myProviderApiKeysTable.weight,
					priority: myProviderApiKeysTable.priority,
				})
				.from(myProviderApiKeysTable)
				.where(and(eq(myProviderApiKeysTable.providerId, providerId), eq(myProviderApiKeysTable.status, 'active')))
				.orderBy(desc(myProviderApiKeysTable.priority), asc(myProviderApiKeysTable.createdAt));
			const keys: ActiveProviderApiKeyRow[] = rows.map((r) => ({
				id: r.id,
				label: r.label,
				api_key: r.api_key,
				weight: r.weight,
				priority: r.priority,
			}));
			if (keys.length > 0) return keys;

			const providerRows = await drizzle
				.select({ apiKey: myProvidersTable.apiKey })
				.from(myProvidersTable)
				.where(eq(myProvidersTable.id, providerId))
				.limit(1);
			const legacyKey = providerRows[0]?.apiKey;
			if (!legacyKey) return [];
			return [
				{
					id: `legacy-${providerId}`,
					label: 'default',
					api_key: legacyKey,
					weight: 1,
					priority: 0,
				},
			];
		},

		async createProviderKey(params: InsertProviderApiKeyParams): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(myProviderApiKeysTable).values({
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
				.update(myProviderApiKeysTable)
				.set(set as Record<string, never>)
				.where(eq(myProviderApiKeysTable.id, keyId));
			return updated[0]?.affectedRows ?? 0;
		},

		async deleteProviderKeyById(keyId: string): Promise<number> {
			const deleted = await drizzle.delete(myProviderApiKeysTable).where(eq(myProviderApiKeysTable.id, keyId));
			return deleted[0]?.affectedRows ?? 0;
		},

		async getProviderKeyById(keyId: string): Promise<ProviderApiKeyAdminRow | null> {
			const rows = await drizzle.select().from(myProviderApiKeysTable).where(eq(myProviderApiKeysTable.id, keyId)).limit(1);
			return rows[0] ? mapAdminRow(rows[0]) : null;
		},

		async syncLegacyDefaultKey(providerId: string, apiKey: string): Promise<void> {
			const now = new Date().toISOString();
			const existing = await drizzle
				.select({ id: myProviderApiKeysTable.id })
				.from(myProviderApiKeysTable)
				.where(and(eq(myProviderApiKeysTable.providerId, providerId), eq(myProviderApiKeysTable.label, 'default')))
				.limit(1);
			if (existing[0]) {
				await drizzle
					.update(myProviderApiKeysTable)
					.set({ apiKey, updatedAt: now })
					.where(eq(myProviderApiKeysTable.id, existing[0].id));
				return;
			}
			await drizzle.insert(myProviderApiKeysTable).values({
				id: `pkey_${providerId}`,
				providerId,
				label: 'default',
				apiKey,
				status: 'active',
				weight: 1,
				priority: 0,
				createdAt: now,
				updatedAt: now,
			});
		},

		async countActiveProviderKeys(providerId: string): Promise<number> {
			const rows = await drizzle
				.select({ cnt: sql<number>`count(*)` })
				.from(myProviderApiKeysTable)
				.where(and(eq(myProviderApiKeysTable.providerId, providerId), eq(myProviderApiKeysTable.status, 'active')));
			return Number(rows[0]?.cnt ?? 0);
		},
	};
}
