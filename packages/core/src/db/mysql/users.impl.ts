/**
 * MySQL：`users`。
 */
import { and, asc, count, desc, eq, gt, isNotNull, isNull, like, lte, sql } from 'drizzle-orm';
import type { UserRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { UsersRepository } from '../../storage/gateway-repository-interfaces';
import { usersTable as myUsersTable } from '../../storage/drizzle/schema.mysql';
import type { InsertUserParams, UserMaxBudgetFilter } from '../users-types';
import {
	DEFAULT_USER_LIST_ORDER,
	DEFAULT_USER_LIST_SORT,
	type UserListSortField,
	type UserListSortOrder,
} from '../users-list-sort';
import { parseMoney } from '../../storage/critical-write-paths-utils';

function userListOrderBy(sort: UserListSortField, order: UserListSortOrder) {
	const isAsc = order === 'asc';
	if (sort === 'budget_reset_at') {
		const col = myUsersTable.budgetResetAt;
		return isAsc ? sql`${col} ASC NULLS LAST` : sql`${col} DESC NULLS FIRST`;
	}
	if (sort === 'budget_spent') {
		return isAsc ? asc(myUsersTable.budgetSpent) : desc(myUsersTable.budgetSpent);
	}
	return isAsc ? asc(myUsersTable.createdAt) : desc(myUsersTable.createdAt);
}

function mapMyUserRow(r: {
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

export function createMySqlUsersRepository(db: MySqlDatabaseClient): UsersRepository {
	const drizzle = db.drizzle;
	return {
		async getById(id: string): Promise<UserRow | null> {
			const rows = await drizzle.select().from(myUsersTable).where(eq(myUsersTable.id, id)).limit(1);
			return rows[0] ? mapMyUserRow(rows[0]) : null;
		},

		async getByExternalPair(externalSystem: string, externalUserId: string): Promise<UserRow | null> {
			const rows = await drizzle
				.select()
				.from(myUsersTable)
				.where(and(eq(myUsersTable.externalSystem, externalSystem), eq(myUsersTable.externalUserId, externalUserId)))
				.limit(1);
			return rows[0] ? mapMyUserRow(rows[0]) : null;
		},

		async listByEmail(email: string): Promise<UserRow[]> {
			const rows = await drizzle
				.select()
				.from(myUsersTable)
				.where(eq(myUsersTable.email, email))
				.orderBy(desc(myUsersTable.createdAt));
			return rows.map(mapMyUserRow);
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
			if (options?.email) conditions.push(like(myUsersTable.email, `%${options.email}%`));
			if (options?.externalSystem) conditions.push(eq(myUsersTable.externalSystem, options.externalSystem));
			if (options?.externalUserId) conditions.push(eq(myUsersTable.externalUserId, options.externalUserId));
			if (options?.status) conditions.push(eq(myUsersTable.status, options.status));
			if (options?.maxBudget === 'positive') {
				conditions.push(and(isNotNull(myUsersTable.budgetMax), gt(myUsersTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'zero_or_negative') {
				conditions.push(and(isNotNull(myUsersTable.budgetMax), lte(myUsersTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'null') {
				conditions.push(isNull(myUsersTable.budgetMax));
			}
			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;
			let countQ = drizzle.select({ total: count() }).from(myUsersTable);
			if (whereExpr) countQ = countQ.where(whereExpr) as typeof countQ;
			const total = Number((await countQ)[0]?.total ?? 0);
			const sort = options?.sort ?? DEFAULT_USER_LIST_SORT;
			const order = options?.order ?? DEFAULT_USER_LIST_ORDER;
			let listQ = drizzle.select().from(myUsersTable);
			if (whereExpr) listQ = listQ.where(whereExpr) as typeof listQ;
			const rows = await listQ.orderBy(userListOrderBy(sort, order)).limit(pageSize).offset(offset);
			return { users: rows.map(mapMyUserRow), total };
		},

		async createUser(params: InsertUserParams): Promise<void> {
			const now = new Date().toISOString();
			const budgetMax = params.budgetMax != null ? String(roundGatewayMoney(params.budgetMax)) : null;
			const budgetBase = String(params.budgetBase != null ? roundGatewayMoney(params.budgetBase) : 0);
			const budgetSpent = String(params.budgetSpent != null ? roundGatewayMoney(params.budgetSpent) : 0);
			await drizzle.insert(myUsersTable).values({
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
			const existing = await drizzle.select({ id: myUsersTable.id }).from(myUsersTable).where(eq(myUsersTable.id, id)).limit(1);
			if (!existing[0]) return false;
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
				await drizzle
					.update(myUsersTable)
					.set({
						...baseSet,
						budgetSpent: String(roundGatewayMoney(budget_spent_override ?? 0)),
						...(metadata !== undefined ? { metadata } : {}),
					})
					.where(eq(myUsersTable.id, id));
				return true;
			}
			if (resetBudget) {
				await drizzle
					.update(myUsersTable)
					.set({
						...baseSet,
						budgetSpent: '0',
						...(metadata !== undefined ? { metadata } : {}),
					})
					.where(eq(myUsersTable.id, id));
				return true;
			}
			await drizzle
				.update(myUsersTable)
				.set({
					...baseSet,
					...(metadata !== undefined ? { metadata } : {}),
				})
				.where(eq(myUsersTable.id, id));
			return true;
		},

		async updateUserStatus(id: string, status: string): Promise<boolean> {
			const existing = await drizzle.select({ id: myUsersTable.id }).from(myUsersTable).where(eq(myUsersTable.id, id)).limit(1);
			if (!existing[0]) return false;
			const now = new Date().toISOString();
			await drizzle.update(myUsersTable).set({ status, updatedAt: now }).where(eq(myUsersTable.id, id));
			return true;
		},

		async setUserMetadataById(id: string, metadataJson: string | null): Promise<boolean> {
			const existing = await drizzle.select({ id: myUsersTable.id }).from(myUsersTable).where(eq(myUsersTable.id, id)).limit(1);
			if (!existing[0]) return false;
			const now = new Date().toISOString();
			await drizzle.update(myUsersTable).set({ metadata: metadataJson, updatedAt: now }).where(eq(myUsersTable.id, id));
			return true;
		},

		async setUserEmailById(id: string, email: string): Promise<boolean> {
			const existing = await drizzle.select({ id: myUsersTable.id }).from(myUsersTable).where(eq(myUsersTable.id, id)).limit(1);
			if (!existing[0]) return false;
			const now = new Date().toISOString();
			await drizzle.update(myUsersTable).set({ email, updatedAt: now }).where(eq(myUsersTable.id, id));
			return true;
		},

		async setUserExternalIdentityById(
			id: string,
			externalSystem: string | null,
			externalUserId: string | null
		): Promise<boolean> {
			const existing = await drizzle.select({ id: myUsersTable.id }).from(myUsersTable).where(eq(myUsersTable.id, id)).limit(1);
			if (!existing[0]) return false;
			const now = new Date().toISOString();
			await drizzle
				.update(myUsersTable)
				.set({ externalSystem, externalUserId, updatedAt: now })
				.where(eq(myUsersTable.id, id));
			return true;
		},

		async deleteUserHard(id: string): Promise<boolean> {
			const existing = await drizzle.select({ id: myUsersTable.id }).from(myUsersTable).where(eq(myUsersTable.id, id)).limit(1);
			if (!existing[0]) return false;
			await drizzle.delete(myUsersTable).where(eq(myUsersTable.id, id));
			return true;
		},
	};
}
