/**
 * 通用用户预算转换：基于当前 `budget_max/budget_spent` 计算结转并写入新周期基线。
 * 供 Admin `POST /users/:id/budget/transition` 使用；不含订阅/支付语义。
 */
import type { BudgetPeriod, UserRow } from '../types';
import type { GatewayRepositories } from '../storage/repositories';
import { roundGatewayMoney } from '../lib/money-precision';
import {
	changedFieldsToJson,
	computeChangedFields,
	snapshotToJson,
	userRowToSnapshot,
} from '../db/user-audit-snapshot';
import { userBudgetAuditToInsertRowFull } from '../db/user-budget-audit-mapper';
import { applyUserBudgetTransitionWithAuditTx } from '../storage/critical-write-paths';
import { computeFirstReset, getUserInfo, maybeResetBudget } from './user-service';

export type BudgetCarryoverStrategy = 'remaining_or_overage' | 'none';

export type BudgetTransitionParams = {
	target_budget_base: number;
	budget_period: BudgetPeriod;
	budget_reset_at?: string | null;
	carryover_strategy?: BudgetCarryoverStrategy;
	reset_spent?: boolean;
	metadata?: Record<string, unknown>;
	reason?: string;
};

export type BudgetTransitionSnapshot = {
	budget_max: number | null;
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
};

export type BudgetTransitionPreview = {
	before: BudgetTransitionSnapshot;
	after: BudgetTransitionSnapshot;
	carryover: number;
};

function snapshotFromUserRow(row: UserRow): BudgetTransitionSnapshot {
	const lazy = maybeResetBudget(
		row.budget_period,
		row.budget_reset_at,
		row.budget_spent,
		row.budget_max,
		row.budget_base
	);
	return {
		budget_max: lazy.budget_max,
		budget_base: roundGatewayMoney(Number(row.budget_base ?? 0)),
		budget_spent: lazy.budget_spent,
		budget_period: row.budget_period,
		budget_reset_at: lazy.budget_reset_at,
	};
}

function resolveBudgetResetAt(input: BudgetTransitionParams): string | null {
	if (input.budget_reset_at !== undefined) {
		return input.budget_reset_at;
	}
	if (input.budget_period === 'none') {
		return null;
	}
	return computeFirstReset(input.budget_period);
}

export function computeBudgetTransition(
	before: BudgetTransitionSnapshot,
	input: BudgetTransitionParams
): BudgetTransitionPreview {
	const targetBase = roundGatewayMoney(input.target_budget_base);
	const strategy = input.carryover_strategy ?? 'remaining_or_overage';
	const resetSpent = input.reset_spent ?? true;
	const currentMax = before.budget_max ?? 0;
	const currentSpent = before.budget_spent;
	const carryover =
		strategy === 'remaining_or_overage'
			? roundGatewayMoney(currentMax - currentSpent)
			: 0;
	const nextMax = roundGatewayMoney(targetBase + carryover);
	const nextSpent = resetSpent ? 0 : currentSpent;
	const budgetResetAt = resolveBudgetResetAt(input);

	return {
		before,
		after: {
			budget_max: nextMax,
			budget_base: targetBase,
			budget_spent: nextSpent,
			budget_period: input.budget_period,
			budget_reset_at: budgetResetAt,
		},
		carryover,
	};
}

function mergeMetadataJson(
	row: UserRow,
	metadataPatch: Record<string, unknown> | undefined
): string | null | undefined {
	if (metadataPatch === undefined) {
		return undefined;
	}
	const existing: Record<string, unknown> = row.metadata
		? (JSON.parse(row.metadata) as Record<string, unknown>)
		: {};
	return JSON.stringify({ ...existing, ...metadataPatch });
}

/**
 * 只读预览：先触发与 `getUserInfo` 一致的懒重置，再计算 before/after。
 */
export async function previewBudgetTransition(
	repos: GatewayRepositories,
	userId: string,
	input: BudgetTransitionParams
): Promise<BudgetTransitionPreview | null> {
	const info = await getUserInfo(repos, userId);
	if (!info) return null;
	const before: BudgetTransitionSnapshot = {
		budget_max: info.budget_max,
		budget_base: info.budget_base,
		budget_spent: info.budget_spent,
		budget_period: info.budget_period,
		budget_reset_at: info.budget_reset_at,
	};
	return computeBudgetTransition(before, input);
}

/**
 * 原子应用：事务内读用户行、按懒重置语义取有效快照、计算并写入 + 审计。
 */
export async function applyBudgetTransition(
	repos: GatewayRepositories,
	userId: string,
	input: BudgetTransitionParams
): Promise<{ preview: BudgetTransitionPreview; applied: BudgetTransitionSnapshot } | null> {
	const row = await repos.users.getById(userId);
	if (!row) return null;

	const before = snapshotFromUserRow(row);
	const preview = computeBudgetTransition(before, input);
	const metadataJson = mergeMetadataJson(row, input.metadata);
	const reasonText =
		typeof input.reason === 'string' && input.reason.trim() !== '' ? input.reason.trim() : 'Budget transition';

	const beforeSnap = snapshotToJson(userRowToSnapshot(row));
	const afterRowForSnap: UserRow = {
		...row,
		budget_max: preview.after.budget_max,
		budget_base: preview.after.budget_base,
		budget_spent: preview.after.budget_spent,
		budget_period: preview.after.budget_period,
		budget_reset_at: preview.after.budget_reset_at,
		metadata: metadataJson === undefined ? row.metadata : metadataJson,
	};
	const afterSnap = snapshotToJson(userRowToSnapshot(afterRowForSnap));
	const changedFieldsJson = changedFieldsToJson(
		computeChangedFields(userRowToSnapshot(row), userRowToSnapshot(afterRowForSnap))
	);

	const ok = await applyUserBudgetTransitionWithAuditTx(repos, {
		userId,
		budgetMax: preview.after.budget_max,
		budgetBase: preview.after.budget_base,
		budgetSpent: preview.after.budget_spent,
		budgetPeriod: preview.after.budget_period,
		budgetResetAt: preview.after.budget_reset_at,
		metadata: metadataJson,
		audit: userBudgetAuditToInsertRowFull(userId, {
			id: crypto.randomUUID(),
			apiKeyId: null,
			eventType: 'admin_adjust',
			actorType: 'admin',
			actorId: 'master_key',
			reasonCode: 'budget_transition',
			reasonText,
			beforeSpent: before.budget_spent,
			deltaSpent: preview.after.budget_spent - before.budget_spent,
			afterSpent: preview.after.budget_spent,
			beforeBudgetMax: before.budget_max,
			afterBudgetMax: preview.after.budget_max,
			beforeBudgetBase: before.budget_base,
			afterBudgetBase: preview.after.budget_base,
			beforeBudgetPeriod: before.budget_period,
			afterBudgetPeriod: preview.after.budget_period,
			beforeBudgetResetAt: before.budget_reset_at,
			afterBudgetResetAt: preview.after.budget_reset_at,
			changePayloadMerge: JSON.stringify({
				carryover: preview.carryover,
				carryover_strategy: input.carryover_strategy ?? 'remaining_or_overage',
				target_budget_base: roundGatewayMoney(input.target_budget_base),
			}),
			beforeUserSnapshot: beforeSnap,
			afterUserSnapshot: afterSnap,
			changedFields: changedFieldsJson,
			source: 'admin_budget_transition',
			correlationId: crypto.randomUUID(),
		}),
	});
	if (!ok) {
		throw new Error('Failed to apply budget transition');
	}
	return { preview, applied: preview.after };
}
