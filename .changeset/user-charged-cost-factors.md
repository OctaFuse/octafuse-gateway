---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/tool-engines": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

为用户增加按目录模型维护的用户计费倍率，在路由用户计费算完后再乘。

### Proxy

**用户计费倍率**：LLM / Images / Audio 在路由 Charged cost 之后再乘 `users.charged_cost_factors[models.id]`；只改最终 `charged_cost` 与预算累加，供应成本与目录标准价不变。智能体工具不应用。Images / Audio 预检与实扣使用同一最终金额。`pricing_audit` v4 可带 `user_charged_factor`（未命中为 `null`）。

### Admin

**Charged cost factors**：`POST` / `PATCH /api/admin/users` 可写入 `{ "<models.id>": number }`；未知模型 ID、负数拒绝。用户详情页按模型 ID 增删行，随计划一并保存；仅改该字段时审计 `reason_code` 为 `admin_patch_charged_cost_factors`。

### Core

**`users.charged_cost_factors`**：D1 / Postgres / MySQL 同步迁移 `0026_user_charged_cost_factors.sql`。鉴权 JOIN 带上该列，请求路径不再额外查用户。

### 升级说明

部署后对三个数据面执行迁移 `0026_user_charged_cost_factors.sql`。未配置该列的用户计费行为与升级前一致。
