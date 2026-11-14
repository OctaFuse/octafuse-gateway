/**
 * 内置 OAuth 授权服务器的仓储：应用目录（`oauth_apps`）、动态注册实例（`oauth_clients`）、
 * 授权请求与一次性授权码（`oauth_authorization_requests`）。
 * 三种数据库共用同一份 SQL（`?` 占位符，各自适配器负责方言差异）；时间列统一为 ISO 文本。
 * 一次性消费一律用「条件 UPDATE + 按唯一标记查回」，不依赖 RETURNING 或受影响行数。
 */
import { parseJsonStringList } from '../lib/oauth-server';
import type { SqlExec } from './oauth-access-tokens.repository';

export type OAuthAppRow = {
	id: string;
	slug: string;
	name: string;
	redirect_uris: string[];
	client_name_patterns: string[];
	enabled: boolean;
	created_at: string;
	updated_at: string;
};

export type OAuthClientRow = {
	client_id: string;
	app_id: string | null;
	client_name: string;
	redirect_uris: string[];
	registration_method: string;
	last_authorized_at: string | null;
	created_at: string;
};

export type OAuthClientListRow = OAuthClientRow & { live_grant_count: number };

export type OAuthAuthorizationRequestRow = {
	id_hash: string;
	client_id: string;
	redirect_uri: string;
	code_challenge: string;
	resource: string | null;
	state: string | null;
	scope: string;
	user_id: string | null;
	code_hash: string | null;
	code_expires_at: string | null;
	used_at: string | null;
	decided_at: string | null;
	expires_at: string;
	created_at: string;
};

export type InsertOAuthAppParams = {
	id: string;
	slug: string;
	name: string;
	redirectUris: string[];
	clientNamePatterns: string[];
	enabled: boolean;
	nowIso: string;
};

export type UpdateOAuthAppPatch = {
	name?: string;
	redirectUris?: string[];
	clientNamePatterns?: string[];
	enabled?: boolean;
};

export type InsertOAuthAuthorizationRequestParams = {
	idHash: string;
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	resource: string | null;
	state: string | null;
	scope: string;
	expiresAt: string;
	nowIso: string;
};

function text(value: unknown): string | null {
	return value == null ? null : String(value);
}

function mapApp(row: Record<string, unknown>): OAuthAppRow {
	return {
		id: String(row.id),
		slug: String(row.slug),
		name: String(row.name ?? ''),
		redirect_uris: parseJsonStringList(text(row.redirect_uris)),
		client_name_patterns: parseJsonStringList(text(row.client_name_patterns)),
		enabled: Number(row.enabled ?? 0) === 1,
		created_at: String(row.created_at ?? ''),
		updated_at: String(row.updated_at ?? ''),
	};
}

function mapClient(row: Record<string, unknown>): OAuthClientRow {
	return {
		client_id: String(row.client_id),
		app_id: text(row.app_id),
		client_name: String(row.client_name ?? ''),
		redirect_uris: parseJsonStringList(text(row.redirect_uris)),
		registration_method: String(row.registration_method ?? 'dcr'),
		last_authorized_at: text(row.last_authorized_at),
		created_at: String(row.created_at ?? ''),
	};
}

function mapRequest(row: Record<string, unknown>): OAuthAuthorizationRequestRow {
	return {
		id_hash: String(row.id_hash),
		client_id: String(row.client_id),
		redirect_uri: String(row.redirect_uri),
		code_challenge: String(row.code_challenge),
		resource: text(row.resource),
		state: text(row.state),
		scope: String(row.scope ?? 'mcp'),
		user_id: text(row.user_id),
		code_hash: text(row.code_hash),
		code_expires_at: text(row.code_expires_at),
		used_at: text(row.used_at),
		decided_at: text(row.decided_at),
		expires_at: String(row.expires_at ?? ''),
		created_at: String(row.created_at ?? ''),
	};
}

const APP_COLUMNS = 'id, slug, name, redirect_uris, client_name_patterns, enabled, created_at, updated_at';
const CLIENT_COLUMNS = 'client_id, app_id, client_name, redirect_uris, registration_method, last_authorized_at, created_at';
const REQUEST_COLUMNS =
	'id_hash, client_id, redirect_uri, code_challenge, resource, state, scope, user_id, code_hash, code_expires_at, used_at, decided_at, expires_at, created_at';

