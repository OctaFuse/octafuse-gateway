import type { GatewayApiKeyBudgetAuditLog } from '@/lib/types';
import {
  auditDisplayExtras,
  budgetMoneySemanticallyEqual,
  budgetResetAtSemanticallyEqual,
} from '@/lib/audit-log-display';
import { summarizeWalletSnapshotDiff } from '@/lib/audit-user-snapshot-diff';

export type AuditValueRow = {
  key: 'spent' | 'max' | 'base' | 'period' | 'resetAt' | 'granted' | 'remaining';
  before: number | string | null | undefined;
  after: number | string | null | undefined;
  kind: 'money' | 'limit' | 'period' | 'date';
  changed: boolean;
  delta?: number;
};
export function auditFinancialRows(item: GatewayApiKeyBudgetAuditLog): {
  cycle: AuditValueRow[];
  wallet: AuditValueRow[];
} {
  const extra = auditDisplayExtras(item);
  const wallet = summarizeWalletSnapshotDiff(item.before_user_snapshot, item.after_user_snapshot);
  const walletRecorded = [item.before_user_snapshot, item.after_user_snapshot].some((raw) => {
    try {
      const data = JSON.parse(raw || '{}');
      return (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        ('wallet_granted' in data || 'wallet_spent' in data)
      );
    } catch {
      return false;
    }
  });
  return {
    cycle: [
      {
        key: 'spent',
        before: item.before_spent,
        after: item.after_spent,
        kind: 'money',
        changed: !budgetMoneySemanticallyEqual(item.before_spent, item.after_spent),
        delta: item.delta_spent,
      },
      {
        key: 'max',
        before: item.before_budget_max,
        after: item.after_budget_max,
        kind: 'limit',
        changed: !budgetMoneySemanticallyEqual(item.before_budget_max, item.after_budget_max),
      },
      {
        key: 'base',
        before: item.before_budget_base,
        after: item.after_budget_base,
        kind: 'money',
        changed: !budgetMoneySemanticallyEqual(item.before_budget_base, item.after_budget_base),
      },
      {
        key: 'period',
        before: extra.before_budget_period,
        after: extra.after_budget_period,
        kind: 'period',
        changed: (extra.before_budget_period || 'none') !== (extra.after_budget_period || 'none'),
      },
      {
        key: 'resetAt',
        before: extra.before_budget_reset_at,
        after: extra.after_budget_reset_at,
        kind: 'date',
        changed: !budgetResetAtSemanticallyEqual(
          extra.before_budget_reset_at,
          extra.after_budget_reset_at
        ),
      },
    ],
    wallet:
      wallet.hasSnapshot && walletRecorded
        ? [
            {
              key: 'granted',
              before: wallet.beforeGranted,
              after: wallet.afterGranted,
              kind: 'money',
              changed: wallet.grantedChanged,
              delta: wallet.afterGranted - wallet.beforeGranted,
            },
            {
              key: 'spent',
              before: wallet.beforeSpent,
              after: wallet.afterSpent,
              kind: 'money',
              changed: wallet.spentChanged,
              delta: wallet.afterSpent - wallet.beforeSpent,
            },
            {
              key: 'remaining',
              before: wallet.beforeRemaining,
              after: wallet.afterRemaining,
              kind: 'money',
              changed: wallet.remainingChanged,
            },
          ]
        : [],
  };
}
export function auditUserEmail(item: GatewayApiKeyBudgetAuditLog): string | null {
  if (item.user_email) return item.user_email;
  for (const raw of [item.after_user_snapshot, item.before_user_snapshot]) {
    try {
      const snapshot = JSON.parse(raw || '{}');
      if (typeof snapshot?.email === 'string' && snapshot.email) return snapshot.email;
    } catch {
      /* Legacy snapshots may be malformed. */
    }
  }
  return null;
}
export function auditRequestHref(item: GatewayApiKeyBudgetAuditLog): string | null {
  if (!item.request_log_id) return null;
  return `/gateway/request-logs?${new URLSearchParams({
    id: item.request_log_id,
    start_date: '',
    end_date: '',
  })}`;
}
