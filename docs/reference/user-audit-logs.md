# 用户审计日志（`user_audit_logs`）

网关将预算变更、用量扣费、用户/密钥生命周期及管理端操作写入 **`user_audit_logs`**（**用户维度**；可选 **`api_key_id`** 归因到具体密钥）。

对外管理 API 路径历史名为 **`/api/admin/budget-audit-logs`**（内部 Hono 挂载 **`/admin/budget-audit-logs`**），数据源已为 **`user_audit_logs`** 表；按用户筛选的子资源为 **`GET /api/admin/users/:id/audit-logs`**。

## 语义模型（Event / Actor / Cause）

| 维度 | 列 | 含义 |
|------|-----|------|
| **Event** | `event_type` | 业务事件：`usage_charge`、`period_reset`、`admin_adjust`、`key_created`、`key_revoked`、`key_deleted`、`user_created`、`user_deleted` 等。 |
| **Actor** | `actor_type` + `actor_id` | `system` / `admin` / `service` 与稳定 principal（如新写入中的 `admin:gateway_master_key`）。 |
| **Cause** | `source` + `reason_code` + `reason_text` | 入口通道、机器可筛码、人类可读说明。 |
| **快照** | `before_user_snapshot` / `after_user_snapshot` / `changed_fields` | `UserAuditSnapshot` JSON；金额类展示以快照为准。 |
| **扩展** | `change_payload` | JSON：周期前后值、管理端 patch 摘要、删除上下文等。 |

写入前由 `assertAndFinalizeUserAuditInsert`（`packages/core/src/db/user-audit-catalog.ts`）做枚举与缺省归一化。跨服务审计载荷类型为 **`InsertUserBudgetAuditLogParams`**（`packages/core/src/db/user-budget-audit-params.ts`），映射到插入行见 **`userBudgetAuditToInsertRow*`**（`packages/core/src/db/user-budget-audit-mapper.ts`）。

## 典型写入场景

### 1. 用量扣费（`usage_charge`）

- **代码**：`packages/proxy/src/services/usage-tracker.ts` → `recordUsage`。
- **事务**：`insertRequestUsageAndChargeTx`（与 `api_key_request_logs` 同事务）。
- **Cause**：`source=gateway_usage`，`reason_code=request_usage_charged_cost`，`correlation_id` 常与请求日志 id 对齐。

### 2. 鉴权 / 读详情时的周期懒重置（`period_reset`）

- `packages/proxy/src/services/api-key-auth.ts`、`packages/core/src/services/user-service.ts` 等路径在需要持久化 lazy reset 时调用 **`updateUserBudgetWithAuditTx`**。

### 3. 用户幂等创建（`user_created`）

- `getOrCreateUser` 首次落库后写入；`actor_type=service`，`source` 随入口（如 `gateway_user_provision`）。

### 4. 新建密钥（`key_created`）

- `createKey` → `createApiKeyWithAudit`；`source=key_provision`。

### 5. 吊销 / 删除密钥（`key_revoked` / `key_deleted`）

- 管理端 PATCH `revoked` 或 DELETE 密钥前写入；`source` 为 `admin_keys` / `admin_user_key` 等。

### 6. 管理端 PATCH 用户 / 密钥（`admin_adjust`）

- `packages/admin/lib/services/admin/users-service.ts`、`keys-service.ts`。
- **Cause**：`source=admin_users`；`reason_code` / `reason_text` 随 patch 场景（如门户订阅激活、过期回收）。

### 7. 管理端预算转换（`admin_adjust` + `budget/transition`）

- **代码**：`packages/core/src/services/budget-transition-service.ts` → `applyBudgetTransition`；Admin 路由 `POST /api/admin/users/:id/budget/transition`。
- **事务**：`applyUserBudgetTransitionWithAuditTx`（更新 `users.budget_*` 与审计同事务）。
- **Cause**：`source=admin_budget_transition`，`reason_code=budget_transition`；`reason_text` 由调用方传入（如门户 `wechat_pay:active`、Stripe/Creem 换档）。
- **与 PATCH 区分**：PATCH 绝对值/重置走 `source=admin_users`；带结转语义的换档走本通道。

### 8. 用户物理删除（`user_deleted`）

- 删除前写入；随后删除 `users` 行，`user_audit_logs.user_id` 由外键 **`ON DELETE SET NULL`**，历史行保留（身份见快照 / `change_payload`）。

## 相关接口与表结构

- 全局列表：`GET /api/admin/budget-audit-logs`（查询参数含 `user_id`、`api_key_id`、`user_email`、`event_type`、`actor_type`、`reason_code`、`source`、`correlation_id`、时间窗等）— 详见 [api/admin.md](../api/admin.md)。
- 基线 DDL：`packages/core/migrations-{d1,postgres,mysql}/0001_baseline.sql` 中 `CREATE TABLE user_audit_logs` 与相关索引。

## 旧文档名

历史文件名 **`budget-audit-logs.md`** 仍保留为跳转入口，避免外部链接失效；正文以本文为准。
