# 用户预算审计日志（`user_audit_logs`）

网关将预算相关变更与部分管理端操作写入 **`user_audit_logs`**（用户维度；可选 `api_key_id` 归因）。

## 金额与上限（API 中的 `before_spent` / `delta_spent` / `after_spent` / `before_budget_max` / `after_budget_max`）

表结构已精简：上述字段**不再单独落库**，由读取层根据 **`before_user_snapshot`**、**`after_user_snapshot`**（`UserAuditSnapshot` JSON，含 `budget_spent`、`budget_max` 等）**派生**，与历史「独立金额列」语义一致。建表定义见各库 **`packages/core/migrations-*/0001_baseline.sql`** 中的 `CREATE TABLE user_audit_logs`。

## 扩展载荷（`change_payload`）

原 **`metadata`** 列已更名为 **`change_payload`**，仍为 JSON 字符串，用于：

- 预算周期类扩展（`before_budget_period`、`after_budget_reset_at` 等，由 `mergeUserAuditChangePayload` 合并写入）；
- 管理端 profile / 密钥 patch 的可读摘要（与 Admin「Extra」展示逻辑一致）。

## 为何「没人改配置却一直有新行」

最常见是 **`usage_charge`**：每次成功计费且 `charged_cost > 0` 的请求结束后，同一事务写入审计。此时 **`budget_max` / `budget_period` 在快照里往往不变**，变化在 **`budget_spent`**（见快照 diff 或派生的 `delta_spent`），并可通过 **`request_log_id`** 关联 `api_key_request_logs`。

## 写入场景（按常见频率）

### 1. 用量扣费（`usage_charge`）

- **代码**：[packages/proxy/src/services/usage-tracker.ts](../../packages/proxy/src/services/usage-tracker.ts) 的 `recordUsage`。
- **事务**：`insertRequestUsageAndChargeTx`（[critical-write-paths](../../packages/core/src/storage/critical-write-paths.ts) / D1 [critical-writes.impl](../../packages/core/src/db/d1/critical-writes.impl.ts)）。

### 2. 鉴权 / 读详情时的周期懒重置（`period_reset`）

- [packages/proxy/src/services/api-key-auth.ts](../../packages/proxy/src/services/api-key-auth.ts)
- [packages/core/src/services/key-service.ts](../../packages/core/src/services/key-service.ts) `getKeyInfo`

### 3. 新建密钥（`key_created`）

- `createKey` → `createApiKeyWithAudit`

### 4. 管理端 PATCH 用户 / 密钥（`admin_adjust`）

- [packages/admin/lib/services/admin/users-service.ts](../../packages/admin/lib/services/admin/users-service.ts)
- [packages/admin/lib/services/admin/keys-service.ts](../../packages/admin/lib/services/admin/keys-service.ts)

## 相关接口

- Admin：`GET /api/admin/budget-audit-logs`（见 [api/admin.md](../api/admin.md)）。

## 建表与迁移

- D1 / Postgres / MySQL：当前表结构在 **`packages/core/migrations-{d1,postgres,mysql}/0001_baseline.sql`**（`user_audit_logs` 段）。已有环境若仍为旧列布局，需自行做一次性数据迁移或清空后按 baseline 重建（本仓库不再提供增量 `0003` 脚本）。
