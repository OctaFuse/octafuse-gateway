/**
 * 网关用户业务：外部身份幂等、`users` 预算周期与懒重置、按密钥 id 代理更新用户计划等。
 * 预算字段均在 `users`；`api_keys` 仅关联 `user_id`。
 */
import type { GatewayRepositories } from '../storage/repositories';
import type { BudgetPeriod } from '../types';
import type { UserRow } from '../types';
import { roundGatewayMoney } from '../lib/money-precision';
import { updateUserBudgetWithAuditTx } from '../storage/critical-write-paths';

/**
 * 将锚点日期按预算周期向前推一个周期（UTC）。
 * monthly：尽量保持「日」不变，月底按当月天数夹紧（如 1/31 → 2/28）。
 */
function advanceByOnePeriod(anchor: Date, period: BudgetPeriod): Date {
	const next = new Date(anchor);
	switch (period) {
		case 'daily':
			next.setUTCDate(next.getUTCDate() + 1);
			return next;
		case 'weekly':
			next.setUTCDate(next.getUTCDate() + 7);
			return next;
		case 'monthly': {
			const dayOfMonth = next.getUTCDate();
			next.setUTCMonth(next.getUTCMonth() + 1, 1);
			const maxDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
			next.setUTCDate(Math.min(dayOfMonth, maxDay));
			return next;
		}
		default:
			return next;
	}
}

/** 新用户首次 `budget_reset_at`：从当前时刻起算一个完整周期后。 */
export function computeFirstReset(period: BudgetPeriod): string {
	if (period === 'none') return '';
	return advanceByOnePeriod(new Date(), period).toISOString();
}

/**
 * 若 `budget_reset_at` 已过期则懒重置（`users` 行语义）。
 */
export function maybeResetBudget(
	budget_period: string,
	budget_reset_at: string | null,
	budget_spent: number,
	budget_max: number | null = null,
	budget_base: number = 0
): { budget_spent: number; budget_reset_at: string | null; budget_max: number | null } {
	const currentMax = budget_max == null ? null : roundGatewayMoney(budget_max);
	if (budget_period === 'none' || !budget_reset_at) {
		return { budget_spent: roundGatewayMoney(budget_spent), budget_reset_at, budget_max: currentMax };
	}
	const now = new Date();
	let resetAt = new Date(budget_reset_at);
	if (resetAt > now) {
		return { budget_spent: roundGatewayMoney(budget_spent), budget_reset_at, budget_max: currentMax };
	}
	const period = budget_period as BudgetPeriod;
	while (resetAt <= now) {
		resetAt = advanceByOnePeriod(resetAt, period);
	}
	return {
		budget_spent: 0,
		budget_reset_at: resetAt.toISOString(),
		budget_max: roundGatewayMoney(budget_base),
	};
}

export function normalizeBudgetResetAt(iso: string | null | undefined): string | null {
	if (iso == null || iso === '') {
		return null;
	}
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) {
		return null;
	}
	return new Date(t).toISOString();
}

export function budgetLazyResetNeedsPersist(
	row: { budget_spent: number; budget_reset_at: string | null; budget_max?: number | null },
	next: { budget_spent: number; budget_reset_at: string | null; budget_max?: number | null }
): boolean {
	const rowSpent = roundGatewayMoney(Number(row.budget_spent));
	const nextSpent = roundGatewayMoney(next.budget_spent);
	const rowReset = normalizeBudgetResetAt(row.budget_reset_at);
	const nextReset = normalizeBudgetResetAt(next.budget_reset_at);
	if (rowSpent !== nextSpent || rowReset !== nextReset) {
		return true;
	}
	if (row.budget_max !== undefined || next.budget_max !== undefined) {
		const rowMax = row.budget_max == null ? null : roundGatewayMoney(Number(row.budget_max));
		const nextMax = next.budget_max == null ? null : roundGatewayMoney(Number(next.budget_max));
		if (rowMax !== nextMax) return true;
	}
	return false;
}

function validateExternalPair(external_system?: string | null, external_user_id?: string | null): void {
	const s = (external_system ?? '').trim();
	const u = (external_user_id ?? '').trim();
	const hasS = s.length > 0;
	const hasU = u.length > 0;
	if (hasS !== hasU) {
		throw new Error('external_system and external_user_id must both be set or both empty');
	}
}

/**
 * 按外部身份对幂等；无外部对时可按 `preferUserId` 建/取固定 id 用户，否则新建随机 uuid 用户。
 */
