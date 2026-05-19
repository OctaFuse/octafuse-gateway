/**
 * Postgres：`api_keys`（预算在 `users`）。
 */
import { and, count, desc, eq, gt, isNotNull, isNull, like, lte, sql } from 'drizzle-orm';
import type { ApiKeyRow, ResolvedGatewayKeyRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { ApiKeysRepository } from '../../storage/gateway-repository-interfaces';
import { apiKeysTable as pgApiKeysTable, usersTable as pgUsersTable } from '../../storage/drizzle/schema.pg';
import type { BudgetFilter, InsertKeyParams } from '../api-keys-types';
import type { AdminApiKeyListItem } from '../../storage/repository-dtos';
import { parseMoney } from '../../storage/critical-write-paths-utils';

function mapPgKeyRow(r: {
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

function mapPgResolvedRow(
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
	const k = mapPgKeyRow(r);
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

function mapPgAdminListRow(r: {
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
	id: pgApiKeysTable.id,
	key: pgApiKeysTable.key,
	userId: pgApiKeysTable.userId,
	name: pgApiKeysTable.name,
	status: pgApiKeysTable.status,
	metadata: pgApiKeysTable.metadata,
	lastUsedAt: pgApiKeysTable.lastUsedAt,
	createdAt: pgApiKeysTable.createdAt,
	updatedAt: pgApiKeysTable.updatedAt,
	userEmail: pgUsersTable.email,
	budgetMax: pgUsersTable.budgetMax,
	budgetBase: pgUsersTable.budgetBase,
	budgetSpent: pgUsersTable.budgetSpent,
	budgetPeriod: pgUsersTable.budgetPeriod,
	budgetResetAt: pgUsersTable.budgetResetAt,
	userMetadata: pgUsersTable.metadata,
} as const;

export function createPostgresApiKeysRepository(db: PostgresDatabaseClient): ApiKeysRepository {
	const drizzle = db.drizzle;
	return {
		async getApiKeyByKey(key: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle
				.select()
				.from(pgApiKeysTable)
				.where(and(eq(pgApiKeysTable.key, key), eq(pgApiKeysTable.status, 'active')))
				.limit(1);
			return rows[0] ? mapPgKeyRow(rows[0]) : null;
		},

		async getApiKeyByKeyAnyStatus(key: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle.select().from(pgApiKeysTable).where(eq(pgApiKeysTable.key, key)).limit(1);
			return rows[0] ? mapPgKeyRow(rows[0]) : null;
		},

		async getApiKeyById(id: string): Promise<ApiKeyRow | null> {
			const rows = await drizzle.select().from(pgApiKeysTable).where(eq(pgApiKeysTable.id, id)).limit(1);
			return rows[0] ? mapPgKeyRow(rows[0]) : null;
		},

		async getApiKeyWithUserByKey(key: string): Promise<ResolvedGatewayKeyRow | null> {
			const rows = await drizzle
				.select(resolvedCols)
				.from(pgApiKeysTable)
				.innerJoin(pgUsersTable, eq(pgApiKeysTable.userId, pgUsersTable.id))
				.where(and(eq(pgApiKeysTable.key, key), eq(pgApiKeysTable.status, 'active')))
				.limit(1);
			return rows[0] ? mapPgResolvedRow(rows[0]) : null;
		},

		async getApiKeyWithUserById(id: string): Promise<ResolvedGatewayKeyRow | null> {
			const rows = await drizzle
				.select(resolvedCols)
				.from(pgApiKeysTable)
				.innerJoin(pgUsersTable, eq(pgApiKeysTable.userId, pgUsersTable.id))
				.where(eq(pgApiKeysTable.id, id))
				.limit(1);
			return rows[0] ? mapPgResolvedRow(rows[0]) : null;
		},

		async listKeysByUserId(userId: string, options?: { status?: string }): Promise<ApiKeyRow[]> {
			const where = options?.status
				? and(eq(pgApiKeysTable.userId, userId), eq(pgApiKeysTable.status, options.status))
				: eq(pgApiKeysTable.userId, userId);
			const rows = await drizzle.select().from(pgApiKeysTable).where(where).orderBy(pgApiKeysTable.createdAt);
			return rows.map(mapPgKeyRow);
		},

		async insertApiKey(params: InsertKeyParams): Promise<void> {
			const now = new Date().toISOString();
			const status = params.status ?? 'active';
			await drizzle.insert(pgApiKeysTable).values({
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

		async setApiKeyMetadataById(id: string, metadataJson: string | null): Promise<boolean> {
			const now = new Date().toISOString();
			const updated = await drizzle
				.update(pgApiKeysTable)
				.set({ metadata: metadataJson, updatedAt: now })
				.where(eq(pgApiKeysTable.id, id))
				.returning({ id: pgApiKeysTable.id });
			return updated.length > 0;
		},

		async updateApiKeyName(id: string, name: string | null): Promise<boolean> {
			const now = new Date().toISOString();
			const updated = await drizzle
				.update(pgApiKeysTable)
				.set({ name, updatedAt: now })
				.where(eq(pgApiKeysTable.id, id))
				.returning({ id: pgApiKeysTable.id });
			return updated.length > 0;
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
			const conditions = [];
			if (options?.email) {
				conditions.push(like(pgUsersTable.email, `%${options.email}%`));
			}
			if (options?.userId) {
				conditions.push(eq(pgApiKeysTable.userId, options.userId));
			}
			if (options?.maxBudget === 'positive') {
				conditions.push(and(isNotNull(pgUsersTable.budgetMax), gt(pgUsersTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'zero_or_negative') {
				conditions.push(and(isNotNull(pgUsersTable.budgetMax), lte(pgUsersTable.budgetMax, '0'))!);
			} else if (options?.maxBudget === 'null') {
				conditions.push(isNull(pgUsersTable.budgetMax));
			}
			const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

			let countQ = drizzle
				.select({ total: count() })
				.from(pgApiKeysTable)
				.innerJoin(pgUsersTable, eq(pgApiKeysTable.userId, pgUsersTable.id));
			if (whereExpr) countQ = countQ.where(whereExpr) as typeof countQ;
			const total = Number((await countQ)[0]?.total ?? 0);

			let listQ = drizzle
				.select({
					id: pgApiKeysTable.id,
					key: pgApiKeysTable.key,
					user_id: pgApiKeysTable.userId,
					name: pgApiKeysTable.name,
					user_email: pgUsersTable.email,
					budget_max: pgUsersTable.budgetMax,
					budget_base: pgUsersTable.budgetBase,
					budget_spent: pgUsersTable.budgetSpent,
					budget_period: pgUsersTable.budgetPeriod,
					budget_reset_at: pgUsersTable.budgetResetAt,
					status: pgApiKeysTable.status,
					metadata: pgApiKeysTable.metadata,
					created_at: pgApiKeysTable.createdAt,
					updated_at: pgApiKeysTable.updatedAt,
				})
				.from(pgApiKeysTable)
				.innerJoin(pgUsersTable, eq(pgApiKeysTable.userId, pgUsersTable.id));
			if (whereExpr) listQ = listQ.where(whereExpr) as typeof listQ;

			if (options?.maxBudget === 'positive') {
				const rows = await listQ
					.orderBy(sql`${pgUsersTable.budgetResetAt} ASC NULLS LAST`, desc(pgApiKeysTable.createdAt))
					.limit(pageSize)
					.offset(offset);
				return { keys: rows.map(mapPgAdminListRow), total };
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
