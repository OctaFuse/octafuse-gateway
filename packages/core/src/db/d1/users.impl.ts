/**
 * D1：`users` 表。
 */
import type { UserRow } from '../../types';
import { roundGatewayMoney } from '../../lib/money-precision';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { UsersRepository } from '../../storage/gateway-repository-interfaces';
import type { InsertUserParams, UserMaxBudgetFilter } from '../users-types';

type UserSqlRow = {
	id: string;
	email: string | null;
	budget_max: number | null;
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
	status: string;
	metadata: string | null;
	external_system: string | null;
	external_user_id: string | null;
	created_at: string;
	updated_at: string;
};

function mapUserRow(r: UserSqlRow): UserRow {
	return {
		id: r.id,
		email: r.email,
		budget_max: r.budget_max == null ? null : roundGatewayMoney(Number(r.budget_max)),
		budget_base: roundGatewayMoney(Number(r.budget_base ?? 0)),
		budget_spent: roundGatewayMoney(Number(r.budget_spent)),
		budget_period: r.budget_period,
		budget_reset_at: r.budget_reset_at,
		status: r.status,
		metadata: r.metadata,
		external_system: r.external_system,
		external_user_id: r.external_user_id,
		created_at: r.created_at,
		updated_at: r.updated_at,
	};
}

export function createD1UsersRepository(db: D1DatabaseClient): UsersRepository {
	const raw = db.raw;
	return {
		async getById(id: string): Promise<UserRow | null> {
			const row = await raw.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserSqlRow>();
			return row ? mapUserRow(row) : null;
		},

		async getByExternalPair(externalSystem: string, externalUserId: string): Promise<UserRow | null> {
			const row = await raw
				.prepare('SELECT * FROM users WHERE external_system = ? AND external_user_id = ?')
				.bind(externalSystem, externalUserId)
				.first<UserSqlRow>();
			return row ? mapUserRow(row) : null;
		},

		async listByEmail(email: string): Promise<UserRow[]> {
			const rows = await raw.prepare('SELECT * FROM users WHERE email = ? ORDER BY created_at DESC').bind(email).all<UserSqlRow>();
			return (rows.results ?? []).map(mapUserRow);
		},

		async list(options?: {
			email?: string;
			externalSystem?: string;
			externalUserId?: string;
			maxBudget?: UserMaxBudgetFilter;
			status?: string;
			page?: number;
			pageSize?: number;
		}): Promise<{ users: UserRow[]; total: number }> {
			const page = options?.page || 1;
			const pageSize = Math.min(options?.pageSize || 20, 100);
			const offset = (page - 1) * pageSize;
			const conditions: string[] = [];
			const bindValues: unknown[] = [];
			if (options?.email) {
				conditions.push('email LIKE ?');
				bindValues.push(`%${options.email}%`);
			}
			if (options?.externalSystem) {
				conditions.push('external_system = ?');
				bindValues.push(options.externalSystem);
			}
			if (options?.externalUserId) {
				conditions.push('external_user_id = ?');
				bindValues.push(options.externalUserId);
			}
			if (options?.status) {
				conditions.push('status = ?');
				bindValues.push(options.status);
			}
			if (options?.maxBudget === 'positive') conditions.push('budget_max > 0');
			else if (options?.maxBudget === 'zero_or_negative') conditions.push('budget_max <= 0');
			else if (options?.maxBudget === 'null') conditions.push('budget_max IS NULL');
			const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const countRow = await raw
				.prepare(`SELECT COUNT(*) as total FROM users ${whereClause}`)
				.bind(...bindValues)
				.first<{ total: number }>();
			const total = Number(countRow?.total ?? 0);
			const rows = await raw
				.prepare(`SELECT * FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
				.bind(...bindValues, pageSize, offset)
				.all<UserSqlRow>();
			return { users: (rows.results ?? []).map(mapUserRow), total };
		},

		async createUser(params: InsertUserParams): Promise<void> {
			const budgetMax = params.budgetMax != null ? roundGatewayMoney(params.budgetMax) : null;
			const budgetBase = params.budgetBase != null ? roundGatewayMoney(params.budgetBase) : 0;
			const budgetSpent = params.budgetSpent != null ? roundGatewayMoney(params.budgetSpent) : 0;
			const budgetPeriod = params.budgetPeriod ?? 'none';
			const budgetResetAt = params.budgetResetAt ?? null;
			const status = params.status ?? 'active';
			await raw
				.prepare(
					`INSERT INTO users (id, email, budget_max, budget_base, budget_spent, budget_period, budget_reset_at, status, metadata, external_system, external_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
				)
				.bind(
					params.id,
					params.email ?? null,
					budgetMax,
					budgetBase,
					budgetSpent,
					budgetPeriod,
					budgetResetAt,
					status,
					params.metadata ?? null,
					params.externalSystem ?? null,
					params.externalUserId ?? null
				)
				.run();
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
				.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`)
				.bind(...bindValues)
				.run();
			return result.meta.changes > 0;
		},

		async updateUserStatus(id: string, status: string): Promise<boolean> {
			const result = await raw
				.prepare('UPDATE users SET status = ?, updated_at = datetime("now") WHERE id = ?')
				.bind(status, id)
				.run();
			return result.meta.changes > 0;
		},

		async setUserMetadataById(id: string, metadataJson: string | null): Promise<boolean> {
			const result = await raw
				.prepare('UPDATE users SET metadata = ?, updated_at = datetime("now") WHERE id = ?')
				.bind(metadataJson, id)
				.run();
			return result.meta.changes > 0;
		},

		async setUserEmailById(id: string, email: string | null): Promise<boolean> {
			const result = await raw
				.prepare('UPDATE users SET email = ?, updated_at = datetime("now") WHERE id = ?')
				.bind(email, id)
				.run();
			return result.meta.changes > 0;
		},

		async deleteUserHard(id: string): Promise<boolean> {
			const result = await raw.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
			return (result.meta.changes ?? 0) > 0;
		},
	};
}
