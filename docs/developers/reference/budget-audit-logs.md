# 已迁移：`user_audit_logs`

预算与密钥相关审计已统一落在表 **`user_audit_logs`**（用户维度）。完整说明见 **[user-audit-logs.md](./user-audit-logs.md)**。

- **管理 API**（路径名历史保留）：`GET {GATEWAY_MASTER_URL}/api/admin/budget-audit-logs`（内部 `/admin/budget-audit-logs`）。
- **按用户**：`GET /api/admin/users/:id/audit-logs`。