export async function getOrCreateUser(
	repos: GatewayRepositories,
	params: {
		preferUserId?: string;
		external_system?: string | null;
		external_user_id?: string | null;
		email?: string | null;
		budget_max?: number | null;
		budget_period?: BudgetPeriod;
		budget_base?: number | null;
		metadata?: string | null;
	}
): Promise<UserRow> {
	validateExternalPair(params.external_system, params.external_user_id);
	const extS = (params.external_system ?? '').trim() || null;
	const extU = (params.external_user_id ?? '').trim() || null;
	const budget_period = params.budget_period ?? 'none';
	const budget_reset_at = budget_period !== 'none' ? computeFirstReset(budget_period) : null;
	const budget_max = params.budget_max === undefined ? 0 : params.budget_max;
	const budget_base = params.budget_base === undefined ? (budget_max == null ? 0 : roundGatewayMoney(budget_max)) : roundGatewayMoney(Number(params.budget_base ?? 0));

	if (extS && extU) {
		const existing = await repos.users.getByExternalPair(extS, extU);
		if (existing) return existing;
		const id = crypto.randomUUID();
		await repos.users.createUser({
			id,
			email: params.email ?? null,
			budgetMax: budget_max,
			budgetBase: budget_base,
			budgetSpent: 0,
			budgetPeriod: budget_period,
			budgetResetAt: budget_reset_at || null,
			status: 'active',
			metadata: params.metadata ?? null,
			externalSystem: extS,
			externalUserId: extU,
		});
		const created = await repos.users.getById(id);
		if (!created) throw new Error('getOrCreateUser: failed to read created user');
		return created;
	}

	if (params.preferUserId) {
		const existing = await repos.users.getById(params.preferUserId);
		if (existing) return existing;
		await repos.users.createUser({
			id: params.preferUserId,
			email: params.email ?? null,
			budgetMax: budget_max,
			budgetBase: budget_base,
			budgetSpent: 0,
			budgetPeriod: budget_period,
			budgetResetAt: budget_reset_at || null,
			status: 'active',
			metadata: params.metadata ?? null,
			externalSystem: null,
			externalUserId: null,
		});
		const created = await repos.users.getById(params.preferUserId);
		if (!created) throw new Error('getOrCreateUser: failed to read created user');
		return created;
	}

	const id = crypto.randomUUID();
	await repos.users.createUser({
		id,
		email: params.email ?? null,
		budgetMax: budget_max,
		budgetBase: budget_base,
		budgetSpent: 0,
		budgetPeriod: budget_period,
		budgetResetAt: budget_reset_at || null,
		status: 'active',
		metadata: params.metadata ?? null,
		externalSystem: null,
		externalUserId: null,
	});
	const created = await repos.users.getById(id);
	if (!created) throw new Error('getOrCreateUser: failed to read created user');
	return created;
}

/**
 * 按 `users.id` 取用户预算视图；若周期到期则懒重置并写库（审计 `api_key_id` 为空）。
 */
