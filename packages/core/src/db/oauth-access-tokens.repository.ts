/**
 * `oauth_access_tokens` 仓储：三种数据库共用同一份 SQL（`?` 占位符，各自适配器负责方言差异）。
 * 时间列统一为 ISO 文本，可直接按字符串比较。
 */
import { parseOAuthAccessTokenScopes, type OAuthAccessTokenStatus } from '../lib/oauth-access-tokens';

export type SqlExec = (query: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

export type OAuthAccessTokenRow = {
	id: string;
	user_id: string;
	client_id: string;
	client_name: string;
	/** 末 4 位；撤销后为 null */
	token_hint: string | null;
	scopes: string[];
	expires_at: string | null;
	last_used_at: string | null;
	rotated_at: string | null;
	revoked_at: string | null;
	created_at: string;
	updated_at: string;
};

export type OAuthAccessTokenListRow = OAuthAccessTokenRow & { user_email: string | null };

export type OAuthAccessTokenListFilter = {
	page: number;
	pageSize: number;
	clientId?: string;
	userId?: string;
	userEmail?: string;
	status?: OAuthAccessTokenStatus;
	/** 判断 active / expired 的基准时间（ISO） */
	nowIso: string;
};

export type OAuthAccessTokenClientStat = {
	client_id: string;
	client_name: string;
	/** 访问令牌当前未过期的授权数（1 小时 TTL，数值偏小）。 */
	active_count: number;
	/** 未撤销的授权数（含访问令牌已过期但仍可刷新的），代表「授权仍然有效」。 */
	live_count: number;
	total_count: number;
	last_used_at: string | null;
};

export type IssueOAuthAccessTokenParams = {
	id: string;
	userId: string;
	clientId: string;
	clientName: string;
	tokenHash: string;
	tokenHint: string;
	scopes: string[];
	expiresAt: string;
	nowIso: string;
};

function text(value: unknown): string | null {
	return value == null ? null : String(value);
}

export function mapOAuthAccessToken(row: Record<string, unknown>): OAuthAccessTokenRow {
	return {
		id: String(row.id),
		user_id: String(row.user_id),
		client_id: String(row.client_id),
		client_name: String(row.client_name ?? ''),
		token_hint: text(row.token_hint),
		scopes: parseOAuthAccessTokenScopes(text(row.scopes)),
		expires_at: text(row.expires_at),
		last_used_at: text(row.last_used_at),
		rotated_at: text(row.rotated_at),
		revoked_at: text(row.revoked_at),
		created_at: String(row.created_at ?? ''),
		updated_at: String(row.updated_at ?? ''),
	};
}

const COLUMNS = `id, user_id, client_id, client_name, token_hint, scopes, expires_at, last_used_at,
	rotated_at, revoked_at, created_at, updated_at`;
const T_COLUMNS = `t.id, t.user_id, t.client_id, t.client_name, t.token_hint, t.scopes, t.expires_at,
	t.last_used_at, t.rotated_at, t.revoked_at, t.created_at, t.updated_at`;

function placeholders(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

export function createOAuthAccessTokensSqlRepository(exec: SqlExec) {
	async function getById(id: string): Promise<OAuthAccessTokenRow | null> {
		const rows = await exec(`SELECT ${COLUMNS} FROM oauth_access_tokens WHERE id = ?`, [id]);
		return rows[0] ? mapOAuthAccessToken(rows[0]) : null;
	}

	/** 按令牌哈希取有效（未撤销）行；过期判断交给调用方。 */
	async function getByHash(tokenHash: string): Promise<OAuthAccessTokenRow | null> {
		const rows = await exec(
			`SELECT ${COLUMNS} FROM oauth_access_tokens WHERE token_hash = ? AND revoked_at IS NULL`,
			[tokenHash]
		);
		return rows[0] ? mapOAuthAccessToken(rows[0]) : null;
	}

	return {
		getById,
		getByHash,

		/**
		 * 签发：同一用户 x 应用已有未撤销的授权时轮换它（id 不变），否则新建。
		 * `rotated` 为 true 表示复用了既有授权。
		 */
		async issue(params: IssueOAuthAccessTokenParams): Promise<{ row: OAuthAccessTokenRow; rotated: boolean }> {
			const existing = await exec(
				`SELECT ${COLUMNS} FROM oauth_access_tokens
				 WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL
				 ORDER BY created_at DESC LIMIT 1`,
				[params.userId, params.clientId]
			);
			const scopes = JSON.stringify(params.scopes);
			if (existing[0]) {
				const id = String(existing[0].id);
				await exec(
					`UPDATE oauth_access_tokens
					 SET client_name = ?, token_hash = ?, token_hint = ?, scopes = ?, expires_at = ?,
					     rotated_at = ?, updated_at = ?
					 WHERE id = ?`,
					[
						params.clientName,
						params.tokenHash,
						params.tokenHint,
						scopes,
						params.expiresAt,
						params.nowIso,
						params.nowIso,
						id,
					]
				);
				const row = await getById(id);
				if (!row) throw new Error('access token disappeared after rotate');
				return { row, rotated: true };
			}
			await exec(
				`INSERT INTO oauth_access_tokens
				 (id, user_id, client_id, client_name, token_hash, token_hint, scopes, expires_at,
				  last_used_at, rotated_at, revoked_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
				[
					params.id,
					params.userId,
					params.clientId,
					params.clientName,
					params.tokenHash,
					params.tokenHint,
					scopes,
					params.expiresAt,
					params.nowIso,
					params.nowIso,
				]
			);
			const row = await getById(params.id);
			if (!row) throw new Error('access token missing after insert');
			return { row, rotated: false };
		},

		/** 轮换指定授权的令牌；已撤销或不存在返回 null。 */
		async rotate(
			id: string,
			params: { tokenHash: string; tokenHint: string; expiresAt: string; nowIso: string }
		): Promise<OAuthAccessTokenRow | null> {
			const current = await getById(id);
			if (!current || current.revoked_at) return null;
			await exec(
				`UPDATE oauth_access_tokens
				 SET token_hash = ?, token_hint = ?, expires_at = ?, rotated_at = ?, updated_at = ?
				 WHERE id = ? AND revoked_at IS NULL`,
				[params.tokenHash, params.tokenHint, params.expiresAt, params.nowIso, params.nowIso, id]
			);
			const row = await getById(id);
			return row && !row.revoked_at ? row : null;
		},

		/** 软删除：清空哈希，保留应用名与记录供日志展示。返回是否撤销了一条有效授权。 */
		async revokeById(id: string, nowIso: string): Promise<boolean> {
			const current = await getById(id);
			if (!current || current.revoked_at) return false;
			await exec(
				`UPDATE oauth_access_tokens
				 SET token_hash = NULL, token_hint = NULL, revoked_at = ?, updated_at = ?
				 WHERE id = ? AND revoked_at IS NULL`,
				[nowIso, nowIso, id]
			);
			return true;
		},

		/** 按令牌哈希撤销（RFC 7009）。返回被撤销授权的 id，未命中返回 null。 */
		async revokeByHash(tokenHash: string, nowIso: string): Promise<string | null> {
			const row = await getByHash(tokenHash);
			if (!row) return null;
			await exec(
				`UPDATE oauth_access_tokens
				 SET token_hash = NULL, token_hint = NULL, revoked_at = ?, updated_at = ?
				 WHERE id = ? AND revoked_at IS NULL`,
				[nowIso, nowIso, row.id]
			);
			return row.id;
		},

		/** 撤销某个应用下全部有效授权，返回数量。 */
		async revokeByClient(clientId: string, nowIso: string): Promise<number> {
			const rows = await exec(
				'SELECT id FROM oauth_access_tokens WHERE client_id = ? AND revoked_at IS NULL',
				[clientId]
			);
			if (rows.length === 0) return 0;
			await exec(
				`UPDATE oauth_access_tokens
				 SET token_hash = NULL, token_hint = NULL, revoked_at = ?, updated_at = ?
				 WHERE client_id = ? AND revoked_at IS NULL`,
				[nowIso, nowIso, clientId]
			);
			return rows.length;
		},

		async listForUser(userId: string): Promise<OAuthAccessTokenRow[]> {
			const rows = await exec(
				`SELECT ${COLUMNS} FROM oauth_access_tokens WHERE user_id = ? ORDER BY created_at DESC`,
				[userId]
			);
			return rows.map(mapOAuthAccessToken);
		},

		async list(filter: OAuthAccessTokenListFilter): Promise<{ rows: OAuthAccessTokenListRow[]; total: number }> {
			const conditions: string[] = [];
			const values: unknown[] = [];
			if (filter.clientId) {
				conditions.push('t.client_id = ?');
				values.push(filter.clientId);
			}
			if (filter.userId) {
				conditions.push('t.user_id = ?');
				values.push(filter.userId);
			}
			if (filter.userEmail) {
				conditions.push('u.email LIKE ?');
				values.push(`%${filter.userEmail}%`);
			}
			if (filter.status === 'revoked') {
				conditions.push('t.revoked_at IS NOT NULL');
			} else if (filter.status === 'active') {
				conditions.push('t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?)');
				values.push(filter.nowIso);
			} else if (filter.status === 'expired') {
				conditions.push('t.revoked_at IS NULL AND t.expires_at IS NOT NULL AND t.expires_at <= ?');
				values.push(filter.nowIso);
			}
			const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const from = 'FROM oauth_access_tokens t LEFT JOIN users u ON u.id = t.user_id';
			const count = await exec(`SELECT COUNT(*) AS total ${from} ${where}`, values);
			const total = Number(count[0]?.total ?? 0);
			const offset = (Math.max(filter.page, 1) - 1) * filter.pageSize;
			const rows = await exec(
				`SELECT ${T_COLUMNS}, u.email AS user_email ${from} ${where}
				 ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
				[...values, filter.pageSize, offset]
			);
			return {
				rows: rows.map((row) => ({ ...mapOAuthAccessToken(row), user_email: text(row.user_email) })),
				total,
			};
		},

		/** 按应用汇总：有效授权数、总数、最近使用。 */
		async statsByClient(nowIso: string): Promise<OAuthAccessTokenClientStat[]> {
			const rows = await exec(
				`SELECT client_id, MAX(client_name) AS client_name, COUNT(*) AS total_count,
				        SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) AS active_count,
				        SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS live_count,
				        MAX(last_used_at) AS last_used_at
				 FROM oauth_access_tokens GROUP BY client_id ORDER BY MAX(created_at) DESC`,
				[nowIso]
			);
			return rows.map((row) => ({
				client_id: String(row.client_id),
				client_name: String(row.client_name ?? ''),
				active_count: Number(row.active_count ?? 0),
				live_count: Number(row.live_count ?? 0),
				total_count: Number(row.total_count ?? 0),
				last_used_at: text(row.last_used_at),
			}));
		},

		/** 最近使用时间节流写入：距上次不足 `minIntervalMs` 时不写。 */
		async touchLastUsed(id: string, nowMs: number, minIntervalMs = 60_000): Promise<void> {
			const nowIso = new Date(nowMs).toISOString();
			const cutoffIso = new Date(nowMs - minIntervalMs).toISOString();
			await exec(
				'UPDATE oauth_access_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)',
				[nowIso, id, cutoffIso]
			);
		},

		/**
		 * 清理：删除「撤销超过 cutoff」与「过期超过 cutoff 且未撤销」的行。
		 * 刚过期的令牌仍可能通过刷新续期，因此只清理过期较久的。返回删除条数。
		 */
		async deleteStale(cutoffIso: string): Promise<number> {
			const rows = await exec(
				`SELECT id FROM oauth_access_tokens
				 WHERE (revoked_at IS NOT NULL AND revoked_at < ?)
				    OR (revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?)`,
				[cutoffIso, cutoffIso]
			);
			if (rows.length === 0) return 0;
			await exec(
				`DELETE FROM oauth_access_tokens
				 WHERE (revoked_at IS NOT NULL AND revoked_at < ?)
				    OR (revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?)`,
				[cutoffIso, cutoffIso]
			);
			return rows.length;
		},

		/** 日志展示用：按 id 批量取应用名（已删除的不返回）。 */
		async getNamesByIds(ids: string[]): Promise<Array<{ id: string; client_id: string; client_name: string }>> {
			const unique = [...new Set(ids.filter(Boolean))];
			if (unique.length === 0) return [];
			const rows = await exec(
				`SELECT id, client_id, client_name FROM oauth_access_tokens WHERE id IN (${placeholders(unique.length)})`,
				unique
			);
			return rows.map((row) => ({
				id: String(row.id),
				client_id: String(row.client_id),
				client_name: String(row.client_name ?? ''),
			}));
		},
	};
}

export type OAuthAccessTokensRepository = ReturnType<typeof createOAuthAccessTokensSqlRepository>;
