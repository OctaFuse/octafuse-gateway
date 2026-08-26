# 0027：周期额度 + 永久额度（Budget / Wallet）

迁移文件：`packages/core/migrations-{d1,postgres,mysql}/0027_user_wallet_credit.sql`。

## 上线前审计（2026-08-26 已跑）

只读脚本：[`0027-user-wallet-credit-audit.sql`](./0027-user-wallet-credit-audit.sql)（Postgres）与 [`0027-user-wallet-credit-audit.d1.sql`](./0027-user-wallet-credit-audit.d1.sql)。

| 类别 | 海外 D1 | 境内 Postgres | 处理（已确认） |
|------|---------|---------------|----------------|
| 总用户 | 3797 | 3635 | — |
| `budget_max IS NULL` | 2 | 1 | 跳过。判定仍视 `null` 为无限。 |
| `budget_max < budget_base` | 12（抬升合计 70.83；其中 5 行 `max=0, period=none, spent=0, base∈{9.9,20}` 像到期清零） | 63（抬升合计 16.53；全是 `max` 略低于 `base` 的浮点/扣费残差，无 `max=0`） | **到期清零**（`max=0 AND period=none`）**不抬回 base**，否则会误发一套餐周期额度。其余残差行按原公式把 `max` 抬到 `base`。 |
| `budget_spent > budget_max` | 419（欠账合计 1621.92，单笔最大 99.71） | 381（欠账合计 87.05，单笔最大 4.82） | 超支欠账钳到 0，不追讨。 |
| 将迁入永久额度 | 1657 行、合计约 1206.79（多数 0–0.5 注册赠额） | 2859 行、合计约 8274.10（多数 0.5–10） | `wallet_granted = max(0, max − max(spent, base))`。 |

D1 审计把 SQL 里的 `GREATEST`/`LEAST` 换成标量 `max()`/`min()`。

```bash
# 海外 D1（只读 command）
npx wrangler d1 execute octafuse-gateway --remote \
  --config packages/core/wrangler.d1.jsonc \
  --file docs/operators/migrations/0027-user-wallet-credit-audit.sql

# 境内 Postgres
psql "$DATABASE_URL" -f docs/operators/migrations/0027-user-wallet-credit-audit.sql
```

## 数据公式（`budget_max IS NOT NULL`）

```
wallet_granted = max(0, budget_max − max(budget_spent, budget_base))
wallet_spent   = 0
budget_max     ← budget_base
budget_spent   ← min(budget_spent, budget_base)
```

## 上线顺序

1. Gateway 代码先上（新列默认 0，旧门户 PATCH `budget_max` 仍可用）。
2. 审计通过后 apply `0027`（海外 D1、境内 Postgres 分别执行）。
3. 门户再切到 `POST /api/admin/users/:id/wallet/credit`。