export async function getUserInfo(repos: GatewayRepositories, userId: string) {
	const row = await repos.users.getById(userId);
	if (!row) return null;
	const { budget_spent, budget_reset_at, budget_max: nextBudgetMax } = maybeResetBudget(
		row.budget_period,
		row.budget_reset_at,
		row.budget_spent,
		row.budget_max,
		row.budget_base
	);
	const rowSnapshot = {
		budget_spent: row.budget_spent,
		budget_reset_at: row.budget_reset_at,
		budget_max: row.budget_max,
	};
	const nextSnapshot = { budget_spent, budget_reset_at, budget_max: nextBudgetMax };
	let effectiveBudgetMax = row.budget_max != null ? roundGatewayMoney(Number(row.budget_max)) : null;
	if (budgetLazyResetNeedsPersist(rowSnapshot, nextSnapshot)) {
		const maxChanged =
			(row.budget_max == null ? null : roundGatewayMoney(Number(row.budget_max))) !== nextBudgetMax;
		await updateUserBudgetWithAuditTx(repos, {
			userId: row.id,
			expectedBudgetResetAt: row.budget_reset_at,
			budgetSpent: budget_spent,
			budgetResetAt: budget_reset_at,
			budgetMax: maxChanged ? nextBudgetMax : undefined,
			apiKeyId: null,
			audit: {
				eventType: 'period_reset',
				actorType: 'system',
				reasonCode: 'get_user_info_lazy_reset',
				reasonText: 'Period reset (user info)',
				beforeSpent: row.budget_spent,
				deltaSpent: budget_spent - row.budget_spent,
				beforeBudgetMax: row.budget_max,
				afterBudgetMax: maxChanged ? nextBudgetMax : row.budget_max,
				beforeBudgetBase: row.budget_base,
				afterBudgetBase: row.budget_base,
				beforeBudgetPeriod: row.budget_period,
				afterBudgetPeriod: row.budget_period,
				beforeBudgetResetAt: row.budget_reset_at,
				metadata: null,
			},
		});
		effectiveBudgetMax = nextBudgetMax;
	}
	let metadata: Record<string, unknown> | null = null;
	if (row.metadata) {
		try {
			metadata = JSON.parse(row.metadata) as Record<string, unknown>;
		} catch {
			metadata = null;
		}
	}
	return {
		id: row.id,
		email: row.email,
		external_system: row.external_system,
		external_user_id: row.external_user_id,
		budget_max: effectiveBudgetMax,
		budget_base: roundGatewayMoney(Number(row.budget_base ?? 0)),
		budget_spent: roundGatewayMoney(budget_spent),
		budget_period: row.budget_period,
		budget_reset_at,
		status: row.status,
		metadata,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

/**
 * 单密钥详情（JOIN users）；若周期到期则懒重置并写库。
 */
export async function getKeyInfo(repos: GatewayRepositories, id: string) {
	const row = await repos.apiKeys.getApiKeyWithUserById(id);
	if (!row) return null;
	const { budget_spent, budget_reset_at, budget_max: nextBudgetMax } = maybeResetBudget(
		row.budget_period,
		row.budget_reset_at,
		row.budget_spent,
		row.budget_max,
		row.budget_base
	);
	const rowSnapshot = { budget_spent: row.budget_spent, budget_reset_at: row.budget_reset_at, budget_max: row.budget_max };
	const nextSnapshot = { budget_spent, budget_reset_at, budget_max: nextBudgetMax };
	let effectiveBudgetMax = row.budget_max != null ? roundGatewayMoney(Number(row.budget_max)) : null;
	if (budgetLazyResetNeedsPersist(rowSnapshot, nextSnapshot)) {
		const maxChanged =
			(row.budget_max == null ? null : roundGatewayMoney(Number(row.budget_max))) !== nextBudgetMax;
		await updateUserBudgetWithAuditTx(repos, {
			userId: row.user_id,
			expectedBudgetResetAt: row.budget_reset_at,
			budgetSpent: budget_spent,
			budgetResetAt: budget_reset_at,
			budgetMax: maxChanged ? nextBudgetMax : undefined,
			apiKeyId: id,
			audit: {
				eventType: 'period_reset',
				actorType: 'system',
				reasonCode: 'get_key_info_lazy_reset',
				reasonText: 'Period reset (key info)',
				beforeSpent: row.budget_spent,
				deltaSpent: budget_spent - row.budget_spent,
				beforeBudgetMax: row.budget_max,
				afterBudgetMax: maxChanged ? nextBudgetMax : row.budget_max,
				beforeBudgetBase: row.budget_base,
				afterBudgetBase: row.budget_base,
				beforeBudgetPeriod: row.budget_period,
				afterBudgetPeriod: row.budget_period,
				beforeBudgetResetAt: row.budget_reset_at,
				metadata: null,
			},
		});
		effectiveBudgetMax = nextBudgetMax;
	}
	let metadata: Record<string, unknown> | null = null;
	if (row.metadata) {
		try {
			metadata = JSON.parse(row.metadata) as Record<string, unknown>;
		} catch {
			metadata = null;
		}
	}
	return {
		id: row.id,
		key: row.key,
		user_id: row.user_id,
		name: row.name,
		user_email: row.user_email,
		budget_max: effectiveBudgetMax,
		budget_base: roundGatewayMoney(Number(row.budget_base ?? 0)),
		budget_spent: roundGatewayMoney(budget_spent),
		budget_period: row.budget_period,
		budget_reset_at,
		status: row.status,
		metadata,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export async function updateUserPlan(
	repos: GatewayRepositories,
	userId: string,
	params: {
		budget_max: number | null;
		budget_period: BudgetPeriod;
		reset_budget?: boolean;
		budget_reset_at?: string | null;
		metadata?: string | null;
		budget_spent?: number | null;
		budget_base?: number | null;
	}
): Promise<boolean> {
	const resetBudget = params.reset_budget ?? true;
	const budget_reset_at =
		params.budget_reset_at !== undefined
			? params.budget_reset_at
			: params.budget_period !== 'none'
				? computeFirstReset(params.budget_period)
				: null;
	return repos.users.updateUserPlan(
		userId,
		params.budget_max,
		params.budget_period,
		budget_reset_at,
		resetBudget,
		params.metadata,
		params.budget_spent,
		params.budget_base
	);
}

/** 通过密钥行 id 定位 `users.id` 后更新预算计划（预算在 users）。 */
export async function updateUserPlanByApiKeyId(
	repos: GatewayRepositories,
	keyId: string,
	params: {
		budget_max: number | null;
		budget_period: BudgetPeriod;
		reset_budget?: boolean;
		budget_reset_at?: string | null;
		metadata?: string | null;
		budget_spent?: number | null;
		budget_base?: number | null;
	}
): Promise<boolean> {
	const row = await repos.apiKeys.getApiKeyWithUserById(keyId);
	if (!row) return false;
	return updateUserPlan(repos, row.user_id, params);
}

export async function updateKeyMetadata(
	repos: GatewayRepositories,
	id: string,
	metadataPatch: Record<string, unknown>
): Promise<boolean> {
	const row = await repos.apiKeys.getApiKeyById(id);
	if (!row) return false;

	let existing: Record<string, unknown> = {};
	if (row.metadata) {
		try {
			const parsed = JSON.parse(row.metadata) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				existing = parsed as Record<string, unknown>;
			}
		} catch {
			existing = {};
		}
	}

	return repos.apiKeys.setApiKeyMetadataById(id, JSON.stringify({ ...existing, ...metadataPatch }));
}

export async function replaceKeyMetadata(repos: GatewayRepositories, id: string, metadataJson: string | null): Promise<boolean> {
	return repos.apiKeys.setApiKeyMetadataById(id, metadataJson);
}

export async function updateKeyStatus(repos: GatewayRepositories, id: string, status: string): Promise<boolean> {
	return repos.apiKeys.updateApiKeyStatusById(id, status);
}
