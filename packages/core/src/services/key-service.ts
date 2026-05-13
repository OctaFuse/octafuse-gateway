/**
 * 用户 API 密钥业务：生成 sk- 前缀随机串、按 user 幂等创建首把活跃密钥、预算在 `users` 表。
 * 供 `/admin/keys` 与鉴权侧写回 `budget_spent` / `budget_reset_at` 使用。
 */
import type { GatewayRepositories } from '../storage/repositories';
import type { BudgetPeriod } from '../types';
import { roundGatewayMoney } from '../lib/money-precision';
import type { InsertKeyParams } from '../db/api-keys-types';
import { createApiKeyWithAudit, getActiveApiKeyByUserId, updateApiKeyBudgetWithAuditTx } from '../storage/critical-write-paths';

const KEY_PREFIX = 'sk-';
const KEY_RANDOM_BYTES = 32;

function generateKey(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = KEY_PREFIX;
	const bytes = new Uint8Array(KEY_RANDOM_BYTES);
	crypto.getRandomValues(bytes);
	for (let i = 0; i < KEY_RANDOM_BYTES; i++) {
		result += chars[bytes[i]! % chars.length];
	}
	return result;
}

function generateId(): string {
	return crypto.randomUUID();
}

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
 * 若 `budget_reset_at` 已过期则懒重置（`users` 行）。
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

/**
 * 按 `user_id`（`users.id`）幂等：已存在活跃密钥则返回第一把，否则在确保 `users` 行存在后新建密钥。
 */
export async function getOrCreateKey(
	repos: GatewayRepositories,
	params: {
		user_id: string;
		user_email?: string;
		budget_max?: number | null;
		budget_period?: BudgetPeriod;
		provision_reason?: string | null;
	}
): Promise<{ key: string; key_id: string; created: boolean }> {
	const existing = await getActiveApiKeyByUserId(repos, params.user_id);
	if (existing) {
		return { key: existing.key, key_id: existing.id, created: false };
	}

	let u = await repos.users.getById(params.user_id);
	const budget_period = params.budget_period ?? 'none';
	const budget_reset_at = budget_period !== 'none' ? computeFirstReset(budget_period) : null;
	const budget_max = params.budget_max === undefined ? 0 : params.budget_max;
	const budget_base = budget_max == null ? 0 : roundGatewayMoney(budget_max);

	if (!u) {
		await repos.users.createUser({
			id: params.user_id,
			email: params.user_email ?? null,
			budgetMax: budget_max,
			budgetBase: budget_base,
			budgetSpent: 0,
			budgetPeriod: budget_period,
			budgetResetAt: budget_reset_at || null,
			status: 'active',
			metadata: null,
			externalSystem: null,
			externalUserId: null,
		});
		u = await repos.users.getById(params.user_id);
	}

	const id = generateId();
	const key = generateKey();

	const insertParams: InsertKeyParams = {
		id,
		key,
		userId: params.user_id,
		status: 'active',
	};

	const provisionReason =
		typeof params.provision_reason === 'string' && params.provision_reason.trim() !== ''
			? params.provision_reason.trim()
			: 'API key provisioned';

	const auditId = crypto.randomUUID();
	await createApiKeyWithAudit(repos, {
		insert: insertParams,
		audit: {
			id: auditId,
			apiKeyId: id,
			eventType: 'key_created',
			actorType: 'admin',
			actorId: 'master_key',
			reasonCode: 'key_create',
			reasonText: provisionReason,
			beforeSpent: 0,
			deltaSpent: 0,
			afterSpent: 0,
			beforeBudgetMax: null,
			afterBudgetMax: u?.budget_max ?? budget_max,
			beforeBudgetPeriod: null,
			afterBudgetPeriod: u?.budget_period ?? budget_period,
			beforeBudgetResetAt: null,
			afterBudgetResetAt: u?.budget_reset_at ?? budget_reset_at,
			requestLogId: null,
			metadata: null,
		},
	});
	return { key, key_id: id, created: true };
}

export async function createKey(
	repos: GatewayRepositories,
	params: {
		user_id: string;
		user_email?: string;
		budget_max?: number | null;
		budget_period?: BudgetPeriod;
		provision_reason?: string | null;
	}
): Promise<{ key: string; key_id: string }> {
	const result = await getOrCreateKey(repos, params);
	return { key: result.key, key_id: result.key_id };
}

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
		await updateApiKeyBudgetWithAuditTx(repos, {
			keyId: id,
			budgetSpent: budget_spent,
			budgetResetAt: budget_reset_at,
			budgetMax: maxChanged ? nextBudgetMax : undefined,
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

export async function revokeKey(repos: GatewayRepositories, id: string): Promise<boolean> {
	return repos.apiKeys.revokeApiKey(id);
}

export async function updateKeyPlan(
	repos: GatewayRepositories,
	id: string,
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
	const row = await repos.apiKeys.getApiKeyWithUserById(id);
	if (!row) return false;
	const resetBudget = params.reset_budget ?? true;
	const budget_reset_at =
		params.budget_reset_at !== undefined
			? params.budget_reset_at
			: params.budget_period !== 'none'
				? computeFirstReset(params.budget_period)
				: null;
	return repos.users.updateUserPlan(
		row.user_id,
		params.budget_max,
		params.budget_period,
		budget_reset_at,
		resetBudget,
		params.metadata,
		params.budget_spent,
		params.budget_base
	);
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
