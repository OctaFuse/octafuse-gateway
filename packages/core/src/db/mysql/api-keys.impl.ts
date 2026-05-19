/**
 * MySQL：`api_keys`（预算在 `users`）。
 */
import { and, asc, count, desc, eq, gt, isNotNull, isNull, like, lte, sql } from 'drizzle-orm';
import type { ApiKeyRow, ResolvedGatewayKeyRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { ApiKeysRepository } from '../../storage/gateway-repository-interfaces';
import { apiKeysTable as myApiKeysTable, usersTable as myUsersTable } from '../../storage/drizzle/schema.mysql';
import type { BudgetFilter, InsertKeyParams } from '../api-keys-types';
import {
	DEFAULT_API_KEY_LIST_ORDER,
	DEFAULT_API_KEY_LIST_SORT,
	type ApiKeyListSortField,
	type ApiKeyListSortOrder,
} from '../api-keys-list-sort';
import type { AdminApiKeyListItem } from '../../storage/repository-dtos';
import { parseMoney } from '../../storage/critical-write-paths-utils';

function apiKeyListOrderBy(sort: ApiKeyListSortField, order: ApiKeyListSortOrder) {
	const isAsc = order === 'asc';
	if (sort === 'budget_reset_at') {
		const col = myUsersTable.budgetResetAt;
		return isAsc ? sql`${col} ASC NULLS LAST` : sql`${col} DESC NULLS FIRST`;
	}
	if (sort === 'budget_spent') {
		return isAsc ? asc(myUsersTable.budgetSpent) : desc(myUsersTable.budgetSpent);
	}
	return isAsc ? asc(myApiKeysTable.createdAt) : desc(myApiKeysTable.createdAt);
}

function mapMyKeyRow(r: {
	id: string;
	key: string;
	userId: string;
	name: string | null;
	status: string;
	metadata: string | null;
	lastUsedAt: string | null;
	createdAt: string;
	updatedAt: string;
}): ApiKeyRow {
	return {
		id: r.id,
		key: r.key,
		user_id: r.userId,
		name: r.name,
		status: r.status,
		metadata: r.metadata,
		last_used_at: r.lastUsedAt,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

function mapMyResolvedRow(
	r: {
		id: string;
		key: string;
		userId: string;
		name: string | null;
		status: string;
		metadata: string | null;
		lastUsedAt: string | null;
		createdAt: string;
		updatedAt: string;
		userEmail: string | null;
		budgetMax: string | null;
		budgetBase: string;
		budgetSpent: string;
		budgetPeriod: string;
		budgetResetAt: string | null;
		userMetadata: string | null;
	}
): ResolvedGatewayKeyRow {
	const k = mapMyKeyRow(r);
	return {
		...k,
		user_email: r.userEmail,
		user_metadata: r.userMetadata,
		budget_max: r.budgetMax == null ? null : parseMoney(r.budgetMax),
		budget_base: parseMoney(r.budgetBase),
		budget_spent: parseMoney(r.budgetSpent),
		budget_period: r.budgetPeriod,
		budget_reset_at: r.budgetResetAt,
	};
}

function mapMyAdminListRow(r: {
	id: string;
	key: string;
	user_id: string;
	name: string | null;
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
	};
}

const resolvedCols = {
	id: myApiKeysTable.id,
	key: myApiKeysTable.key,
	userId: myApiKeysTable.userId,
	name: myApiKeysTable.name,
	status: myApiKeysTable.status,
	metadata: myApiKeysTable.metadata,
	lastUsedAt: myApiKeysTable.lastUsedAt,
	createdAt: myApiKeysTable.createdAt,
	updatedAt: myApiKeysTable.updatedAt,
	userEmail: myUsersTable.email,
	budgetMax: myUsersTable.budgetMax,
	budgetBase: myUsersTable.budgetBase,
	budgetSpent: myUsersTable.budgetSpent,
	budgetPeriod: myUsersTable.budgetPeriod,
	budgetResetAt: myUsersTable.budgetResetAt,
	userMetadata: myUsersTable.metadata,
} as const;

export function createMySqlApiKeysRepository(db: MySqlDatabaseClient): ApiKeysRepository {
	const drizzle = db.drizzle;
	return {
		async getApiKeyByKey(key: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle
				.select()
				.from(myApiKeysTable)
				.where(and(eq(myApiKeysTable.key, key), eq(myApiKeysTable.status, 'active')))
				.limit(1);
			return rows[0] ? mapMyKeyRow(rows[0]) : null;
		},

		async getApiKeyByKeyAnyStatus(key: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle.select().from(myApiKeysTable).where(eq(myApiKeysTable.key, key)).limit(1);
			return rows[0] ? mapMyKeyRow(rows[0]) : null;
		},

		async getApiKeyById(id: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle.select().from(myApiKeysTable).where(eq(myApiKeysTable.id, id)).limit(1);
			return rows[0] ? mapMyKeyRow(rows[0]) : null;
		},

		async getApiKeyWithUserByKey(key: string): Promise<ResolvedGatewayKeyRow | null> {
			const rows = await drizzle
				.select(resolvedCols)
				.from(myApiKeysTable)
				.innerJoin(myUsersTable, eq(myApiKeysTable.userId, myUsersTable.id))
				.where(and(eq(myApiKeysTable.key, key), eq(myApiKeysTable.status, 'active')))
				.limit(1);
			return rows[0] ? mapMyResolvedRow(rows[0]) : null;
		},

		async getApiKeyWithUserById(id: string): Promise<ResolvedGatewayKeyRow | null> {
			const rows = await drizzle
				.select(resolvedCols)
				.from(myApiKeysTable)
				.innerJoin(myUsersTable, eq(myApiKeysTable.userId, myUsersTable.id))
				.where(eq(myApiKeysTable.id, id))
				.limit(1);
			return rows[0] ? mapMyResolvedRow(rows[0]) : null;
		},

		async listKeysByUserId(userId: string, options?: { status?: string }): Promise<ApiKeyRow[]> {
			const where = options?.status
				? and(eq(myApiKeysTable.userId, userId), eq(myApiKeysTable.status, options.status))
				: eq(myApiKeysTable.userId, userId);
			const rows = await drizzle.select().from(myApiKeysTable).where(where).orderBy(myApiKeysTable.createdAt);
			return rows.map(mapMyKeyRow);
		},

		async insertApiKey(params: InsertKeyParams): Promise<void> {
			const now = new Date().toISOString();
			const status = params.status ?? 'active';
			await drizzle.insert(myApiKeysTable).values({
				id: params.id,
				key: params.key,
				userId: params.userId,
				name: params.name ?? null,
				status,
				metadata: params.metadata ?? null,
				lastUsedAt: null,
				createdAt: now,
				updatedAt: now,
			});
		},

		async revokeApiKey(id: string): Promise<boolean> {
			const existing = await drizzle
				.select({ id: myApiKeysTable.id })
				.from(myApiKeysTable)
				.where(eq(myApiKeysTable.id, id))
				.limit(1);
			if (!existing[0]) return false;
			const now = new Date().toISOString();
			await drizzle.update(myApiKeysTable).set({ status: 'revoked', updatedAt: now }).where(eq(myApiKeysTable.id, id));
			return true;
		},

		async deleteApiKeyHard(id: string, _secretKey: string): Promise<boolean> {
			const existing = await drizzle
				.select({ id: myApiKeysTable.id })
				.from(myApiKeysTable)
				.where(eq(myApiKeysTable.id, id))
				.limit(1);
			if (!existing[0]) return false;
			await drizzle.delete(myApiKeysTable).where(eq(myApiKeysTable.id, id));
			return true;
		},

		async updateApiKeyStatusById(id: string, status: string): Promise<boolean> {
			const existing = await drizzle
				.select({ id: myApiKeysTable.id })
				.from(myApiKeysTable)
				.where(eq(myApiKeysTable.id, id))
				.limit(1);
			if (!existing[0]) return false;
			const now = new Date().toISOString();
			await drizzle.update(myApiKeysTable).set({ status, updatedAt: now }).where(eq(myApiKeysTable.id, id));
			return true;
		},

		async setApiKeyMetadataById(id: string, metadataJson: string | null): Promise<boolean> {
			const existing = await drizzle
				.select({ id: myApiKeysTable.id })
				.from(myApiKeysTable)
				.where(eq(myApiKeysTable.id, id))
				.limit(1);
			if (!existing[0]) return false;
			const now = new Date().toISOString();
			await drizzle.update(myApiKeysTable).set({ metadata: metadataJson, updatedAt: now }).where(eq(myApiKeysTable.id, id));
			return true;
		},

		async updateApiKeyName(id: string, name: string | null): Promise<boolean> {
			const existing = await drizzle
				.select({ id: myApiKeysTable.id })
				.from(myApiKeysTable)
				.where(eq(myApiKeysTable.id, id))
				.limit(1);
			if (!existing[0]) return false;
			const now = new Date().toISOString();
			await drizzle.update(myApiKeysTable).set({ name, updatedAt: now }).where(eq(myApiKeysTable.id, id));
			return true;
		},

		async getAllApiKeys(options?: {
			email?: string;
			userId?: string;
			maxBudget?: BudgetFilter;
			page?: number;
			pageSize?: number;
			sort?: ApiKeyListSortField;
			order?: ApiKeyListSortOrder;
		}): Promise<{ keys: AdminApiKeyListItem[]; total: number }> {
			const page = options?.page || 1;
			const pageSize = Math.min(options?.pageSize || 20, 100);
			const offset = (page - 1) * pageSize;
			const conditions = [];
			if (options?.email) {
				conditions.push(like(myUsersTable.email, `%${options.email}%`));
			}
			if (options?.userId) {
				conditions.push(eq(myApiKeysTable.userId, options.userId));
			}
			if (options?.maxBudget === 'positive') {
				conditions.push(and(isNotNull(myUsersTable.budgetMax), gt(myUsersTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'zero_or_negative') {
				conditions.push(and(isNotNull(myUsersTable.budgetMax), lte(myUsersTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'null') {
				conditions.push(isNull(myUsersTable.budgetMax));
			}
			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

			let countQ = drizzle
				.select({ total: count() })
				.from(myApiKeysTable)
				.innerJoin(myUsersTable, eq(myApiKeysTable.userId, myUsersTable.id));
			if (whereExpr) countQ = countQ.where(whereExpr) as typeof countQ;
			const total = Number((await countQ)[0]?.total ?? 0);

			let listQ = drizzle
				.select({
					id: myApiKeysTable.id,
					key: myApiKeysTable.key,
					user_id: myApiKeysTable.userId,
					name: myApiKeysTable.name,
					user_email: myUsersTable.email,
					budget_max: myUsersTable.budgetMax,
					budget_base: myUsersTable.budgetBase,
					budget_spent: myUsersTable.budgetSpent,
					budget_period: myUsersTable.budgetPeriod,
					budget_reset_at: myUsersTable.budgetResetAt,
					status: myApiKeysTable.status,
					metadata: myApiKeysTable.metadata,
					created_at: myApiKeysTable.createdAt,
					updated_at: myApiKeysTable.updatedAt,
				})
				.from(myApiKeysTable)
				.innerJoin(myUsersTable, eq(myApiKeysTable.userId, myUsersTable.id));
			if (whereExpr) listQ = listQ.where(whereExpr) as typeof listQ;

			const sort = options?.sort ?? DEFAULT_API_KEY_LIST_SORT;
			const order = options?.order ?? DEFAULT_API_KEY_LIST_ORDER;
			const rows = await listQ.orderBy(apiKeyListOrderBy(sort, order)).limit(pageSize).offset(offset);
			return { keys: rows.map(mapMyAdminListRow), total };
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
