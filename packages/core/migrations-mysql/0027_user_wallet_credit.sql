-- Cycle Budget + permanent Wallet. Backfill splits leftover (max - max(spent, base)) into wallet.
-- budget_max IS NULL (unlimited) is skipped. Overspend is clamped to 0 (not collected).
-- MySQL UNIQUE 不能用 TEXT；dedup_key 用 VARCHAR。NULL 互不相等，既有行不受影响。

ALTER TABLE users
  ADD COLUMN wallet_granted DECIMAL(18, 6) NOT NULL DEFAULT 0,
  ADD COLUMN wallet_spent DECIMAL(18, 6) NOT NULL DEFAULT 0;

ALTER TABLE user_audit_logs ADD COLUMN dedup_key VARCHAR(255) NULL;
CREATE UNIQUE INDEX ux_user_audit_dedup ON user_audit_logs (user_id, dedup_key);

ALTER TABLE api_key_request_logs
  ADD COLUMN charged_wallet_cost DECIMAL(18, 6) NOT NULL DEFAULT 0;

-- Skip expired/revoked rows (max=0, period=none): raising max to base would re-grant a cycle.
UPDATE users
SET
  wallet_granted = GREATEST(0, budget_max - GREATEST(budget_spent, budget_base)),
  wallet_spent = 0,
  budget_spent = LEAST(budget_spent, budget_base),
  budget_max = budget_base
WHERE budget_max IS NOT NULL
  AND NOT (budget_max = 0 AND budget_period = 'none');
