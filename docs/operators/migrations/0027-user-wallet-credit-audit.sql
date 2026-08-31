-- 0027 迁移前审计（只读，Postgres / MySQL）。与 D1 环境分别执行对应脚本，人工确认后再 apply 0027。
-- 异常行处理（已确认）：
--   budget_max IS NULL          → 跳过（无限额）
--   budget_spent > budget_max   → 超支欠账钳到 0（不追讨）；周期 spent 钳到 base
--   budget_max < budget_base    → 公式把 budget_max 抬到 base（等价提前一次 lazy reset）
--   free 注册赠额 (base=0, max>0) → 自然落入 wallet_granted

-- 1) 总览
SELECT
  COUNT(*) AS total_users,
  SUM(CASE WHEN budget_max IS NULL THEN 1 ELSE 0 END) AS max_null,
  SUM(CASE WHEN budget_max IS NOT NULL AND budget_max < budget_base THEN 1 ELSE 0 END) AS max_lt_base,
  SUM(CASE WHEN budget_max IS NOT NULL AND budget_spent > budget_max THEN 1 ELSE 0 END) AS spent_gt_max,
  SUM(CASE WHEN budget_max IS NOT NULL AND budget_max > budget_base THEN 1 ELSE 0 END) AS likely_topup
FROM users;

-- 2) budget_max IS NULL（无限额，迁移跳过）
SELECT COUNT(*) AS n, status
FROM users
WHERE budget_max IS NULL
GROUP BY status;

-- 3) budget_max < budget_base（运营手工改过；迁移会抬到 base）
SELECT
  COUNT(*) AS n,
  ROUND(SUM(budget_base - budget_max), 6) AS sum_raise_to_base,
  ROUND(MIN(budget_max), 6) AS min_max,
  ROUND(MAX(budget_base), 6) AS max_base
FROM users
WHERE budget_max IS NOT NULL AND budget_max < budget_base;

-- 4) budget_spent > budget_max（已超支被拦；迁移后永久 0、周期剩 0）
SELECT
  COUNT(*) AS n,
  ROUND(SUM(budget_spent - budget_max), 6) AS sum_overspend_forgiven,
  ROUND(MIN(budget_spent - budget_max), 6) AS min_over,
  ROUND(MAX(budget_spent - budget_max), 6) AS max_over
FROM users
WHERE budget_max IS NOT NULL AND budget_spent > budget_max;

-- 5) 将迁入永久额度的金额分布（公式：max(0, max - max(spent, base))）
SELECT
  CASE
    WHEN GREATEST(0, budget_max - GREATEST(budget_spent, budget_base)) = 0 THEN '0'
    WHEN GREATEST(0, budget_max - GREATEST(budget_spent, budget_base)) <= 0.5 THEN '0-0.5 (signup?)'
    WHEN GREATEST(0, budget_max - GREATEST(budget_spent, budget_base)) <= 10 THEN '0.5-10'
    WHEN GREATEST(0, budget_max - GREATEST(budget_spent, budget_base)) <= 50 THEN '10-50'
    ELSE '>50'
  END AS wallet_bucket,
  COUNT(*) AS n,
  ROUND(SUM(GREATEST(0, budget_max - GREATEST(budget_spent, budget_base))), 6) AS sum_wallet
FROM users
WHERE budget_max IS NOT NULL
GROUP BY 1
ORDER BY 1;

-- SQLite / D1 把上面 GREATEST 换成标量 max()：
--   max(0, budget_max - max(budget_spent, budget_base))
-- GROUP BY 1 在 D1 写成 GROUP BY wallet_bucket。
