/**
 * 用户 API 密钥业务：生成 sk- 前缀随机串、按 user_id 幂等创建、预算周期与 lazy 重置。
 * 供 `/admin/keys` 与鉴权中间件侧写回 `budget_spent` / `budget_reset_at` 使用。
 */
import type { GatewayRepositories } from '../storage/repositories';
import type { BudgetPeriod } from '../types';
import { roundGatewayMoney } from '../lib/money-precision';
import type { InsertKeyParams } from '../db/api-keys-types';
import {
	createApiKeyWithAudit,
	getActiveApiKeyByUserId,
	updateApiKeyBudgetWithAuditTx,
} from '../storage/critical-write-paths';

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

/** 新密钥首次 `budget_reset_at`：从当前时刻起算一个完整周期后。 */
export function computeFirstReset(period: BudgetPeriod): string {
	if (period === 'none') return '';
	return advanceByOnePeriod(new Date(), period).toISOString();
}

/**
 * 若 `budget_reset_at` 已过期则懒重置：将 `budget_spent` 归零、把下次重置时间按周期逐步推到未来，
 * 并把 `budget_max` 复位为 `budget_base`（订阅套餐基础上限）。
 *
 * 用于处理长时间未访问、跨越多期的情况；多期跨越时 `budget_max` 仅复位一次（最终值 = `budget_base`）。
 * @param budget_period 周期类型：`none` 时不重置
 * @param budget_reset_at 下次重置时间 ISO；无周期可为 null
 * @param budget_spent 当前库中已用额度
 * @param budget_max 当前 `api_keys.budget_max`（含 topup 残值）；可为 null
 * @param budget_base 当前 `api_keys.budget_base`（订阅套餐基础上限）；缺省视为 0
 * @returns 可能更新后的 `budget_spent` / `budget_reset_at` / `budget_max`（内存计算结果，是否写库由调用方决定）
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

/**
 * 将 `budget_reset_at` 规范到 UTC ISO，避免同一时刻不同字符串形式导致误判需写库。
 */
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

/**
 * `maybeResetBudget` 结果相对库行是否在金额或下次重置时间上有语义变化（已按网关金额精度比较）。
 * 避免 D1 REAL 浮点尾数与舍入值严格不等导致的伪 `period_reset` 审计。
 *
 * 注意：当传入 `budget_max` 字段时也参与比较，确保 lazy reset 把 `budget_max → budget_base` 的写入
 * 不会被误判为「无变化」。`budget_max` 为 null 与具体数字视为不同。
 */
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
 * 按 `user_id` 幂等：已存在活跃密钥则返回之，否则插入新行。
 * @param params.user_id 业务用户 id（唯一约束语义由上层保证）
 * @param params.user_email 可选展示/审计邮箱
 * @param params.budget_max 可选周期内上限；未传时默认 0
 * @param params.budget_period 可选，默认 `none`
 * @returns `created` 是否本次新建
 */
export async function getOrCreateKey(
	repos: GatewayRepositories,
	params: {
		user_id: string;
		user_email?: string;
		budget_max?: number | null;
		budget_period?: BudgetPeriod;
		/** 新建密钥时写入审计 `reason_text`；缺省为 `API key provisioned` */
		provision_reason?: string | null;
	}
): Promise<{ key: string; key_id: string; created: boolean }> {
	const existing = await getActiveApiKeyByUserId(repos, params.user_id);
	if (existing) {
		return { key: existing.key, key_id: existing.id, created: false };
	}

	const id = generateId();
	const key = generateKey();
	const budget_period = params.budget_period ?? 'none';
	const budget_reset_at = budget_period !== 'none' ? computeFirstReset(budget_period) : null;

	const insertParams: InsertKeyParams = {
		id,
		key,
		userId: params.user_id,
		userEmail: params.user_email ?? null,
		budgetMax: params.budget_max === undefined ? 0 : params.budget_max,
		budgetSpent: 0,
		budgetPeriod: budget_period,
		budgetResetAt: budget_reset_at,
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
			afterBudgetMax: insertParams.budgetMax,
			beforeBudgetPeriod: null,
			afterBudgetPeriod: insertParams.budgetPeriod,
			beforeBudgetResetAt: null,
			afterBudgetResetAt: insertParams.budgetResetAt,
			requestLogId: null,
			metadata: null,
		},
	});
	return { key, key_id: id, created: true };
}

/**
 * 与 `getOrCreateKey` 相同，但不返回 `created` 标志（Admin 创建接口常用）。
 */
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

/**
 * 管理端/详情用：读单行并应用懒预算重置，必要时写回；`metadata` 解析为对象。
 * @param id 密钥行主键 UUID
 */
export async function getKeyInfo(repos: GatewayRepositories, id: string) {
	const row = await repos.apiKeys.getApiKeyById(id);
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

/** 将密钥吊销（委托 DB 层 `revoked`）。 */
export async function revokeKey(repos: GatewayRepositories, id: string): Promise<boolean> {
	return repos.apiKeys.revokeApiKey(id);
}

/**
 * 更新预算计划并同步 metadata（字符串）等；未传 `budget_reset_at` 时按新周期计算默认下次重置。
 * @param params.reset_budget 默认 true：换方案时常清空已用（除非配合 `budget_spent` 等覆盖逻辑，见 DB 层）
 */
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
		/**
		 * 订阅套餐基础上限：
		 * - `undefined`：不修改库中 `budget_base`。
		 * - `number`：写入指定值。
		 * - `null`：写入 0（与库列 NOT NULL DEFAULT 0 一致）。
		 */
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
	return repos.apiKeys.updateApiKeyPlan(
		id,
		params.budget_max,
		params.budget_period,
		budget_reset_at,
		resetBudget,
		params.metadata,
		params.budget_spent,
		params.budget_base
	);
}

/**
 * 浅合并写入 `metadata`（读取现有 JSON 对象后与 `metadataPatch` 合并再存回）。
 */
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

/** 整体覆盖 `metadata` 列（已是合法 JSON 字符串或 null）。 */
export async function replaceKeyMetadata(repos: GatewayRepositories, id: string, metadataJson: string | null): Promise<boolean> {
	return repos.apiKeys.setApiKeyMetadataById(id, metadataJson);
}

/** 更新密钥状态字符串（如 active / revoked）。 */
export async function updateKeyStatus(repos: GatewayRepositories, id: string, status: string): Promise<boolean> {
	return repos.apiKeys.updateApiKeyStatusById(id, status);
}
