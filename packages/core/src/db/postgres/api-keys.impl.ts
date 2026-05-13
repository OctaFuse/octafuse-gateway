/**
 * Postgres：`api_keys` 表（Drizzle）。
 */
import { and, count, desc, eq, gt, isNotNull, isNull, like, lte, sql } from 'drizzle-orm';
import type { ApiKeyRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { ApiKeysRepository } from '../../storage/gateway-repository-interfaces';
import { apiKeyAuditLogsTable as pgAuditTable, apiKeysTable as pgApiKeysTable } from '../../storage/drizzle/schema.pg';
import type { InsertApiKeyBudgetAuditLogParams } from '../api-key-budget-audit-logs-types';
import type { BudgetFilter, InsertKeyParams } from '../api-keys-types';
import type { AdminApiKeyListItem } from '../../storage/repository-dtos';

function mapPgAdminListRow(r: {
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

function mapPgApiKeyRow(r: {
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

export function createPostgresApiKeysRepository(db: PostgresDatabaseClient): ApiKeysRepository {
	const drizzle = db.drizzle;
	return {
		async getApiKeyByKey(key: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle
				.select()
				.from(pgApiKeysTable)
				.where(and(eq(pgApiKeysTable.key, key), eq(pgApiKeysTable.status, 'active')))
				.limit(1);
			return rows[0] ? mapPgApiKeyRow(rows[0]) : null;
		},

		async getApiKeyByKeyAnyStatus(key: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle.select().from(pgApiKeysTable).where(eq(pgApiKeysTable.key, key)).limit(1);
			return rows[0] ? mapPgApiKeyRow(rows[0]) : null;
		},

		async getApiKeyById(id: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle.select().from(pgApiKeysTable).where(eq(pgApiKeysTable.id, id)).limit(1);
			return rows[0] ? mapPgApiKeyRow(rows[0]) : null;
		},

		async getApiKeyByUserId(userId: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle
				.select()
				.from(pgApiKeysTable)
				.where(and(eq(pgApiKeysTable.userId, userId), eq(pgApiKeysTable.status, 'active')))
				.limit(1);
			return rows[0] ? mapPgApiKeyRow(rows[0]) : null;
		},

		async insertApiKey(params: InsertKeyParams): Promise<void> {
			const now = new Date().toISOString();
			await drizzle.insert(pgApiKeysTable).values({
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
			const updated = await drizzle
				.update(pgApiKeysTable)
				.set({ status: 'revoked', updatedAt: now })
				.where(eq(pgApiKeysTable.id, id))
				.returning({ id: pgApiKeysTable.id });
			return updated.length > 0;
		},

		async deleteApiKeyHard(id: string, _secretKey: string): Promise<boolean> {
			const r = await drizzle.delete(pgApiKeysTable).where(eq(pgApiKeysTable.id, id)).returning({ id: pgApiKeysTable.id });
			return r.length > 0;
		},

		async updateApiKeyStatusById(id: string, status: string): Promise<boolean> {
			const now = new Date().toISOString();
			const updated = await drizzle
				.update(pgApiKeysTable)
				.set({ status, updatedAt: now })
				.where(eq(pgApiKeysTable.id, id))
				.returning({ id: pgApiKeysTable.id });
			return updated.length > 0;
		},

		async setApiKeyUserEmailById(id: string, userEmail: string | null): Promise<boolean> {
			const now = new Date().toISOString();
			const updated = await drizzle
				.update(pgApiKeysTable)
				.set({ userEmail, updatedAt: now })
				.where(eq(pgApiKeysTable.id, id))
				.returning({ id: pgApiKeysTable.id });
			return updated.length > 0;
		},

		async updateApiKeyBudget(id: string, budget_spent: number, budget_reset_at: string | null): Promise<void> {
			const now = new Date().toISOString();
			await drizzle
				.update(pgApiKeysTable)
				.set({
					budgetSpent: String(roundGatewayMoney(budget_spent)),
					budgetResetAt: budget_reset_at,
					updatedAt: now,
				})
				.where(eq(pgApiKeysTable.id, id));
		},

		async buildUpdateApiKeyBudgetStatement(id: string, budget_spent: number, budget_reset_at: string | null): Promise<void> {
			const now = new Date().toISOString();
			await drizzle
				.update(pgApiKeysTable)
				.set({
					budgetSpent: String(roundGatewayMoney(budget_spent)),
					budgetResetAt: budget_reset_at,
					updatedAt: now,
				})
				.where(eq(pgApiKeysTable.id, id));
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
					.update(pgApiKeysTable)
					.set({
						budgetSpent: String(roundGatewayMoney(budget_spent)),
						budgetResetAt: budget_reset_at,
						updatedAt: now,
					})
					.where(eq(pgApiKeysTable.id, id));
				await tx.insert(pgAuditTable).values({
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
			const baseSet: Record<string, unknown> = {
				budgetMax: budget_max != null ? String(roundGatewayMoney(budget_max)) : null,
				budgetPeriod: budget_period,
				budgetResetAt: budget_reset_at,
				updatedAt: now,
			};
			if (budget_base !== undefined) {
				baseSet.budgetBase = String(budget_base != null ? roundGatewayMoney(budget_base) : 0);
			}

			if (budget_spent_override !== undefined) {
				const updated = await drizzle
					.update(pgApiKeysTable)
					.set({
						...baseSet,
						budgetSpent: String(roundGatewayMoney(budget_spent_override ?? 0)),
						...(metadata !== undefined ? { metadata } : {}),
					})
					.where(eq(pgApiKeysTable.id, id))
					.returning({ id: pgApiKeysTable.id });
				return updated.length > 0;
			}
			if (resetBudget) {
				const updated = await drizzle
					.update(pgApiKeysTable)
					.set({
						...baseSet,
						budgetSpent: '0',
						...(metadata !== undefined ? { metadata } : {}),
					})
					.where(eq(pgApiKeysTable.id, id))
					.returning({ id: pgApiKeysTable.id });
				return updated.length > 0;
			}
			const updated = await drizzle
				.update(pgApiKeysTable)
				.set({
					...baseSet,
					...(metadata !== undefined ? { metadata } : {}),
				})
				.where(eq(pgApiKeysTable.id, id))
				.returning({ id: pgApiKeysTable.id });
			return updated.length > 0;
		},

		async setApiKeyMetadataById(id: string, metadataJson: string | null): Promise<boolean> {
			const now = new Date().toISOString();
			const updated = await drizzle
				.update(pgApiKeysTable)
				.set({ metadata: metadataJson, updatedAt: now })
				.where(eq(pgApiKeysTable.id, id))
				.returning({ id: pgApiKeysTable.id });
			return updated.length > 0;
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
				conditions.push(like(pgApiKeysTable.userEmail, `%${options.email}%`));
			}
			if (options?.maxBudget === 'positive') {
				conditions.push(and(isNotNull(pgApiKeysTable.budgetMax), gt(pgApiKeysTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'zero_or_negative') {
				conditions.push(and(isNotNull(pgApiKeysTable.budgetMax), lte(pgApiKeysTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'null') {
				conditions.push(isNull(pgApiKeysTable.budgetMax));
			}
			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

			let countQ = drizzle.select({ total: count() }).from(pgApiKeysTable);
			if (whereExpr) {
				countQ = countQ.where(whereExpr) as typeof countQ;
			}
			const total = Number((await countQ)[0]?.total ?? 0);

			let listQ = drizzle
				.select({
					id: pgApiKeysTable.id,
					key: pgApiKeysTable.key,
					user_id: pgApiKeysTable.userId,
					user_email: pgApiKeysTable.userEmail,
					budget_max: pgApiKeysTable.budgetMax,
					budget_base: pgApiKeysTable.budgetBase,
					budget_spent: pgApiKeysTable.budgetSpent,
					budget_period: pgApiKeysTable.budgetPeriod,
					budget_reset_at: pgApiKeysTable.budgetResetAt,
					status: pgApiKeysTable.status,
					metadata: pgApiKeysTable.metadata,
					created_at: pgApiKeysTable.createdAt,
					updated_at: pgApiKeysTable.updatedAt,
				})
				.from(pgApiKeysTable);
			if (whereExpr) {
				listQ = listQ.where(whereExpr) as typeof listQ;
			}
			if (options?.maxBudget === 'positive') {
				const rows = await listQ
					.orderBy(sql`${pgApiKeysTable.budgetResetAt} ASC NULLS LAST`, desc(pgApiKeysTable.createdAt))
					.limit(pageSize)
					.offset(offset);
				return {
					keys: rows.map(mapPgAdminListRow),
					total,
				};
			}
			const rows = await listQ.orderBy(desc(pgApiKeysTable.createdAt)).limit(pageSize).offset(offset);
			return { keys: rows.map(mapPgAdminListRow), total };
		},

		async getActiveApiKeysCount(): Promise<number> {
			const row = await drizzle
				.select({ c: count() })
				.from(pgApiKeysTable)
				.where(eq(pgApiKeysTable.status, 'active'));
			return Number(row[0]?.c ?? 0);
		},
	};
}
