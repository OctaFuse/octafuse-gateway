/**
 * D1：`api_keys` 表实现。
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { ApiKeyRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { ApiKeysRepository } from '../../storage/gateway-repository-interfaces';
import type { ApiKeysD1Statements } from './d1-repository-extras';
import { buildInsertApiKeyBudgetAuditLogStatement } from './api-key-budget-audit-logs.impl';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import type { BudgetFilter, InsertKeyParams } from '../api-keys-types';
import type { AdminApiKeyListItem } from '../../storage/repository-dtos';

/** D1 read 的 api_keys 行（`budget_base` 列在旧库可能缺失或回填为 0）。 */
type ApiKeyD1ReadRow = {
	id: string;
	key: string;
	user_id: string;
	user_email: string | null;
	budget_max: number | null;
	budget_base: number | null;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
	status: string;
	metadata: string | null;
	created_at: string;
	updated_at: string;
};

function mapD1ApiKeyRow(r: ApiKeyD1ReadRow): ApiKeyRow {
	return {
		id: r.id,
		key: r.key,
		user_id: r.user_id,
		user_email: r.user_email,
		budget_max: r.budget_max,
		budget_base: r.budget_base == null ? 0 : roundGatewayMoney(Number(r.budget_base)),
		budget_spent: r.budget_spent,
		budget_period: r.budget_period,
		budget_reset_at: r.budget_reset_at,
		status: r.status,
		metadata: r.metadata,
		created_at: r.created_at,
		updated_at: r.updated_at,
	};
}

function mapD1AdminListRow(r: {
	id: string;
	key: string;
	user_id: string;
	user_email: string | null;
	budget_max: number | null;
	budget_base: number | null;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
	status: string;
	metadata: string | null;
	created_at: string;
	updated_at: string;
}): AdminApiKeyListItem {
	return {
		id: r.id,
		key: r.key,
		user_id: r.user_id,
		user_email: r.user_email,
		budget_max: r.budget_max,
		budget_base: r.budget_base == null ? 0 : roundGatewayMoney(Number(r.budget_base)),
		budget_spent: r.budget_spent,
		budget_period: r.budget_period,
		budget_reset_at: r.budget_reset_at,
		status: r.status,
		metadata: r.metadata,
		created_at: r.created_at,
		updated_at: r.updated_at,
	};
}

export function buildInsertApiKeyStatement(db: D1Database, params: InsertKeyParams): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO api_keys (id, key, user_id, user_email, budget_max, budget_base, budget_spent, budget_period, budget_reset_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			params.id,
			params.key,
			params.userId,
			params.userEmail ?? null,
			params.budgetMax != null ? roundGatewayMoney(params.budgetMax) : null,
			params.budgetBase != null ? roundGatewayMoney(params.budgetBase) : 0,
			roundGatewayMoney(params.budgetSpent),
			params.budgetPeriod,
			params.budgetResetAt,
			params.status
		);
}

export function buildIncrementApiKeyBudgetSpentStatement(db: D1Database, id: string, amount: number): D1PreparedStatement {
	return db
		.prepare(`UPDATE api_keys SET budget_spent = budget_spent + ?, updated_at = datetime('now') WHERE id = ?`)
		.bind(roundGatewayMoney(amount), id);
}

