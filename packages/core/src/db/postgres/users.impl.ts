/**
 * Postgres：`users`。
 */
import { and, asc, count, desc, eq, gt, isNotNull, isNull, like, lte, sql } from 'drizzle-orm';
import type { UserRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { UsersRepository } from '../../storage/gateway-repository-interfaces';
import { usersTable as pgUsersTable } from '../../storage/drizzle/schema.pg';
import type { InsertUserParams, UserMaxBudgetFilter } from '../users-types';
import {
	DEFAULT_USER_LIST_ORDER,
	DEFAULT_USER_LIST_SORT,
	type UserListSortField,
	type UserListSortOrder,
} from '../users-list-sort';
import { parseMoney } from '../../storage/critical-write-paths-utils';

function userListOrderByClauses(sort: UserListSortField, order: UserListSortOrder) {
	const isAsc = order === 'asc';
	const tie = isAsc ? asc(pgUsersTable.createdAt) : desc(pgUsersTable.createdAt);
	if (sort === 'budget_reset_at') {
		const col = pgUsersTable.budgetResetAt;
		const primary = isAsc ? sql`${col} ASC NULLS LAST` : sql`${col} DESC NULLS FIRST`;
		return [primary, tie];
	}
	if (sort === 'budget_max') {
		const col = pgUsersTable.budgetMax;
		const primary = isAsc ? sql`${col} ASC NULLS LAST` : sql`${col} DESC NULLS FIRST`;
		return [primary, tie];
	}
	if (sort === 'budget_spent') {
		return [isAsc ? asc(pgUsersTable.budgetSpent) : desc(pgUsersTable.budgetSpent), tie];
	}
	if (sort === 'budget_base') {
		return [isAsc ? asc(pgUsersTable.budgetBase) : desc(pgUsersTable.budgetBase), tie];
	}
	return [isAsc ? asc(pgUsersTable.createdAt) : desc(pgUsersTable.createdAt)];
}

function mapPgUserRow(r: {
	id: string;
	email: string | null;
	budgetMax: string | null;
	budgetBase: string;
	budgetSpent: string;
	budgetPeriod: string;
	budgetResetAt: string | null;
	status: string;
	metadata: string | null;
	externalSystem: string | null;
	externalUserId: string | null;
	createdAt: string;
	updatedAt: string;
}): UserRow {
	return {
		id: r.id,
		email: r.email ?? '',
		budget_max: r.budgetMax == null ? null : parseMoney(r.budgetMax),
		budget_base: parseMoney(r.budgetBase),
		budget_spent: parseMoney(r.budgetSpent),
		budget_period: r.budgetPeriod,
		budget_reset_at: r.budgetResetAt,
		status: r.status,
		metadata: r.metadata,
		external_system: r.externalSystem,
		external_user_id: r.externalUserId,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function createPostgresUsersRepository(db: PostgresDatabaseClient): UsersRepository {
	const drizzle = db.drizzle;
	return {
		async getById(id: string): Promise<UserRow | null> {
			const rows = await drizzle.select().from(pgUsersTable).where(eq(pgUsersTable.id, id)).limit(1);
			return rows[0] ? mapPgUserRow(rows[0]) : null;
		},

		async getByExternalPair(externalSystem: string, externalUserId: string): Promise<UserRow | null> {
			const rows = await drizzle
				.select()
				.from(pgUsersTable)
				.where(and(eq(pgUsersTable.externalSystem, externalSystem), eq(pgUsersTable.externalUserId, externalUserId)))
				.limit(1);
			return rows[0] ? mapPgUserRow(rows[0]) : null;
		},

		async listByEmail(email: string): Promise<UserRow[]> {
			const rows = await drizzle
				.select()
				.from(pgUsersTable)
				.where(eq(pgUsersTable.email, email))
				.orderBy(desc(pgUsersTable.createdAt));
			return rows.map(mapPgUserRow);
		},

		async list(options?: {
			email?: string;
			externalSystem?: string;
			externalUserId?: string;
			maxBudget?: UserMaxBudgetFilter;
			status?: string;
			page?: number;
			pageSize?: number;
			sort?: UserListSortField;
			order?: UserListSortOrder;
		}): Promise<{ users: UserRow[]; total: number }> {
			const page = options?.page || 1;
			const pageSize = Math.min(options?.pageSize || 20, 100);
			const offset = (page - 1) * pageSize;
			const conditions = [];
			if (options?.email) conditions.push(like(pgUsersTable.email, `%${options.email}%`));
			if (options?.externalSystem) conditions.push(eq(pgUsersTable.externalSystem, options.externalSystem));
			if (options?.externalUserId) conditions.push(eq(pgUsersTable.externalUserId, options.externalUserId));
			if (options?.status) conditions.push(eq(pgUsersTable.status, options.status));
			if (options?.maxBudget === 'positive') {
				conditions.push(and(isNotNull(pgUsersTable.budgetMax), gt(pgUsersTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'zero_or_negative') {
				conditions.push(and(isNotNull(pgUsersTable.budgetMax), lte(pgUsersTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'null') {
				conditions.push(isNull(pgUsersTable.budgetMax));
			}
			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;
			let countQ = drizzle.select({ total: count() }).from(pgUsersTable);
			if (whereExpr) countQ = countQ.where(whereExpr) as typeof countQ;
			const total = Number((await countQ)[0]?.total ?? 0);
			const sort = options?.sort ?? DEFAULT_USER_LIST_SORT;
			const order = options?.order ?? DEFAULT_USER_LIST_ORDER;
			let listQ = drizzle.select().from(pgUsersTable);
			if (whereExpr) listQ = listQ.where(whereExpr) as typeof listQ;
			const rows = await listQ.orderBy(...userListOrderByClauses(sort, order)).limit(pageSize).offset(offset);
			return { users: rows.map(mapPgUserRow), total };
		},

		async createUser(params: InsertUserParams): Promise<void> {
			const now = new Date().toISOString();
			const budgetMax = params.budgetMax != null ? String(roundGatewayMoney(params.budgetMax)) : null;
			const budgetBase = String(params.budgetBase != null ? roundGatewayMoney(params.budgetBase) : 0);
			const budgetSpent = String(params.budgetSpent != null ? roundGatewayMoney(params.budgetSpent) : 0);
			await drizzle.insert(pgUsersTable).values({
				id: params.id,
				email: params.email,
				budgetMax,
				budgetBase,
				budgetSpent,
				budgetPeriod: params.budgetPeriod ?? 'none',
				budgetResetAt: params.budgetResetAt ?? null,
				status: params.status ?? 'active',
				metadata: params.metadata ?? null,
				externalSystem: params.externalSystem ?? null,
				externalUserId: params.externalUserId ?? null,
				createdAt: now,
				updatedAt: now,
			});
		},

		async updateUserPlan(
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
					.update(pgUsersTable)
					.set({
						...baseSet,
						budgetSpent: String(roundGatewayMoney(budget_spent_override ?? 0)),
						...(metadata !== undefined ? { metadata } : {}),
					})
					.where(eq(pgUsersTable.id, id))
					.returning({ id: pgUsersTable.id });
				return updated.length > 0;
			}
			if (resetBudget) {
				const updated = await drizzle
					.update(pgUsersTable)
					.set({
						...baseSet,
						budgetSpent: '0',
						...(metadata !== undefined ? { metadata } : {}),
					})
					.where(eq(pgUsersTable.id, id))
					.returning({ id: pgUsersTable.id });
				return updated.length > 0;
			}
			const updated = await drizzle
				.update(pgUsersTable)
				.set({
					...baseSet,
					...(metadata !== undefined ? { metadata } : {}),
				})
				.where(eq(pgUsersTable.id, id))
				.returning({ id: pgUsersTable.id });
			return updated.length > 0;
		},

		async updateUserStatus(id: string, status: string): Promise<boolean> {
			const now = new Date().toISOString();
			const updated = await drizzle
				.update(pgUsersTable)
				.set({ status, updatedAt: now })
				.where(eq(pgUsersTable.id, id))
				.returning({ id: pgUsersTable.id });
			return updated.length > 0;
		},

		async setUserMetadataById(id: string, metadataJson: string | null): Promise<boolean> {
			const now = new Date().toISOString();
			const updated = await drizzle
				.update(pgUsersTable)
				.set({ metadata: metadataJson, updatedAt: now })
				.where(eq(pgUsersTable.id, id))
				.returning({ id: pgUsersTable.id });
			return updated.length > 0;
		},

		async setUserEmailById(id: string, email: string): Promise<boolean> {
			const now = new Date().toISOString();
			const updated = await drizzle
				.update(pgUsersTable)
				.set({ email, updatedAt: now })
				.where(eq(pgUsersTable.id, id))
				.returning({ id: pgUsersTable.id });
			return updated.length > 0;
		},

		async setUserExternalIdentityById(
			id: string,
			externalSystem: string | null,
			externalUserId: string | null
		): Promise<boolean> {
			const now = new Date().toISOString();
			const updated = await drizzle
				.update(pgUsersTable)
				.set({ externalSystem, externalUserId, updatedAt: now })
				.where(eq(pgUsersTable.id, id))
				.returning({ id: pgUsersTable.id });
			return updated.length > 0;
		},

		async deleteUserHard(id: string): Promise<boolean> {
			const r = await drizzle.delete(pgUsersTable).where(eq(pgUsersTable.id, id)).returning({ id: pgUsersTable.id });
			return r.length > 0;
		},
	};
}
