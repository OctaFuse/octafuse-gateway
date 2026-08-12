import type { D1DatabaseClient } from '../../storage/database-client';
import type { AdminAccessRepository } from '../../storage/gateway-repository-interfaces';
import type {
	AdminApiKeyRow,
	AdminApiKeyStatus,
	AdminSessionRow,
} from '../admin-access-types';

type KeySqlRow = {
	id: string;
	name: string;
	description: string | null;
	secret_key: string;
	key_prefix: string;
	permissions_json: string;
	status: AdminApiKeyStatus;
	last_used_at: string | null;
	created_at: string;
	updated_at: string;
	revoked_at: string | null;
};

type SessionSqlRow = {
	token_hash: string;
	username: string;
	created_at: string;
	expires_at: string;
};

const KEY_COLUMNS = `id, name, description, secret_key, key_prefix, permissions_json,
  status, last_used_at, created_at, updated_at, revoked_at`;

function mapKey(row: KeySqlRow): AdminApiKeyRow {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		secretKey: row.secret_key,
		keyPrefix: row.key_prefix,
		permissionsJson: row.permissions_json,
		status: row.status,
		lastUsedAt: row.last_used_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		revokedAt: row.revoked_at,
	};
}

function mapSession(row: SessionSqlRow): AdminSessionRow {
	return {
		tokenHash: row.token_hash,
		username: row.username,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
	};
}

export function createD1AdminAccessRepository(db: D1DatabaseClient): AdminAccessRepository {
	const raw = db.raw;
	return {
		async listApiKeys() {
			const rows = await raw.prepare(`SELECT ${KEY_COLUMNS} FROM admin_api_keys ORDER BY created_at DESC`).all<KeySqlRow>();
			return (rows.results ?? []).map(mapKey);
		},
		async getApiKeyById(id) {
			const row = await raw.prepare(`SELECT ${KEY_COLUMNS} FROM admin_api_keys WHERE id = ?`).bind(id).first<KeySqlRow>();
			return row ? mapKey(row) : null;
		},
		async getActiveApiKeyBySecret(secretKey) {
			const row = await raw.prepare(`SELECT ${KEY_COLUMNS} FROM admin_api_keys WHERE secret_key = ? AND status = 'active'`).bind(secretKey).first<KeySqlRow>();
			return row ? mapKey(row) : null;
		},
		async insertApiKey(params) {
			await raw.prepare(`INSERT INTO admin_api_keys
          (id, name, description, secret_key, key_prefix, permissions_json, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`)
				.bind(params.id, params.name, params.description ?? null, params.secretKey, params.keyPrefix, params.permissionsJson)
				.run();
		},
		async updateApiKey(id, patch) {
			const sets: string[] = [];
			const values: unknown[] = [];
			if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name); }
			if (patch.description !== undefined) { sets.push('description = ?'); values.push(patch.description); }
			if (patch.permissionsJson !== undefined) { sets.push('permissions_json = ?'); values.push(patch.permissionsJson); }
			if (patch.secretKey !== undefined) { sets.push('secret_key = ?'); values.push(patch.secretKey); }
			if (patch.keyPrefix !== undefined) { sets.push('key_prefix = ?'); values.push(patch.keyPrefix); }
			if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
			if (patch.revokedAt !== undefined) { sets.push('revoked_at = ?'); values.push(patch.revokedAt); }
			if (sets.length === 0) return false;
			sets.push("updated_at = datetime('now')");
			const result = await raw.prepare(`UPDATE admin_api_keys SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
			return Number(result.meta.changes ?? 0) > 0;
		},
		async rotateApiKey(id, secretKey, keyPrefix) {
			const result = await raw.prepare(`UPDATE admin_api_keys SET secret_key = ?, key_prefix = ?, updated_at = datetime('now') WHERE id = ? AND status = 'active'`).bind(secretKey, keyPrefix, id).run();
			return Number(result.meta.changes ?? 0) > 0;
		},
		async revokeApiKey(id) {
			const result = await raw.prepare(`UPDATE admin_api_keys SET status = 'revoked', revoked_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'active'`).bind(id).run();
			return Number(result.meta.changes ?? 0) > 0;
		},
		async touchApiKey(id) {
			await raw.prepare(`UPDATE admin_api_keys SET last_used_at = datetime('now') WHERE id = ?`).bind(id).run();
		},
		async insertSession(session) {
			await raw.prepare(`INSERT INTO admin_sessions (token_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)`)
				.bind(session.tokenHash, session.username, session.createdAt, session.expiresAt).run();
		},
		async getValidSession(tokenHash, nowIso) {
			const row = await raw.prepare(`SELECT token_hash, username, created_at, expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ?`).bind(tokenHash, nowIso).first<SessionSqlRow>();
			return row ? mapSession(row) : null;
		},
		async deleteSession(tokenHash) {
			await raw.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
		},
		async deleteExpiredSessions(nowIso) {
			await raw.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(nowIso).run();
		},
	};
}