export function createD1ApiKeysRepository(db: D1DatabaseClient): ApiKeysRepository & ApiKeysD1Statements {
	const raw = db.raw;
	return {
		buildInsertApiKeyStatement,
		buildIncrementApiKeyBudgetSpentStatement,

		async getApiKeyByKey(key: string): Promise<ApiKeyRow | null> {
			const row = await raw
				.prepare('SELECT * FROM api_keys WHERE key = ? AND status = ?')
				.bind(key, 'active')
				.first<ApiKeyD1ReadRow>();
			return row ? mapD1ApiKeyRow(row) : null;
		},

		async getApiKeyByKeyAnyStatus(key: string): Promise<ApiKeyRow | null> {
			const row = await raw.prepare('SELECT * FROM api_keys WHERE key = ?').bind(key).first<ApiKeyD1ReadRow>();
			return row ? mapD1ApiKeyRow(row) : null;
		},

		async getApiKeyById(id: string): Promise<ApiKeyRow | null> {
			const row = await raw.prepare('SELECT * FROM api_keys WHERE id = ?').bind(id).first<ApiKeyD1ReadRow>();
			return row ? mapD1ApiKeyRow(row) : null;
		},

		async getApiKeyByUserId(userId: string): Promise<ApiKeyRow | null> {
			const row = await raw
				.prepare('SELECT * FROM api_keys WHERE user_id = ? AND status = ?')
				.bind(userId, 'active')
				.first<ApiKeyD1ReadRow>();
			return row ? mapD1ApiKeyRow(row) : null;
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

		async setApiKeyUserEmailById(id: string, userEmail: string | null): Promise<boolean> {
			const result = await raw
				.prepare('UPDATE api_keys SET user_email = ?, updated_at = datetime("now") WHERE id = ?')
				.bind(userEmail, id)
				.run();
			return result.meta.changes > 0;
		},

		async updateApiKeyBudget(id: string, budget_spent: number, budget_reset_at: string | null): Promise<void> {
			await raw
				.prepare('UPDATE api_keys SET budget_spent = ?, budget_reset_at = ?, updated_at = datetime("now") WHERE id = ?')
				.bind(roundGatewayMoney(budget_spent), budget_reset_at, id)
				.run();
		},

		async buildUpdateApiKeyBudgetStatement(id: string, budget_spent: number, budget_reset_at: string | null): Promise<void> {
			await raw
				.prepare('UPDATE api_keys SET budget_spent = ?, budget_reset_at = ?, updated_at = datetime("now") WHERE id = ?')
				.bind(roundGatewayMoney(budget_spent), budget_reset_at, id)
				.run();
		},

		async updateApiKeyBudgetWithAudit(
			id: string,
			budget_spent: number,
			budget_reset_at: string | null,
			audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>
		): Promise<void> {
			await raw.batch([
				raw
					.prepare('UPDATE api_keys SET budget_spent = ?, budget_reset_at = ?, updated_at = datetime("now") WHERE id = ?')
					.bind(roundGatewayMoney(budget_spent), budget_reset_at, id),
				buildInsertApiKeyBudgetAuditLogStatement(raw, {
					id: crypto.randomUUID(),
					apiKeyId: id,
					eventType: audit.eventType,
					actorType: audit.actorType,
					actorId: audit.actorId ?? null,
					reasonCode: audit.reasonCode ?? null,
					reasonText: audit.reasonText ?? null,
					beforeSpent: audit.beforeSpent,
					deltaSpent: audit.deltaSpent,
					afterSpent: budget_spent,
					beforeBudgetMax: audit.beforeBudgetMax ?? null,
					afterBudgetMax: audit.afterBudgetMax ?? null,
					beforeBudgetPeriod: audit.beforeBudgetPeriod ?? null,
					afterBudgetPeriod: audit.afterBudgetPeriod ?? null,
					beforeBudgetResetAt: audit.beforeBudgetResetAt ?? null,
					afterBudgetResetAt: budget_reset_at,
					requestLogId: audit.requestLogId ?? null,
					metadata: audit.metadata ?? null,
				}),
			]);
		},

		async updateApiKeyPlan(
			id: string,
			budget_max: number | null,
			budget_period: string,
			budget_reset_at: string | null,
			resetBudget: boolean = true,
			metadata?: string | null,
			budget_spent_override?: number | null,
			budget_base?: number | null
		): Promise<boolean> {
			const setClauses: string[] = ['budget_max = ?', 'budget_period = ?', 'budget_reset_at = ?', 'updated_at = datetime("now")'];
			const bindValues: unknown[] = [
				budget_max != null ? roundGatewayMoney(budget_max) : null,
				budget_period,
				budget_reset_at ?? null,
			];

			if (budget_spent_override !== undefined) {
				setClauses.push('budget_spent = ?');
				bindValues.push(roundGatewayMoney(budget_spent_override ?? 0));
			} else if (resetBudget) {
				setClauses.push('budget_spent = 0');
			}

			if (budget_base !== undefined) {
				setClauses.push('budget_base = ?');
				bindValues.push(budget_base != null ? roundGatewayMoney(budget_base) : 0);
			}

			if (metadata !== undefined) {
				setClauses.push('metadata = ?');
				bindValues.push(metadata);
			}

			bindValues.push(id);
			const result = await raw
				.prepare(`UPDATE api_keys SET ${setClauses.join(', ')} WHERE id = ?`)
				.bind(...bindValues)
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

		async getAllApiKeys(options?: {
			email?: string;
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
				conditions.push('user_email LIKE ?');
				bindValues.push(`%${options.email}%`);
			}
			if (options?.maxBudget === 'positive') conditions.push('budget_max > 0');
			else if (options?.maxBudget === 'zero_or_negative') conditions.push('budget_max <= 0');
			else if (options?.maxBudget === 'null') conditions.push('budget_max IS NULL');

			const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const orderBy =
				options?.maxBudget === 'positive'
					? 'ORDER BY budget_reset_at ASC NULLS LAST, created_at DESC'
					: 'ORDER BY created_at DESC';

			const countRow = await raw
				.prepare(`SELECT COUNT(*) as total FROM api_keys ${whereClause}`)
				.bind(...bindValues)
				.first<{ total: number }>();
			const total = Number(countRow?.total ?? 0);

			const rows = await raw
				.prepare(
					`SELECT id, key, user_id, user_email, budget_max, budget_base, budget_spent, budget_period, budget_reset_at, status, metadata, created_at, updated_at
       FROM api_keys ${whereClause} ${orderBy} LIMIT ? OFFSET ?`
				)
				.bind(...bindValues, pageSize, offset)
				.all<{
					id: string;
					key: string;
					user_id: string;
					user_email: string | null;
					budget_max: number | null;
					budget_base: number | null;
					budget_spent: number;
					budget_period: string;
					budget_reset_at: string | null;
					status: string;
					metadata: string | null;
					created_at: string;
					updated_at: string;
				}>();

			return { keys: (rows.results ?? []).map(mapD1AdminListRow), total };
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
