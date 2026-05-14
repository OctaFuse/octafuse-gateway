# 用户预算审计日志（`user_audit_logs`）

网关将预算相关变更、用户/密钥生命周期与管理端操作写入 **`user_audit_logs`**（用户维度；可选 `api_key_id` 归因）。

## 语义模型（Event / Actor / Cause）

| 维度 | 列 | 含义 |
|------|-----|------|
| **Event** | `event_type` | 权威业务事件（枚举：`usage_charge`、`period_reset`、`admin_adjust`、`key_created`、`key_revoked`、`key_deleted`、`user_created`、`user_deleted`）。 |
| **Actor** | `actor_type` + `actor_id` | 谁触发：`system` / `admin` / `service`；`actor_id` 为稳定 principal（如新写入中 `system:gateway`、`admin:gateway_master_key`、`service:user_provision`）。 |
| **Cause** | `source` + `reason_code` + `reason_text` | **source**：入口通道（如 `gateway_usage`、`gateway_auth`、`admin_users`）；**reason_code**：机器可筛的稳定码；**reason_text**：人类可读说明。 |
| **变更内容** | `before_user_snapshot` / `after_user_snapshot` / `changed_fields` / `change_payload` | 快照与结构化扩展。 |

写入前由 `assertAndFinalizeUserAuditInsert`（`packages/core/src/db/user-audit-catalog.ts`）校验 event/actor/source 并对缺省 `actor_id`、旧 `source=usage_charge` 做归一化。

## 金额与上限（API 中的 `before_spent` / `delta_spent` / …）

表结构已精简：上述金额字段**不再单独落库**，由读取层根据 **`before_user_snapshot`**、**`after_user_snapshot`**（`UserAuditSnapshot` JSON）**派生**。`user_audit_logs.user_id` 可空且外键为 **`ON DELETE SET NULL`**（用户删除后审计行保留；身份见快照 / `change_payload`），见各库 **`packages/core/migrations-*/0001_baseline.sql`** 中 `CREATE TABLE user_audit_logs` 与索引 `idx_user_audit_reason_created`。

## 扩展载荷（`change_payload`）

仍为 JSON 字符串：预算周期类键、管理端 patch 摘要、`user_deleted` / `key_deleted` 时的删除上下文等。

## 写入场景（按常见频率）

### 1. 用量扣费（`usage_charge`）

- **代码**：[packages/proxy/src/services/usage-tracker.ts](../../packages/proxy/src/services/usage-tracker.ts) 的 `recordUsage`。
- **事务**：`insertRequestUsageAndChargeTx`。
- **Cause**：`source=gateway_usage`，`reason_code=request_usage_charged_cost`，`correlation_id` 与请求日志 id 对齐。

### 2. 鉴权 / 读详情时的周期懒重置（`period_reset`）

- [packages/proxy/src/services/api-key-auth.ts](../../packages/proxy/src/services/api-key-auth.ts) — `source=gateway_auth`。
- [packages/core/src/services/user-service.ts](../../packages/core/src/services/user-service.ts) `getUserInfo` / `getKeyInfo` — `source=gateway_user_service` / `gateway_key_service`；均带 `correlation_id`。

### 3. 用户幂等创建（`user_created`）

- `getOrCreateUser` 在首次 `createUser` 后写入；`source=gateway_user_provision`，`actor_type=service`。

### 4. 新建密钥（`key_created`）

- `createKey` → `createApiKeyWithAudit`；`source=key_provision`。

### 5. 吊销 / 删除密钥（`key_revoked` / `key_deleted`）

- 管理端 PATCH 将状态置为 `revoked` 时写 `key_revoked`；`DELETE` 密钥前写 `key_deleted`（`admin_keys` / `admin_user_key`）。

### 6. 管理端 PATCH 用户 / 密钥（`admin_adjust`）

- [packages/admin/lib/services/admin/users-service.ts](../../packages/admin/lib/services/admin/users-service.ts)
- [packages/admin/lib/services/admin/keys-service.ts](../../packages/admin/lib/services/admin/keys-service.ts)

### 7. 用户物理删除（`user_deleted`）

- 删除前写入；随后 `users` 行删除，`user_audit_logs.user_id` 由外键置为 `NULL`，历史行仍保留（身份见 `before_user_snapshot` / `change_payload`）。

## 相关接口

- Admin：`GET /api/admin/budget-audit-logs`（见 [api/admin.md](../api/admin.md)）。

## 建表与迁移

- 基线：**`packages/core/migrations-{d1,postgres,mysql}/0001_baseline.sql`**（含 `user_audit_logs` 与 `idx_user_audit_reason_created`）。