export function createOAuthServerSqlRepository(exec: SqlExec) {
	async function getAppById(id: string): Promise<OAuthAppRow | null> {
		const rows = await exec(`SELECT ${APP_COLUMNS} FROM oauth_apps WHERE id = ?`, [id]);
		return rows[0] ? mapApp(rows[0]) : null;
	}

	async function getClient(clientId: string): Promise<OAuthClientRow | null> {
		const rows = await exec(`SELECT ${CLIENT_COLUMNS} FROM oauth_clients WHERE client_id = ?`, [clientId]);
		return rows[0] ? mapClient(rows[0]) : null;
	}

	async function getRequest(idHash: string): Promise<OAuthAuthorizationRequestRow | null> {
		const rows = await exec(`SELECT ${REQUEST_COLUMNS} FROM oauth_authorization_requests WHERE id_hash = ?`, [idHash]);
		return rows[0] ? mapRequest(rows[0]) : null;
	}

	return {
		// ---- 应用目录 ----
		getAppById,

		async listApps(): Promise<OAuthAppRow[]> {
			const rows = await exec(`SELECT ${APP_COLUMNS} FROM oauth_apps ORDER BY created_at ASC, id ASC`, []);
			return rows.map(mapApp);
		},

		async getAppBySlug(slug: string): Promise<OAuthAppRow | null> {
			const rows = await exec(`SELECT ${APP_COLUMNS} FROM oauth_apps WHERE slug = ?`, [slug]);
			return rows[0] ? mapApp(rows[0]) : null;
		},

		async insertApp(params: InsertOAuthAppParams): Promise<OAuthAppRow> {
			await exec(
				`INSERT INTO oauth_apps (id, slug, name, redirect_uris, client_name_patterns, enabled, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					params.id,
					params.slug,
					params.name,
					JSON.stringify(params.redirectUris),
					JSON.stringify(params.clientNamePatterns),
					params.enabled ? 1 : 0,
					params.nowIso,
					params.nowIso,
				]
			);
			const row = await getAppById(params.id);
			if (!row) throw new Error('oauth app missing after insert');
			return row;
		},

		async updateApp(id: string, patch: UpdateOAuthAppPatch, nowIso: string): Promise<OAuthAppRow | null> {
			const sets: string[] = [];
			const values: unknown[] = [];
			if (patch.name !== undefined) {
				sets.push('name = ?');
				values.push(patch.name);
			}
			if (patch.redirectUris !== undefined) {
				sets.push('redirect_uris = ?');
				values.push(JSON.stringify(patch.redirectUris));
			}
			if (patch.clientNamePatterns !== undefined) {
				sets.push('client_name_patterns = ?');
				values.push(JSON.stringify(patch.clientNamePatterns));
			}
			if (patch.enabled !== undefined) {
				sets.push('enabled = ?');
				values.push(patch.enabled ? 1 : 0);
			}
			if (sets.length > 0) {
				sets.push('updated_at = ?');
				await exec(`UPDATE oauth_apps SET ${sets.join(', ')} WHERE id = ?`, [...values, nowIso, id]);
			}
			return getAppById(id);
		},

		async deleteApp(id: string): Promise<boolean> {
			const existing = await getAppById(id);
			if (!existing) return false;
			await exec('UPDATE oauth_clients SET app_id = NULL WHERE app_id = ?', [id]);
			await exec('DELETE FROM oauth_apps WHERE id = ?', [id]);
			return true;
		},

		// ---- 注册实例 ----
		getClient,

		async insertClient(params: {
			clientId: string;
			appId: string | null;
			clientName: string;
			redirectUris: string[];
			nowIso: string;
		}): Promise<OAuthClientRow> {
			await exec(
				`INSERT INTO oauth_clients (client_id, app_id, client_name, redirect_uris, registration_method, last_authorized_at, created_at)
				 VALUES (?, ?, ?, ?, 'dcr', NULL, ?)`,
				[params.clientId, params.appId, params.clientName, JSON.stringify(params.redirectUris), params.nowIso]
			);
			const row = await getClient(params.clientId);
			if (!row) throw new Error('oauth client missing after insert');
			return row;
		},

		async listClients(filter: { appId?: string; page: number; pageSize: number; nowIso: string }): Promise<{
			rows: OAuthClientListRow[];
			total: number;
		}> {
			const conditions: string[] = [];
			const values: unknown[] = [];
			if (filter.appId === 'none') conditions.push('c.app_id IS NULL');
			else if (filter.appId) {
				conditions.push('c.app_id = ?');
				values.push(filter.appId);
			}
			const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const count = await exec(`SELECT COUNT(*) AS total FROM oauth_clients c ${where}`, values);
			const offset = (Math.max(filter.page, 1) - 1) * filter.pageSize;
			const rows = await exec(
				`SELECT ${CLIENT_COLUMNS.split(', ')
					.map((column) => `c.${column}`)
					.join(', ')},
				        (SELECT COUNT(*) FROM oauth_access_tokens t
				         WHERE t.client_id = c.client_id AND t.revoked_at IS NULL
				           AND (t.refresh_expires_at IS NULL OR t.refresh_expires_at > ?)) AS live_grant_count
				 FROM oauth_clients c ${where}
				 ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
				[filter.nowIso, ...values, filter.pageSize, offset]
			);
			return {
				rows: rows.map((row) => ({ ...mapClient(row), live_grant_count: Number(row.live_grant_count ?? 0) })),
				total: Number(count[0]?.total ?? 0),
			};
		},

		/** 每个应用下的注册实例数（`app_id` 为 null 的是未归属）。 */
		async countClientsByApp(): Promise<Array<{ app_id: string | null; client_count: number }>> {
			const rows = await exec('SELECT app_id, COUNT(*) AS client_count FROM oauth_clients GROUP BY app_id', []);
			return rows.map((row) => ({ app_id: text(row.app_id), client_count: Number(row.client_count ?? 0) }));
		},

		async listUnattributedClients(limit: number): Promise<OAuthClientRow[]> {
			const rows = await exec(
				`SELECT ${CLIENT_COLUMNS} FROM oauth_clients WHERE app_id IS NULL ORDER BY created_at DESC LIMIT ?`,
				[limit]
			);
			return rows.map(mapClient);
		},

		async setClientApp(clientId: string, appId: string | null): Promise<void> {
			await exec('UPDATE oauth_clients SET app_id = ? WHERE client_id = ?', [appId, clientId]);
		},

		async touchClientAuthorized(clientId: string, nowIso: string): Promise<void> {
			await exec('UPDATE oauth_clients SET last_authorized_at = ? WHERE client_id = ?', [nowIso, clientId]);
		},

		/** 清理注册后从未完成授权、且早于 cutoff 的注册实例，返回条数。 */
		async deleteUnusedClients(cutoffIso: string): Promise<number> {
			const where = `last_authorized_at IS NULL AND created_at < ?
				 AND NOT EXISTS (SELECT 1 FROM oauth_access_tokens t WHERE t.client_id = oauth_clients.client_id)`;
			const rows = await exec(`SELECT client_id FROM oauth_clients WHERE ${where}`, [cutoffIso]);
			if (rows.length === 0) return 0;
			await exec(`DELETE FROM oauth_clients WHERE ${where}`, [cutoffIso]);
			return rows.length;
		},

		// ---- 授权请求与授权码 ----
		getRequest,

		async insertRequest(params: InsertOAuthAuthorizationRequestParams): Promise<void> {
			await exec(
				`INSERT INTO oauth_authorization_requests
				 (id_hash, client_id, redirect_uri, code_challenge, resource, state, scope,
				  user_id, code_hash, code_expires_at, used_at, decided_at, expires_at, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
				[
					params.idHash,
					params.clientId,
					params.redirectUri,
					params.codeChallenge,
					params.resource,
					params.state,
					params.scope,
					params.expiresAt,
					params.nowIso,
				]
			);
		},

		/**
		 * 用户同意：只有尚未决定且未过期的请求才会写入授权码。返回是否由本次调用写入。
		 * 授权码哈希唯一，查回时比对即可判断并发下是否被别人抢先。
		 */
		async approveRequest(
			idHash: string,
			params: { userId: string; codeHash: string; codeExpiresAt: string; nowIso: string }
		): Promise<boolean> {
			await exec(
				`UPDATE oauth_authorization_requests
				 SET user_id = ?, code_hash = ?, code_expires_at = ?, decided_at = ?
				 WHERE id_hash = ? AND decided_at IS NULL AND expires_at > ?`,
				[params.userId, params.codeHash, params.codeExpiresAt, params.nowIso, idHash, params.nowIso]
			);
			const row = await getRequest(idHash);
			return row?.code_hash === params.codeHash;
		},

		/** 用户拒绝。返回请求是否处于「刚被本次拒绝」的状态。 */
		async denyRequest(idHash: string, nowIso: string): Promise<boolean> {
			await exec(
				`UPDATE oauth_authorization_requests SET decided_at = ?
				 WHERE id_hash = ? AND decided_at IS NULL AND expires_at > ?`,
				[nowIso, idHash, nowIso]
			);
			const row = await getRequest(idHash);
			return row != null && row.decided_at === nowIso && row.code_hash === null;
		},

		/** 原子消费授权码：未使用且未过期才返回行；并发重放最多一方成功。 */
		async consumeCode(codeHash: string, nowIso: string, marker: string): Promise<OAuthAuthorizationRequestRow | null> {
			await exec(
				`UPDATE oauth_authorization_requests SET used_at = ?
				 WHERE code_hash = ? AND used_at IS NULL AND code_expires_at > ?`,
				[marker, codeHash, nowIso]
			);
			const rows = await exec(
				`SELECT ${REQUEST_COLUMNS} FROM oauth_authorization_requests WHERE code_hash = ? AND used_at = ?`,
				[codeHash, marker]
			);
			return rows[0] ? mapRequest(rows[0]) : null;
		},

		/** 清理早于 cutoff 过期的授权请求。 */
		async deleteExpiredRequests(cutoffIso: string): Promise<void> {
			await exec('DELETE FROM oauth_authorization_requests WHERE expires_at < ?', [cutoffIso]);
		},
	};
}

export type OAuthServerRepository = ReturnType<typeof createOAuthServerSqlRepository>;
