import type { UserBudgetAuditExtraFields } from './user-audit-logs-types';

/**
 * 将旧版 api_key 审计扩展列折叠进 `user_audit_logs.metadata`。
 */
export function mergeUserAuditMetadata(base: string | null | undefined, extra: UserBudgetAuditExtraFields): string | null {
	const trimmed: Record<string, unknown> = {};
	if (extra.actorId != null && extra.actorId !== '') trimmed.actor_id = extra.actorId;
	if (extra.reasonCode != null && extra.reasonCode !== '') trimmed.reason_code = extra.reasonCode;
	if (extra.reasonText != null && extra.reasonText !== '') trimmed.reason_text = extra.reasonText;
	if (extra.beforeBudgetBase !== undefined) trimmed.before_budget_base = extra.beforeBudgetBase;
	if (extra.afterBudgetBase !== undefined) trimmed.after_budget_base = extra.afterBudgetBase;
	if (extra.beforeBudgetPeriod !== undefined) trimmed.before_budget_period = extra.beforeBudgetPeriod;
	if (extra.afterBudgetPeriod !== undefined) trimmed.after_budget_period = extra.afterBudgetPeriod;
	if (extra.beforeBudgetResetAt !== undefined) trimmed.before_budget_reset_at = extra.beforeBudgetResetAt;
	if (extra.afterBudgetResetAt !== undefined) trimmed.after_budget_reset_at = extra.afterBudgetResetAt;

	let merged: Record<string, unknown> = {};
	if (base != null && base !== '') {
		try {
			const parsed = JSON.parse(base) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				merged = parsed as Record<string, unknown>;
			}
		} catch {
			merged = { raw: base };
		}
	}
	const out = { ...merged, ...trimmed };
	return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}
