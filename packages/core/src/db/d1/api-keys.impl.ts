/**
 * D1：`api_keys` 表实现（预算在 `users`）。
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { ApiKeyRow, ResolvedGatewayKeyRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { ApiKeysRepository } from '../../storage/gateway-repository-interfaces';
import type { ApiKeysD1Statements } from './d1-repository-extras';
import type { BudgetFilter, InsertKeyParams } from '../api-keys-types';
import type { AdminApiKeyListItem } from '../../storage/repository-dtos';

type KeySqlRow = {
	id: string;
	key: string;
	user_id: string;
	name: string | null;
	status: string;
	metadata: string | null;
	last_used_at: string | null;
	created_at: string;
	updated_at: string;
};

function mapKeyRow(r: KeySqlRow): ApiKeyRow {
	return {
		id: r.id,
		key: r.key,
		user_id: r.user_id,
		name: r.name,
		status: r.status,
		metadata: r.metadata,
		last_used_at: r.last_used_at,
		created_at: r.created_at,
		updated_at: r.updated_at,
	};
}

type ResolvedSqlRow = KeySqlRow & {
	user_email: string | null;
	user_metadata: string | null;
	budget_max: number | null;
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
};

function mapResolvedRow(r: ResolvedSqlRow): ResolvedGatewayKeyRow {
	const base = mapKeyRow(r);
	return {
		...base,
		user_email: r.user_email,
		user_metadata: r.user_metadata,
		budget_max: r.budget_max == null ? null : roundGatewayMoney(Number(r.budget_max)),
		budget_base: roundGatewayMoney(Number(r.budget_base ?? 0)),
		budget_spent: roundGatewayMoney(Number(r.budget_spent)),
		budget_period: r.budget_period,
		budget_reset_at: r.budget_reset_at,
	};
}

export function buildInsertApiKeyStatement(db: D1Database, params: InsertKeyParams): D1PreparedStatement {
	const status = params.status ?? 'active';
	return db
		.prepare(
			`INSERT INTO api_keys (id, key, user_id, name, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
		)
		.bind(params.id, params.key, params.userId, params.name ?? null, status, params.metadata ?? null);
}

export function createD1ApiKeysRepository(db: D1DatabaseClient): ApiKeysRepository & ApiKeysD1Statements {
	const raw = db.raw;
	const resolvedSelect = `SELECT k.id, k.key, k.user_id, k.name, k.status, k.metadata, k.last_used_at, k.created_at, k.updated_at,
    u.email AS user_email, u.metadata AS user_metadata, u.budget_max, u.budget_base, u.budget_spent, u.budget_period, u.budget_reset_at
    FROM api_keys k INNER JOIN users u ON u.id = k.user_id`;

	return {
		buildInsertApiKeyStatement,

		async getApiKeyByKey(key: string): Promise<ApiKeyRow | null> {
			const row = await raw
				.prepare('SELECT * FROM api_keys WHERE key = ? AND status = ?')
				.bind(key, 'active')
				.first<KeySqlRow>();
			return row ? mapKeyRow(row) : null;
		},

		async getApiKeyByKeyAnyStatus(key: string): Promise<ApiKeyRow | null> {
			const row = await raw.prepare('SELECT * FROM api_keys WHERE key = ?').bind(key).first<KeySqlRow>();
			return row ? mapKeyRow(row) : null;
		},

		async getApiKeyById(id: string): Promise<ApiKeyRow | null> {
			const row = await raw.prepare('SELECT * FROM api_keys WHERE id = ?').bind(id).first<KeySqlRow>();
			return row ? mapKeyRow(row) : null;
		},

		async getApiKeyWithUserByKey(key: string): Promise<ResolvedGatewayKeyRow | null> {
			const row = await raw
				.prepare(`${resolvedSelect} WHERE k.key = ? AND k.status = ?`)
				.bind(key, 'active')
				.first<ResolvedSqlRow>();
			return row ? mapResolvedRow(row) : null;
		},

		async getApiKeyWithUserById(id: string): Promise<ResolvedGatewayKeyRow | null> {
			const row = await raw.prepare(`${resolvedSelect} WHERE k.id = ?`).bind(id).first<ResolvedSqlRow>();
			return row ? mapResolvedRow(row) : null;
		},

		async listKeysByUserId(userId: string, options?: { status?: string }): Promise<ApiKeyRow[]> {
			if (options?.status) {
				const rows = await raw
					.prepare('SELECT * FROM api_keys WHERE user_id = ? AND status = ? ORDER BY created_at ASC')
					.bind(userId, options.status)
					.all<KeySqlRow>();
				return (rows.results ?? []).map(mapKeyRow);
			}
			const rows = await raw
				.prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at ASC')
				.bind(userId)
				.all<KeySqlRow>();
			return (rows.results ?? []).map(mapKeyRow);
		},

		async insertApiKey(params: InsertKeyParams): Promise<void> {
			await buildInsertApiKeyStatement(raw, params).run();
		},

		async revokeApiKey(id: string): Promise<boolean> {
			const result = await raw
				.prepare('UPDATE api_keys SET status = ?, updated_at = datetime("now") WHERE id = ?')
				.bind('revoked', id)
				.run();
			return result.meta.changes > 0;
		},

		async deleteApiKeyHard(id: string, _secretKey: string): Promise<boolean> {
			const result = await raw.prepare('DELETE FROM api_keys WHERE id = ?').bind(id).run();
			return (result.meta.changes ?? 0) > 0;
		},

		async updateApiKeyStatusById(id: string, status: string): Promise<boolean> {
			const result = await raw
				.prepare('UPDATE api_keys SET status = ?, updated_at = datetime("now") WHERE id = ?')
				.bind(status, id)
				.run();
			return result.meta.changes > 0;
		},

		async setApiKeyMetadataById(id: string, metadataJson: string | null): Promise<boolean> {
			const result = await raw
				.prepare('UPDATE api_keys SET metadata = ?, updated_at = datetime("now") WHERE id = ?')
				.bind(metadataJson, id)
				.run();
			return result.meta.changes > 0;
		},

		async updateApiKeyName(id: string, name: string | null): Promise<boolean> {
			const result = await raw
				.prepare('UPDATE api_keys SET name = ?, updated_at = datetime("now") WHERE id = ?')
				.bind(name, id)
				.run();
			return result.meta.changes > 0;
		},

		async getAllApiKeys(options?: {
			email?: string;
			userId?: string;
			maxBudget?: BudgetFilter;
			page?: number;
			pageSize?: number;
		}): Promise<{ keys: AdminApiKeyListItem[]; total: number }> {
			const page = options?.page || 1;
			const pageSize = Math.min(options?.pageSize || 20, 100);
			const offset = (page - 1) * pageSize;
			const conditions: string[] = [];
			const bindValues: unknown[] = [];
			if (options?.email) {
				conditions.push('u.email LIKE ?');
				bindValues.push(`%${options.email}%`);
			}
			if (options?.userId) {
				conditions.push('k.user_id = ?');
				bindValues.push(options.userId);
			}
			if (options?.maxBudget === 'positive') conditions.push('u.budget_max > 0');
			else if (options?.maxBudget === 'zero_or_negative') conditions.push('u.budget_max <= 0');
			else if (options?.maxBudget === 'null') conditions.push('u.budget_max IS NULL');
			const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const orderBy =
				options?.maxBudget === 'positive'
					? 'ORDER BY u.budget_reset_at ASC NULLS LAST, k.created_at DESC'
					: 'ORDER BY k.created_at DESC';
			const countRow = await raw
				.prepare(`SELECT COUNT(*) as total FROM api_keys k INNER JOIN users u ON u.id = k.user_id ${whereClause}`)
				.bind(...bindValues)
				.first<{ total: number }>();
			const total = Number(countRow?.total ?? 0);
			const rows = await raw
				.prepare(
					`SELECT k.id, k.key, k.user_id, k.name, k.status, k.metadata, k.created_at, k.updated_at,
            u.email AS user_email, u.budget_max, u.budget_base, u.budget_spent, u.budget_period, u.budget_reset_at
       FROM api_keys k INNER JOIN users u ON u.id = k.user_id ${whereClause} ${orderBy} LIMIT ? OFFSET ?`
				)
				.bind(...bindValues, pageSize, offset)
				.all<{
					id: string;
					key: string;
					user_id: string;
					name: string | null;
					status: string;
					metadata: string | null;
					created_at: string;
					updated_at: string;
					user_email: string | null;
					budget_max: number | null;
					budget_base: number;
					budget_spent: number;
					budget_period: string;
					budget_reset_at: string | null;
				}>();
			const keys: AdminApiKeyListItem[] = (rows.results ?? []).map((r) => ({
				id: r.id,
				key: r.key,
				user_id: r.user_id,
				name: r.name,
				user_email: r.user_email,
				budget_max: r.budget_max == null ? null : roundGatewayMoney(Number(r.budget_max)),
				budget_base: r.budget_base == null ? 0 : roundGatewayMoney(Number(r.budget_base)),
				budget_spent: roundGatewayMoney(Number(r.budget_spent)),
				budget_period: r.budget_period,
				budget_reset_at: r.budget_reset_at,
				status: r.status,
				metadata: r.metadata,
				created_at: r.created_at,
				updated_at: r.updated_at,
			}));
			return { keys, total };
		},

		async getActiveApiKeysCount(): Promise<number> {
			const row = await raw
				.prepare('SELECT COUNT(*) as count FROM api_keys WHERE status = ?')
				.bind('active')
				.first<{ count: number }>();
			return Number(row?.count ?? 0);
		},
	};
}
