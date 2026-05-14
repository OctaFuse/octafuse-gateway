/**
 * `users` 行审计快照：JSON 存 `user_audit_logs.before_user_snapshot` / `after_user_snapshot`。
 */
import type { UserRow } from '../types';
import { roundGatewayMoney } from '../lib/money-precision';

/** 与 `users` 可对账字段对齐（不含 created_at/updated_at，避免噪声）。 */
export type UserAuditSnapshot = {
	id: string;
	email: string;
	budget_max: number | null;
	budget_base: number;
	budget_spent: number;
	budget_period: string;
	budget_reset_at: string | null;
	status: string;
	metadata: string | null;
	external_system: string | null;
	external_user_id: string | null;
};

export function userRowToSnapshot(row: UserRow): UserAuditSnapshot {
	return {
		id: row.id,
		email: row.email,
		budget_max: row.budget_max == null ? null : roundGatewayMoney(Number(row.budget_max)),
		budget_base: roundGatewayMoney(Number(row.budget_base ?? 0)),
		budget_spent: roundGatewayMoney(Number(row.budget_spent)),
		budget_period: row.budget_period,
		budget_reset_at: row.budget_reset_at,
		status: row.status,
		metadata: row.metadata,
		external_system: row.external_system,
		external_user_id: row.external_user_id,
	};
}

export function snapshotToJson(s: UserAuditSnapshot): string {
	return JSON.stringify(s);
}

function moneyEqual(a: number | null, b: number | null): boolean {
	if (a == null && b == null) return true;
	if (a == null || b == null) return false;
	return roundGatewayMoney(a) === roundGatewayMoney(b);
}

/** 比较两个快照，返回变更字段名列表（不含 id）。 */
export function computeChangedFields(before: UserAuditSnapshot, after: UserAuditSnapshot): string[] {
	const keys: (keyof Omit<UserAuditSnapshot, 'id'>)[] = [
		'email',
		'budget_max',
		'budget_base',
		'budget_spent',
		'budget_period',
		'budget_reset_at',
		'status',
		'metadata',
		'external_system',
		'external_user_id',
	];
	const out: string[] = [];
	for (const k of keys) {
		const bv = before[k];
		const av = after[k];
		if (k === 'budget_max' || k === 'budget_base' || k === 'budget_spent') {
			const nb = typeof bv === 'number' ? bv : bv == null ? null : Number(bv);
			const na = typeof av === 'number' ? av : av == null ? null : Number(av);
			if (!moneyEqual(nb, na)) out.push(k);
		} else if (bv !== av) {
			out.push(k);
		}
	}
	return out;
}

export function changedFieldsToJson(fields: string[]): string | null {
	return fields.length > 0 ? JSON.stringify(fields) : null;
}

export function snapshotWithOverrides(
	base: UserAuditSnapshot,
	patch: Partial<
		Pick<
			UserAuditSnapshot,
			| 'budget_max'
			| 'budget_base'
			| 'budget_spent'
			| 'budget_period'
			| 'budget_reset_at'
			| 'status'
			| 'metadata'
			| 'email'
			| 'external_system'
			| 'external_user_id'
		>
	>
): UserAuditSnapshot {
	return { ...base, ...patch };
}

/** 懒周期重置：用户行 before/after 快照与 changed_fields JSON。 */
export function buildUserAuditSnapshotsForLazyPeriodReset(
	row: UserRow,
	next: { budget_spent: number; budget_reset_at: string | null; budget_max: number | null },
	maxChanged: boolean
): { beforeUserSnapshot: string; afterUserSnapshot: string; changedFields: string | null } {
	const before = userRowToSnapshot(row);
	const after = snapshotWithOverrides(before, {
		budget_spent: roundGatewayMoney(next.budget_spent),
		budget_reset_at: next.budget_reset_at,
		budget_max: maxChanged ? next.budget_max : before.budget_max,
	});
	const fields = computeChangedFields(before, after);
	return {
		beforeUserSnapshot: snapshotToJson(before),
		afterUserSnapshot: snapshotToJson(after),
		changedFields: changedFieldsToJson(fields),
	};
}
