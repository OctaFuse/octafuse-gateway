import { and, desc, eq, gt, lte } from 'drizzle-orm';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { AdminAccessRepository } from '../../storage/gateway-repository-interfaces';
import {
	adminApiKeysTable,
	adminSessionsTable,
} from '../../storage/drizzle/schema.mysql';
import type { AdminApiKeyRow, AdminSessionRow } from '../admin-access-types';

function mapKey(row: typeof adminApiKeysTable.$inferSelect): AdminApiKeyRow {
	return { ...row, status: row.status === 'revoked' ? 'revoked' : 'active' };
}

function mapSession(row: typeof adminSessionsTable.$inferSelect): AdminSessionRow {
	return row;
}

export function createMySqlAdminAccessRepository(db: MySqlDatabaseClient): AdminAccessRepository {
	const drizzle = db.drizzle;
	const getById = async (id: string): Promise<AdminApiKeyRow | null> => {
		const row = await drizzle.select().from(adminApiKeysTable).where(eq(adminApiKeysTable.id, id)).limit(1);
		return row[0] ? mapKey(row[0]) : null;
	};
	return {
		async listApiKeys() {
			return (await drizzle.select().from(adminApiKeysTable).orderBy(desc(adminApiKeysTable.createdAt))).map(mapKey);
		},
		async getApiKeyById(id) {
			return getById(id);
		},
		async getActiveApiKeyBySecret(secretKey) {
			const row = await drizzle.select().from(adminApiKeysTable)
				.where(and(eq(adminApiKeysTable.secretKey, secretKey), eq(adminApiKeysTable.status, 'active'))).limit(1);
			return row[0] ? mapKey(row[0]) : null;
		},
		async insertApiKey(params) {
			const now = new Date().toISOString();
			await drizzle.insert(adminApiKeysTable).values({ ...params, description: params.description ?? null, status: 'active', createdAt: now, updatedAt: now });
		},
		async updateApiKey(id, patch) {
			if (Object.keys(patch).length === 0 || !(await getById(id))) return false;
			await drizzle.update(adminApiKeysTable).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(adminApiKeysTable.id, id));
			return true;
		},
		async rotateApiKey(id, secretKey, keyPrefix) {
			const existing = await getById(id);
			if (!existing || existing.status !== 'active') return false;
			await drizzle.update(adminApiKeysTable).set({ secretKey, keyPrefix, updatedAt: new Date().toISOString() }).where(eq(adminApiKeysTable.id, id));
			return true;
		},
		async revokeApiKey(id) {
			const existing = await getById(id);
			if (!existing || existing.status !== 'active') return false;
			const now = new Date().toISOString();
			await drizzle.update(adminApiKeysTable).set({ status: 'revoked', revokedAt: now, updatedAt: now }).where(eq(adminApiKeysTable.id, id));
			return true;
		},
		async touchApiKey(id) {
			await drizzle.update(adminApiKeysTable).set({ lastUsedAt: new Date().toISOString() }).where(eq(adminApiKeysTable.id, id));
		},
		async insertSession(session) {
			await drizzle.insert(adminSessionsTable).values(session);
		},
		async getValidSession(tokenHash, nowIso) {
			const row = await drizzle.select().from(adminSessionsTable)
				.where(and(eq(adminSessionsTable.tokenHash, tokenHash), gt(adminSessionsTable.expiresAt, nowIso))).limit(1);
			return row[0] ? mapSession(row[0]) : null;
		},
		async deleteSession(tokenHash) {
			await drizzle.delete(adminSessionsTable).where(eq(adminSessionsTable.tokenHash, tokenHash));
		},
		async deleteExpiredSessions(nowIso) {
			await drizzle.delete(adminSessionsTable).where(lte(adminSessionsTable.expiresAt, nowIso));
		},
	};
}
