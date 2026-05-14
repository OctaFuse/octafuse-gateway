/**
 * 从 `before_user_snapshot` / `after_user_snapshot` 派生预算金额列（与已删除的表列语义对齐）。
 */
import { roundGatewayMoney } from '../lib/money-precision';
import type { UserAuditLogRow } from '../types';
import type { UserAuditSnapshot } from './user-audit-snapshot';

/** 宽松解析快照 JSON（历史行或回填行可能字段不全）。 */
export function parseUserAuditSnapshotFromJson(raw: string | null | undefined): UserAuditSnapshot | null {
	if (raw == null || String(raw).trim() === '') return null;
	try {
		const o = JSON.parse(String(raw)) as Record<string, unknown>;
		if (!o || typeof o !== 'object') return null;
		const id = typeof o.id === 'string' ? o.id : '';
		const email = typeof o.email === 'string' ? o.email : '';
		const budget_spent = roundGatewayMoney(Number(o.budget_spent ?? 0));
		let budget_max: number | null = null;
		if (o.budget_max !== undefined && o.budget_max !== null && o.budget_max !== 'null') {
			const n = Number(o.budget_max);
			budget_max = Number.isFinite(n) ? roundGatewayMoney(n) : null;
		}
		const budget_base = roundGatewayMoney(Number(o.budget_base ?? 0));
		const budget_period = typeof o.budget_period === 'string' && o.budget_period !== '' ? o.budget_period : 'none';
		const budget_reset_at =
			o.budget_reset_at === undefined || o.budget_reset_at === null || o.budget_reset_at === ''
				? null
				: String(o.budget_reset_at);
		const status = typeof o.status === 'string' ? o.status : '';
		const metadata = o.metadata === undefined || o.metadata === null ? null : String(o.metadata);
		const external_system =
			o.external_system === undefined || o.external_system === null ? null : String(o.external_system);
		const external_user_id =
			o.external_user_id === undefined || o.external_user_id === null ? null : String(o.external_user_id);
		return {
			id,
			email,
			budget_max,
			budget_base,
			budget_spent,
			budget_period,
			budget_reset_at,
			status,
			metadata,
			external_system,
			external_user_id,
		};
	} catch {
		return null;
	}
}

export type DerivedUserAuditBudgetFields = Pick<
	UserAuditLogRow,
	| 'before_spent'
	| 'delta_spent'
	| 'after_spent'
	| 'before_budget_max'
	| 'after_budget_max'
	| 'before_budget_base'
	| 'after_budget_base'
>;

/**
 * 由前后快照推导 spent / budget_max；任一侧缺失时用另一侧补齐（同快照 key_created 等场景 delta=0）。
 */
export function deriveUserAuditBudgetFromSnapshots(
	beforeSnapshot: string | null | undefined,
	afterSnapshot: string | null | undefined
): DerivedUserAuditBudgetFields {
	const before = parseUserAuditSnapshotFromJson(beforeSnapshot);
	const after = parseUserAuditSnapshotFromJson(afterSnapshot);
	const beforeSpent = roundGatewayMoney(before?.budget_spent ?? after?.budget_spent ?? 0);
	const afterSpent = roundGatewayMoney(after?.budget_spent ?? before?.budget_spent ?? 0);
	const beforeMax = (before?.budget_max ?? after?.budget_max) ?? null;
	const afterMax = (after?.budget_max ?? before?.budget_max) ?? null;
	const beforeBase = roundGatewayMoney(before?.budget_base ?? after?.budget_base ?? 0);
	const afterBase = roundGatewayMoney(after?.budget_base ?? before?.budget_base ?? 0);
	return {
		before_spent: beforeSpent,
		after_spent: afterSpent,
		delta_spent: roundGatewayMoney(afterSpent - beforeSpent),
		before_budget_max: beforeMax,
		after_budget_max: afterMax,
		before_budget_base: beforeBase,
		after_budget_base: afterBase,
	};
}
