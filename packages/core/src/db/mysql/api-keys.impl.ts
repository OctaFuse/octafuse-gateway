/**
 * MySQL：`api_keys` 表（Drizzle + mysql2）。
 */
import { and, count, eq, isNotNull, isNull, like, lte, gt } from 'drizzle-orm';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { ApiKeyRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { ApiKeysRepository } from '../../storage/gateway-repository-interfaces';
import { asMySqlPool } from './mysql2-compat';
import { apiKeyAuditLogsTable as myAuditTable, apiKeysTable as myApiKeysTable } from '../../storage/drizzle/schema.mysql';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import type { BudgetFilter, InsertKeyParams } from '../api-keys-types';
import type { AdminApiKeyListItem } from '../../storage/repository-dtos';

function mapMyAdminListRow(r: {
	id: string;
	key: string;
	user_id: string;
	user_email: string | null;
	budget_max: string | null;
	budget_base: string | null;
	budget_spent: string;
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
		budget_max: r.budget_max == null ? null : roundGatewayMoney(Number(r.budget_max)),
		budget_base: r.budget_base == null ? 0 : roundGatewayMoney(Number(r.budget_base)),
		budget_spent: roundGatewayMoney(Number(r.budget_spent)),
		budget_period: r.budget_period,
		budget_reset_at: r.budget_reset_at,
		status: r.status,
		metadata: r.metadata,
		created_at: r.created_at,
		updated_at: r.updated_at,
	};
}

function mapMyApiKeyRow(r: {
	id: string;
	key: string;
	userId: string;
	userEmail: string | null;
	budgetMax: string | null;
	budgetBase: string | null;
	budgetSpent: string;
	budgetPeriod: string;
	budgetResetAt: string | null;
	status: string;
	metadata: string | null;
	createdAt: string;
	updatedAt: string;
}): ApiKeyRow {
	return {
		id: r.id,
		key: r.key,
		user_id: r.userId,
		user_email: r.userEmail,
		budget_max: r.budgetMax == null ? null : roundGatewayMoney(Number(r.budgetMax)),
		budget_base: r.budgetBase == null ? 0 : roundGatewayMoney(Number(r.budgetBase)),
		budget_spent: roundGatewayMoney(Number(r.budgetSpent)),
		budget_period: r.budgetPeriod,
		budget_reset_at: r.budgetResetAt,
		status: r.status,
		metadata: r.metadata,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function createMySqlApiKeysRepository(db: MySqlDatabaseClient): ApiKeysRepository {
	const drizzle = db.drizzle;
	const pool = asMySqlPool(db.raw);

	return {
		async getApiKeyByKey(key: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle
				.select()
				.from(myApiKeysTable)
				.where(and(eq(myApiKeysTable.key, key), eq(myApiKeysTable.status, 'active')))
				.limit(1);
			return rows[0] ? mapMyApiKeyRow(rows[0]) : null;
		},

		async getApiKeyByKeyAnyStatus(key: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle.select().from(myApiKeysTable).where(eq(myApiKeysTable.key, key)).limit(1);
			return rows[0] ? mapMyApiKeyRow(rows[0]) : null;
		},

		async getApiKeyById(id: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle.select().from(myApiKeysTable).where(eq(myApiKeysTable.id, id)).limit(1);
			return rows[0] ? mapMyApiKeyRow(rows[0]) : null;
		},

		async getApiKeyByUserId(userId: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle
				.select()
				.from(myApiKeysTable)
				.where(and(eq(myApiKeysTable.userId, userId), eq(myApiKeysTable.status, 'active')))
				.limit(1);
			return rows[0] ? mapMyApiKeyRow(rows[0]) : null;
		},

		async insertApiKey(params: InsertKeyParams): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(myApiKeysTable).values({
				id: params.id,
				key: params.key,
				userId: params.userId,
				userEmail: params.userEmail ?? null,
				budgetMax: params.budgetMax == null ? null : String(roundGatewayMoney(params.budgetMax)),
				budgetBase: String(params.budgetBase != null ? roundGatewayMoney(params.budgetBase) : 0),
				budgetSpent: String(roundGatewayMoney(params.budgetSpent)),
				budgetPeriod: params.budgetPeriod,
				budgetResetAt: params.budgetResetAt,
				status: params.status,
				metadata: null,
				createdAt: now,
				updatedAt: now,
			});
		},

		async revokeApiKey(id: string): Promise<boolean> {
			const now = new Date().toISOString();
			const [result] = await pool.execute<ResultSetHeader>('UPDATE api_keys SET status = ?, updated_at = ? WHERE id = ?', [
				'revoked',
				now,
				id,
			]);
			return result.affectedRows > 0;
		},

		async deleteApiKeyHard(id: string, _secretKey: string): Promise<boolean> {
			const [result] = await pool.execute<ResultSetHeader>('DELETE FROM api_keys WHERE id = ?', [id]);
			return result.affectedRows > 0;
		},

		async updateApiKeyStatusById(id: string, status: string): Promise<boolean> {
			const now = new Date().toISOString();
			const [result] = await pool.execute<ResultSetHeader>('UPDATE api_keys SET status = ?, updated_at = ? WHERE id = ?', [
				status,
				now,
				id,
			]);
			return result.affectedRows > 0;
		},

		async setApiKeyUserEmailById(id: string, userEmail: string | null): Promise<boolean> {
			const now = new Date().toISOString();
			const [result] = await pool.execute<ResultSetHeader>(
				'UPDATE api_keys SET user_email = ?, updated_at = ? WHERE id = ?',
				[userEmail, now, id]
			);
			return result.affectedRows > 0;
		},

		async updateApiKeyBudget(id: string, budget_spent: number, budget_reset_at: string | null): Promise<void> {
			const now = new Date().toISOString();
			await drizzle
				.update(myApiKeysTable)
				.set({
					budgetSpent: String(roundGatewayMoney(budget_spent)),
					budgetResetAt: budget_reset_at,
					updatedAt: now,
				})
				.where(eq(myApiKeysTable.id, id));
		},

		async buildUpdateApiKeyBudgetStatement(id: string, budget_spent: number, budget_reset_at: string | null): Promise<void> {
			const now = new Date().toISOString();
			await drizzle
				.update(myApiKeysTable)
				.set({
					budgetSpent: String(roundGatewayMoney(budget_spent)),
					budgetResetAt: budget_reset_at,
					updatedAt: now,
				})
				.where(eq(myApiKeysTable.id, id));
		},

		async updateApiKeyBudgetWithAudit(
			id: string,
			budget_spent: number,
			budget_reset_at: string | null,
			audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>
		): Promise<void> {
			const now = new Date().toISOString();
			const auditId = crypto.randomUUID();
			await drizzle.transaction(async (tx) => {
				await tx
					.update(myApiKeysTable)
					.set({
						budgetSpent: String(roundGatewayMoney(budget_spent)),
						budgetResetAt: budget_reset_at,
						updatedAt: now,
					})
					.where(eq(myApiKeysTable.id, id));
				await tx.insert(myAuditTable).values({
					id: auditId,
					apiKeyId: id,
					eventType: audit.eventType,
					actorType: audit.actorType,
					actorId: audit.actorId ?? null,
					reasonCode: audit.reasonCode ?? null,
					reasonText: audit.reasonText ?? null,
					beforeSpent: String(roundGatewayMoney(audit.beforeSpent)),
					deltaSpent: String(roundGatewayMoney(audit.deltaSpent)),
					afterSpent: String(roundGatewayMoney(budget_spent)),
					beforeBudgetMax: audit.beforeBudgetMax == null ? null : String(roundGatewayMoney(audit.beforeBudgetMax)),
					afterBudgetMax: audit.afterBudgetMax == null ? null : String(roundGatewayMoney(audit.afterBudgetMax)),
					beforeBudgetPeriod: audit.beforeBudgetPeriod ?? null,
					afterBudgetPeriod: audit.afterBudgetPeriod ?? null,
					beforeBudgetResetAt: audit.beforeBudgetResetAt ?? null,
					afterBudgetResetAt: budget_reset_at,
					requestLogId: audit.requestLogId ?? null,
					metadata: audit.metadata ?? null,
					createdAt: now,
				});
			});
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
			const now = new Date().toISOString();
			const setClauses: string[] = [
				'budget_max = ?',
				'budget_period = ?',
				'budget_reset_at = ?',
				'updated_at = ?',
			];
			const bindValues: unknown[] = [
				budget_max != null ? String(roundGatewayMoney(budget_max)) : null,
				budget_period,
				budget_reset_at ?? null,
				now,
			];

			if (budget_spent_override !== undefined) {
				setClauses.push('budget_spent = ?');
				bindValues.push(String(roundGatewayMoney(budget_spent_override ?? 0)));
			} else if (resetBudget) {
				setClauses.push('budget_spent = ?');
				bindValues.push('0');
			}

			if (budget_base !== undefined) {
				setClauses.push('budget_base = ?');
				bindValues.push(String(budget_base != null ? roundGatewayMoney(budget_base) : 0));
			}

			if (metadata !== undefined) {
				setClauses.push('metadata = ?');
				bindValues.push(metadata);
			}

			bindValues.push(id);
			const [result] = await pool.execute<ResultSetHeader>(`UPDATE api_keys SET ${setClauses.join(', ')} WHERE id = ?`, bindValues);
			return result.affectedRows > 0;
		},

		async setApiKeyMetadataById(id: string, metadataJson: string | null): Promise<boolean> {
			const now = new Date().toISOString();
			const [result] = await pool.execute<ResultSetHeader>('UPDATE api_keys SET metadata = ?, updated_at = ? WHERE id = ?', [
				metadataJson,
				now,
				id,
			]);
			return result.affectedRows > 0;
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

			const conditions = [];
			if (options?.email) {
				conditions.push(like(myApiKeysTable.userEmail, `%${options.email}%`));
			}
			if (options?.maxBudget === 'positive') {
				conditions.push(and(isNotNull(myApiKeysTable.budgetMax), gt(myApiKeysTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'zero_or_negative') {
				conditions.push(and(isNotNull(myApiKeysTable.budgetMax), lte(myApiKeysTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'null') {
				conditions.push(isNull(myApiKeysTable.budgetMax));
			}
			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

			let countQ = drizzle.select({ total: count() }).from(myApiKeysTable);
			if (whereExpr) {
				countQ = countQ.where(whereExpr) as typeof countQ;
			}
			const total = Number((await countQ)[0]?.total ?? 0);

			const whereSqlParts: string[] = [];
			const bindValues: unknown[] = [];
			if (options?.email) {
				whereSqlParts.push('user_email LIKE ?');
				bindValues.push(`%${options.email}%`);
			}
			if (options?.maxBudget === 'positive') {
				whereSqlParts.push('budget_max IS NOT NULL', 'budget_max > ?');
				bindValues.push('0');
			} else if (options?.maxBudget === 'zero_or_negative') {
				whereSqlParts.push('budget_max IS NOT NULL', 'budget_max <= ?');
				bindValues.push('0');
			} else if (options?.maxBudget === 'null') {
				whereSqlParts.push('budget_max IS NULL');
			}
			const whereClause = whereSqlParts.length > 0 ? `WHERE ${whereSqlParts.join(' AND ')}` : '';
			const orderBy =
				options?.maxBudget === 'positive'
					? 'ORDER BY budget_reset_at IS NULL ASC, budget_reset_at ASC, created_at DESC'
					: 'ORDER BY created_at DESC';

			const [rows] = await pool.query<
				(RowDataPacket & {
					id: string;
					key: string;
					user_id: string;
					user_email: string | null;
					budget_max: string | null;
					budget_base: string | null;
					budget_spent: string;
					budget_period: string;
					budget_reset_at: string | null;
					status: string;
					metadata: string | null;
					created_at: string;
					updated_at: string;
				})[]
			>(
				`SELECT id, \`key\`, user_id, user_email, budget_max, budget_base, budget_spent, budget_period, budget_reset_at, status, metadata, created_at, updated_at
				 FROM api_keys ${whereClause} ${orderBy} LIMIT ? OFFSET ?`,
				[...bindValues, pageSize, offset]
			);

			return {
				keys: rows.map((row) => mapMyAdminListRow(row)),
				total,
			};
		},

		async getActiveApiKeysCount(): Promise<number> {
			const row = await drizzle
				.select({ c: count() })
				.from(myApiKeysTable)
				.where(eq(myApiKeysTable.status, 'active'));
			return Number(row[0]?.c ?? 0);
		},
	};
}
