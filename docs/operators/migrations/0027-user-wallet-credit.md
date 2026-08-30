# 0027：周期额度 + 永久额度（Budget / Wallet）

迁移文件：`packages/core/migrations-{d1,postgres,mysql}/0027_user_wallet_credit.sql`。

## 上线前审计（2026-08-26 已跑）

只读脚本：[`0027-user-wallet-credit-audit.sql`](./0027-user-wallet-credit-audit.sql)（Postgres / MySQL）与 [`0027-user-wallet-credit-audit.d1.sql`](./0027-user-wallet-credit-audit.d1.sql)（D1）。

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
  --file docs/operators/migrations/0027-user-wallet-credit-audit.d1.sql

# Postgres；MySQL 使用同一 SQL 文件，通过现有数据库客户端执行
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

v2.8.0 的 Proxy / Admin 查询会直接读取 `wallet_granted`、`wallet_spent` 和 `charged_wallet_cost`，因此不能先把新代码连接到尚未执行 0027 的数据库。迁移会重排额度数据，旧版本又不会读取永久额度，所以也不要在迁移后继续长时间运行旧服务。

1. 备份数据库，安排维护窗口，并暂停 Proxy 请求与 Admin / 门户额度写入。
2. 使用当前数据运行上面的只读审计，确认无限额、到期清零、超支和待迁入永久额度的数量与金额。
3. 使用 **v2.8.0 migrate** 对 D1、Postgres 或 MySQL 应用 0027。
4. 迁移成功后立即部署同为 **v2.8.0** 的 Proxy 与 Admin；禁止不同版本混跑。
5. 核验服务后，门户再切到 `POST /api/admin/users/:id/wallet/credit`，恢复流量与额度写入。加购不再累加 `budget_max`。

## 迁移后检查

- 随机抽查用户详情：周期额度与永久额度分开展示，`wallet_granted - wallet_spent` 不为负数。
- 对照迁移前审计结果，确认原有额外剩余额度已进入永久额度；`budget_max IS NULL` 用户仍保持无限额语义，到期清零用户没有被重新发放周期额度。
- 使用同一 `external_ref` 连续调用两次 wallet credit 接口，确认只加额一次，并能在用户审计日志中定位记录。
- 发起一笔会使用永久额度的请求，确认请求成功，且 `api_key_request_logs.charged_wallet_cost` 记录了永久额度扣减。
- 分别冒烟用户鉴权、Admin 用户详情与既有 Chat / Images / Audio 请求，再恢复生产流量。

0027 同时包含表结构变更和数据回填，不要手工重复执行迁移 SQL。若迁移失败或抽查结果不符合预期，保持流量暂停，从迁移前备份恢复后排查；不要只回滚应用代码继续运行已迁移的数据。
