-- Cycle Budget + permanent Wallet. Backfill splits leftover (max - max(spent, base)) into wallet.
-- budget_max IS NULL (unlimited) is skipped. Overspend is clamped to 0 (not collected).

ALTER TABLE users ADD COLUMN wallet_granted REAL NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN wallet_spent REAL NOT NULL DEFAULT 0;

ALTER TABLE user_audit_logs ADD COLUMN dedup_key TEXT NULL;
CREATE UNIQUE INDEX ux_user_audit_dedup ON user_audit_logs(user_id, dedup_key);

ALTER TABLE api_key_request_logs ADD COLUMN charged_wallet_cost REAL NOT NULL DEFAULT 0;

-- Skip expired/revoked rows (max=0, period=none): raising max to base would re-grant a cycle.
UPDATE users
SET
  wallet_granted = max(0, budget_max - max(budget_spent, budget_base)),
  wallet_spent = 0,
  budget_spent = min(budget_spent, budget_base),
  budget_max = budget_base
WHERE budget_max IS NOT NULL
  AND NOT (budget_max = 0 AND budget_period = 'none');
