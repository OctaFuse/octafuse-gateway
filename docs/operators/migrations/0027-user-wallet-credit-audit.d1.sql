-- D1 / SQLite 只读审计（与 0027-user-wallet-credit-audit.sql 同语义，用标量 max/min）。

SELECT
  COUNT(*) AS total_users,
  SUM(CASE WHEN budget_max IS NULL THEN 1 ELSE 0 END) AS max_null,
  SUM(CASE WHEN budget_max IS NOT NULL AND budget_max < budget_base THEN 1 ELSE 0 END) AS max_lt_base,
  SUM(CASE WHEN budget_max IS NOT NULL AND budget_spent > budget_max THEN 1 ELSE 0 END) AS spent_gt_max,
  SUM(CASE WHEN budget_max IS NOT NULL AND budget_max > budget_base THEN 1 ELSE 0 END) AS likely_topup
FROM users;

SELECT COUNT(*) AS n, status
FROM users
WHERE budget_max IS NULL
GROUP BY status;

SELECT
  COUNT(*) AS n,
  ROUND(SUM(budget_base - budget_max), 6) AS sum_raise_to_base,
  ROUND(MIN(budget_max), 6) AS min_max,
  ROUND(MAX(budget_base), 6) AS max_base
FROM users
WHERE budget_max IS NOT NULL AND budget_max < budget_base;

SELECT
  COUNT(*) AS n,
  ROUND(SUM(budget_spent - budget_max), 6) AS sum_overspend_forgiven,
  ROUND(MIN(budget_spent - budget_max), 6) AS min_over,
  ROUND(MAX(budget_spent - budget_max), 6) AS max_over
FROM users
WHERE budget_max IS NOT NULL AND budget_spent > budget_max;

SELECT
  CASE
    WHEN max(0, budget_max - max(budget_spent, budget_base)) = 0 THEN '0'
    WHEN max(0, budget_max - max(budget_spent, budget_base)) <= 0.5 THEN '0-0.5 (signup?)'
    WHEN max(0, budget_max - max(budget_spent, budget_base)) <= 10 THEN '0.5-10'
    WHEN max(0, budget_max - max(budget_spent, budget_base)) <= 50 THEN '10-50'
    ELSE '>50'
  END AS wallet_bucket,
  COUNT(*) AS n,
  ROUND(SUM(max(0, budget_max - max(budget_spent, budget_base))), 6) AS sum_wallet
FROM users
WHERE budget_max IS NOT NULL
GROUP BY wallet_bucket
ORDER BY wallet_bucket;
