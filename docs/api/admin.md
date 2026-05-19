# 管理接口

需要 `MASTER_KEY` 认证的管理 API。

## 部署与路径（Octafuse）

- **对外 URL**：`{GATEWAY_MASTER_URL}/api/admin/...`（Admin Pages 根 URL；外部集成方约定使用同名环境变量。例如创建 Key：`POST .../api/admin/keys`）。由 **Admin Pages**（`packages/admin`）提供，**Proxy Worker 不提供 `/admin`**。
- **本文档中的路径**：一律指内部 Hono 挂载路径 **`/admin/...`**（与实现代码一致）；集成时请将前缀换成 **`/api/admin`**。

## 认证

所有管理接口需要在请求头中携带 `Authorization: Bearer <MASTER_KEY>`。

```bash
Authorization: Bearer sk-admin-xxx
```

`MASTER_KEY` 的权威来源是当前 Admin 所连数据库的 **`system_config`** 表（键名 `MASTER_KEY`）：表结构见各引擎迁移 **`packages/core/migrations-{d1,postgres,mysql}/0001_baseline.sql`**；开发默认值在 **`packages/core/migrations-d1/0002_seed.sql`**（D1 种子；Postgres/MySQL 亦有对应 **`0002_seed.sql`**，幂等 upsert，占位 `sk-dev-admin-key`）。生产环境应在本 **Admin** 应用的 Config 页面或 SQL 将 `MASTER_KEY` 改为强随机密钥；与本地 `.env*`、Worker Secret 等 **无绑定**，`requireMasterKey` 只与库中该键的值比对。

## 时间与时区约定

- **存储**：数据库内部统一使用 UTC（D1 `datetime('now')` / ISO UTC）。
- **返回**：API 所有时间字段统一返回 **ISO 8601 UTC（带 `Z`）**。
- **业务日界**：按 `system_config.BUSINESS_TIMEZONE` 计算（默认 `UTC`），用于 Admin 仪表盘等“今日”统计。
- **计费币种**：`system_config.BILLING_CURRENCY` 仅允许 **`USD`** 或 **`CNY`**（各库的 **`0002_seed.sql`** 默认 `USD`），与 `pricing_profile` / Key 预算数值单位一致；`GET /v1/me` 返回 `billing_currency`（见用户接口文档）。**`PUT /admin/config`** 写入该键时由服务端白名单校验。
- **Proxy 错误告警（可选）**：`ALERT_WEBHOOK_WECOM_URL`、`ALERT_WEBHOOK_FEISHU_URL` 存**完整**群机器人 Webhook URL（含 query `key` / hook id）。**未配置或值为空则不告警**。Proxy 在 **`api_key_request_logs.status = error`** 且用量写入成功后，分别向已配置的 URL 发送一条文本摘要（企业微信 `msgtype=text`、飞书 `msg_type=text`）；发送失败只打日志，不影响请求。键名常量见 `@octafuse/core` 导出 `ALERT_WEBHOOK_WECOM_URL_KEY` / `ALERT_WEBHOOK_FEISHU_URL_KEY`。

### `/admin/keys` 统一响应格式

所有 **`/admin/keys`** 与 **`/admin/keys/:id`**、**`/admin/keys/:id/logs`** 的 JSON 响应使用同一信封：

- 成功：`{ "success": true, "data": ... }`，部分接口另有 `message`、`total`、`page`、`page_size` 等字段。
- 失败：`{ "success": false, "message": "..." }`，HTTP 状态码 4xx/5xx。

若 **`Authorization` 缺失或与 `system_config` 中 `MASTER_KEY` 不一致**，在到达上述处理函数前由 `requireMasterKey` 返回 **`{ "error": "Unauthorized" }`**（401），不使用 `success` 信封。

---

## Admin API 矩阵 {#admin-api-matrix}

逻辑分层：**Catalog**（供应商 → 模型 → 模型路由）、**Tenancy / Billing**（用户 / Key、`system_config` 中的配额相关项）、**Observability**（全站日志、按 Key 日志、分析聚合）。下列为 **Admin 应用** 对外 **`/api/admin/*`**（内部 **`/admin/*`**）的路径与主要数据表；**消费者**指典型调用方（均需有效 `MASTER_KEY`，Bearer 与库内 `MASTER_KEY` 一致）。

| 路径 | 方法 | 主表 / 数据源 | 消费者 |
|------|------|----------------|--------|
| `/admin/users` | GET, POST | `users`（分页列表 / 按外部对幂等创建） | Admin UI、外部集成方 |
| `/admin/users/:id` | GET, PATCH, DELETE | `users`（`:id` 为 uuid 或 `ext:…` 外部路由，见下节） | Admin UI、外部集成方 |
| `/admin/users/:id/keys` | GET, POST | `api_keys`（用户范围内） | Admin UI |
| `/admin/users/:id/keys/:keyId` | PATCH, DELETE | `api_keys` | Admin UI |
| `/admin/users/:id/logs` | GET | `api_key_request_logs`（按 `user_id`） | Admin UI |
| `/admin/users/:id/audit-logs` | GET | `user_audit_logs`（按 `user_id`） | Admin UI |
| `/admin/keys` | GET | `api_keys` **JOIN** `users`（分页列表；预算只读） | Admin UI、外部集成方 |
| `/admin/keys` | POST | `api_keys`（+ 可能 `users`） | 外部集成方、运维脚本 |
| `/admin/keys/:id` | GET | `api_keys` **JOIN** `users` | 外部集成方、Admin UI |
| `/admin/keys/:id` | PATCH, DELETE | `api_keys` | Admin UI、外部集成方 |
| `/admin/keys/:id/logs` | GET | `api_key_request_logs`（Key 范围，分页） | 外部集成方、Admin UI |
| `/admin/providers` | GET, POST, GET/PATCH/DELETE `/:id` | `providers` | Admin UI |
| `/admin/providers/import/catalog` | GET | 内置 Provider 模板摘要（无密钥） | Admin UI |
| `/admin/providers/import` | POST | 请求体 `{"ids":["…"]}`：按模板创建 `providers`（**同 id 不覆盖**；写入占位 API Key，需后续 PATCH） | Admin UI、运维脚本 |
| `/admin/models` | GET, POST, GET/PATCH/DELETE `/:id` | `models`，`model_tags` | Admin UI |
| `/admin/models/import/catalog` | GET | 内置静态目录可选项摘要（不含完整 `pricing_profile`） | Admin UI |
| `/admin/models/import` | POST | 请求体 `{"ids":["…"]}`：仅导入指定预设 → `models`，`model_tags`（按 `BILLING_CURRENCY` 选用 USD/CNY 价；**同 id 不覆盖**，记入 `skipped_existing`） | Admin UI、运维脚本 |
| `/admin/routes` | GET（`?model_id=&provider_id=`）, POST, GET/PATCH/DELETE `/:id` | `model_routes` | Admin UI |
| `/admin/stats` | GET | 多表聚合（含 `api_key_request_logs`、`api_keys` 等） | Admin UI |
| `/admin/config` | GET, PUT | `system_config` | Admin UI |
| `/admin/request-logs` | GET | `api_key_request_logs`（**GlobalLogs**，多条件筛选分页） | Admin UI |
| `/admin/budget-audit-logs` | GET | **`user_audit_logs`**（左联 **`users`** 取 `email` 等，多维筛选分页） | Admin UI |
| `/admin/analytics/models` | GET | `api_key_request_logs`，可选联 `model_tags` | Admin UI |
| `/admin/analytics/users` | GET | `api_key_request_logs`，左联 **`users`**（用户维度） | Admin UI |
| `/admin/analytics/reliability` | GET | `api_key_request_logs` | Admin UI |

说明：**GlobalLogs**（`/admin/request-logs`）与 **KeyScopedLogs**（`/admin/keys/:id/logs`）互补；**UserScopedLogs**（`/admin/users/:id/logs`）按 `user_id` 拉全量请求历史。**全局审计列表**（`/admin/budget-audit-logs`，表为 **`user_audit_logs`**）记录预算与用户/密钥生命周期事件，与请求日志正交。各类审计行何时产生（含高频 `usage_charge`）见 [`../reference/user-audit-logs.md`](../reference/user-audit-logs.md)。**数据模型总览**见 [`../architecture/user-keys-data-model.md`](../architecture/user-keys-data-model.md)。

---

## Users（`/admin/users`）

`:id` 路径参数支持：

- 网关 **`users.id`**（UUID）；
- 或 **`ext:`** 前缀的外部身份路由（与 `parseAdminUserRouteId` 一致）：
  - **`ext:<urlencode(system)>/<urlencode(external_user_id)>`**（`/` 分隔）；
  - 或 **`ext:<urlencode(system)>\u001F<urlencode(external_user_id)>`**（ASCII **0x1F** 单元分隔符；**推荐**，避免 `external_system` 本身含 `/` 时与分隔符混淆）。

### `GET /admin/users`

分页列出用户；查询参数：

| 参数 | 说明 |
|------|------|
| `page` / `page_size` | 分页，默认 `1` / `20`，`page_size` 最大 `100` |
| `email` | 可选，模糊匹配 `users.email` |
| `external_system` / `external_user_id` | 可选，精确匹配外部对 |
| `max_budget` | 可选：`positive` \| `zero_or_negative` \| `null` |
| `status` | 可选，精确匹配 `users.status` |
| `sort` | 可选，白名单：`budget_spent` \| `budget_reset_at` \| `created_at`；默认 `created_at` |
| `order` | 可选：`asc` \| `desc`；默认 `desc`。与 `sort` 均在服务端 `ORDER BY`（分页全局有效） |

非法 `sort` 或 `order` 返回 **`400`**，body 含 `message`（例如 `Invalid sort; allowed: budget_spent, budget_reset_at, created_at`）。

`budget_reset_at` 排序时 NULL 规则：`asc` → `NULLS LAST`，`desc` → `NULLS FIRST`（与 Keys 列表一致）。

响应：`{ success, data: [...], total, page, page_size }`；列表行含 **`active_keys_count`** 等（与实现 `AdminUserListItem` 对齐）。

### `POST /admin/users`

按 **`(external_system, external_user_id)`** 幂等创建（若已存在则返回已有用户）；无外部对时每次新建随机 uuid 用户。请求体至少含 **`email`**；可选 `budget_max`、`budget_base`、`budget_period`、`metadata` 等（与 `AdminUserCreateInput` 对齐）。外部对须同空或同非空。

### `GET /admin/users/:id`

用户详情（`getUserInfo`：含预算列、外部身份等；周期型预算可能触发懒重置）。**不含**密钥列表；枚举密钥请用 **`GET /admin/users/:id/keys`**。用户列表行（`GET /admin/users`）含 **`active_keys_count`**。

### `PATCH /admin/users/:id`

更新邮箱、预算计划、`status`、`metadata`（合并或 `metadata_replace`）、外部身份对等。**密钥级字段不可在此修改**。

### `DELETE /admin/users/:id`

物理删除用户；**级联删除**其 **`api_keys`**。`user_audit_logs.user_id` 按迁移为 **`ON DELETE SET NULL`**，历史审计保留。

### `GET /admin/users/:id/keys` / `POST /admin/users/:id/keys`

列出或在该用户下新建密钥（`POST` 体：`name`、`metadata`、`reason` 等）。响应与全局 `POST /admin/keys` 一致（返回明文 `key` 一次）。

### `PATCH /admin/users/:id/keys/:keyId` / `DELETE ...`

与全局 **`PATCH/DELETE /admin/keys/:id`** 语义一致，但限定密钥属于该用户。

### `GET /admin/users/:id/logs`

分页返回该 **`user_id`** 的 `api_key_request_logs`（可选 `status`）。

### `GET /admin/users/:id/audit-logs`

分页返回该用户的 **`user_audit_logs`**（仅 `user_id` 范围）。

---

## 列出 API Keys

分页列出 Key；预算与邮箱来自 **`JOIN users`**（只读）。支持按 **`users.email`** 模糊筛选与 **`user_id`** 精确筛选。

### 请求

```
GET /admin/keys?page=1&page_size=20&email=&user_id=
```

### 查询参数

| 参数 | 说明 |
|------|------|
| `page` | 页码，默认 `1` |
| `page_size` | 每页条数，默认 `20`，最大 `100` |
| `email` | 可选，对 **`users.email`** 模糊匹配（响应字段仍为 `user_email`） |
| `user_id` | 可选，精确匹配 `api_keys.user_id` |

### 响应

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "key": "sk-...",
      "user_id": "string",
      "user_email": "user@example.com",
      "budget_max": 100,
      "budget_base": 100,
      "budget_spent": 0,
      "budget_period": "monthly",
      "budget_reset_at": "2024-02-01T00:00:00.000Z",
      "status": "active",
      "metadata": null,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "total": 120,
  "page": 1,
  "page_size": 20
}
```

---

## 创建 API Key

每次调用在 `api_keys` 中 **新建一行**（同一用户可有多把 **active** 密钥）。预算与邮箱在 **`users`** 表上维护，请使用 **`PATCH /admin/users/:id`**，**不要**在创建或更新 Key 的请求体中携带预算或 `user_email` 字段。

### 请求

```
POST /admin/keys
```

### 请求体（二选一关联用户）

**路径 A — 已有网关用户**

| 字段 | 必填 | 说明 |
|------|------|------|
| `user_id` | 是 | 网关 `users.id`（须已存在） |
| `name` | 否 | 密钥显示名 |
| `metadata` | 否 | JSON **对象**或可解析为对象的 JSON **字符串**；写入该 Key 行 |
| `reason` | 否 | 写入本次新建密钥的 `key_created` 审计 `reason_text` |

**路径 B — 按外部身份匹配或创建用户后再建密钥**

| 字段 | 必填 | 说明 |
|------|------|------|
| `external_system` | 是 | 与 `external_user_id` 成对；上游产品 / 租户标识 |
| `external_user_id` | 是 | 上游用户标识 |
| `email` | 是 | **新建**用户时写入 `users.email`；若外部对已存在则 **不会**用本次 email 覆盖库中已有邮箱 |
| `name` | 否 | 密钥显示名 |
| `metadata` | 否 | 同上 |
| `reason` | 否 | 同上 |

路径 B 新建用户时，服务端为该用户写入默认预算：`budget_max = 0`、`budget_period = none` 等；后续请在 **Users** 管理接口中调整计划。

`user_id` 与「`external_system` + `external_user_id`」不得混用为不完整组合（例如仅 `external_system` 无 `external_user_id` 会 **400**）。

### 审计 `reason`（POST）

仅当本次在库中 **新建** `api_keys` 行时，`reason`（若提供）进入对应 `key_created` 审计的 `reason_text`。

### 响应

```json
{
  "success": true,
  "message": "Key created successfully",
  "data": {
    "key": "sk-xxx...",
    "key_id": "uuid",
    "user_id": "string"
  }
}
```

> **明文 `key`** 仅在本次响应中返回完整值；客户端须立即保存。列表与详情接口中的 `key` 为掩码或存储形态，不应依赖再次取回明文。

### 示例（已有用户）

```bash
curl -X POST http://localhost:8787/admin/keys \
  -H "Authorization: Bearer sk-admin-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "integration-ci",
    "metadata": {"env":"staging"},
    "reason": "provision-from-billing"
  }'
```

### 示例（外部身份）

```bash
curl -X POST http://localhost:8787/admin/keys \
  -H "Authorization: Bearer sk-admin-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "external_system": "my-saas",
    "external_user_id": "acct_123",
    "email": "user@example.com",
    "name": "default-key"
  }'
```

### 在指定用户下创建（Admin UI 常用）

当已掌握 `users.id` 时，也可调用子资源（用户由路径解析，请求体无需再传 `user_id`）：

```
POST /admin/users/:id/keys
```

请求体仅支持：`name`、`metadata`（对象或 JSON 字符串）、`reason`（可选）。响应信封与 `POST /admin/keys` 相同（`data.key`、`data.key_id` 等）。

---

## 更新 API Key（名称 / 状态 / metadata）

**不支持**在 `PATCH /admin/keys/:id` 上修改预算、`user_email` 等用户级字段；若传入 `budget_max`、`budget_base`、`budget_spent`、`budget_period`、`reset_budget`、`budget_reset_at`、`user_email` 等，服务端返回 **400**（提示改用 **`PATCH /admin/users/:id`**）。

### 请求

```
PATCH /admin/keys/:id
```

### 路径参数

| 参数 | 描述 |
|------|------|
| `id` | API Key ID (UUID) 或完整的 API Key (`sk-…`) |

### 请求体

至少提供以下字段之一：

```json
{
  "name": "new-label",
  "status": "revoked",
  "metadata": { "plan": "pro" },
  "metadata_replace": "{\"plan\":\"pro\"}",
  "reason": "Admin update"
}
```

| 字段 | 说明 |
|------|------|
| `name` | 可选；字符串或 `null` 清空显示名 |
| `status` | 可选；如 `active`、`revoked` |
| `metadata` | 可选；**对象**时与现有 key `metadata` **合并**；**字符串**时视为整段替换（与 `metadata_replace` 语义相同） |
| `metadata_replace` | 可选；JSON 字符串，整段替换 metadata；勿与对象形式的 `metadata` 同时使用 |
| `reason` | 可选；写入用户审计等文案，缺省由服务端默认 |

### 响应

`data` 为更新后的密钥关联信息摘要（含从用户 JOIN 的只读预算字段等），字段与实现 `updateAdminKey` 返回一致。

### 示例

```bash
curl -X PATCH http://localhost:8787/admin/keys/uuid-here \
  -H "Authorization: Bearer sk-admin-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "rotated-label",
    "status": "active",
    "reason": "gwui:reactivate"
  }'
```

---

## 获取 Key 详情

根据 Key ID 或 Key 本身获取详细信息。

### 请求

```
GET /admin/keys/:id
```

### 路径参数

| 参数 | 描述 |
|------|------|
| `id` | API Key ID (UUID) 或完整的 API Key (sk-xxx 格式) |

### 响应

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "key": "sk-xxx...",
    "user_id": "string",
    "user_email": "user@example.com",
    "budget_max": 100.00,
    "budget_base": 100.00,
    "budget_spent": 15.50,
    "budget_period": "monthly",
    "budget_reset_at": "2024-02-01T00:00:00.000Z",
    "status": "active",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-20T14:22:00.000Z",
    "spend": 15.50,
    "max_budget": 100.00
  }
}
```

> 注：`spend` 和 `max_budget` 字段用于兼容 LiteLLM 格式；`metadata` 在 `data` 内为解析后的对象（非法 JSON 时可能为 `null` / 省略）。

### 示例

```bash
curl http://localhost:8787/admin/keys/uuid-here \
  -H "Authorization: Bearer sk-admin-xxx"
```

---

## 删除 Key

从数据库物理删除该 **`api_keys`** 行。`user_audit_logs.api_key_id` 外键为 **`ON DELETE SET NULL`**（审计行保留，密钥引用清空）。`api_key_request_logs` 仍可能保留 `api_key_id` 引用（无 FK 或 `SET NULL`，依迁移）。吊销请优先使用 `PATCH` 将 `status` 设为 `revoked`。

### 请求

```
DELETE /admin/keys/:id
```

### 路径参数

| 参数 | 描述 |
|------|------|
| `id` | API Key ID (UUID) 或完整的 API Key (sk-xxx 格式) |

### 响应

成功：
```json
{
  "success": true,
  "message": "Key deleted successfully"
}
```

失败（Key 不存在）：
```json
{
  "success": false,
  "message": "Key not found"
}
```

### 示例

```bash
curl -X DELETE http://localhost:8787/admin/keys/uuid-here \
  -H "Authorization: Bearer sk-admin-xxx"
```

---

## 获取 Key 请求日志

获取指定 Key 的请求日志，支持分页和状态过滤。

### 请求

```
GET /admin/keys/:id/logs?page=1&page_size=20&exclude_status=incomplete
```

### 路径参数

| 参数 | 描述 |
|------|------|
| `id` | API Key ID (UUID) 或完整的 API Key (sk-xxx 格式) |

### 查询参数

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `page` | integer | 1 | 页码，从 1 开始 |
| `page_size` | integer | 20 | 每页数量，最大 100 |
| `exclude_status` | string | - | 排除指定状态的日志（如 `incomplete`） |

### 响应

日志行结构与 D1 `api_key_request_logs` 一致（节选常用字段）；`data` 为当前页的日志数组。

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "api_key_id": "key-uuid",
      "user_email": "user@example.com",
      "model_id": "glm-4",
      "provider_id": "zhipu",
      "request_protocol": "openai",
      "upstream_protocol": "openai",
      "input_tokens": 150,
      "output_tokens": 320,
      "cache_read_tokens": 0,
      "cache_write_tokens": 0,
      "reasoning_tokens": 0,
      "total_tokens": 470,
      "metered_cost": 0.0045,
      "standard_cost": 0.0045,
      "charged_cost": 0.0045,
      "route_group": "default",
      "status": "success",
      "latency_ms": 1250,
      "error_message": null,
      "raw_usage": "{\"prompt_tokens\":150,\"completion_tokens\":320}",
      "created_at": "2024-01-20T14:22:00.000Z"
    }
  ],
  "total": 156,
  "page": 1,
  "page_size": 20
}
```

> 注：`metered_cost` 为按 route **`price_override.metered`**（若存在）否则 `models.pricing_profile` 计算的供应成本；`standard_cost` 为按模型目录 `pricing_profile` 计算的标准成本；`charged_cost` 为计入用户预算的金额：按路由 **`price_override.charged`**（若存在）否则 **`models.pricing_profile`** 阶梯计价。**`pricing_audit`** 新写入为 **v3**（见 `packages/core/src/db/pricing-audit.ts`：`snapshot.user_charge` 含 `source: route_nested | model`）。**`request_protocol`** 为客户端调用的 Gateway 入口协议；**`upstream_protocol`** 为本次请求所选路由的 `model_routes.upstream_protocol` 快照。相对目录标准价的倍率保存在路由 **`price_override`** 的 **`charged_factor`** / **`metered_factor`**（不参与上述三金额公式）。历史字段 `total_cost` 与 **`billing_factor`** 列已移除。列表接口返回列为 `api_key_request_logs` 全字段（与 `packages/core/src/types.ts` 中 `RequestLogRow` 一致）。

### 示例

```bash
curl "http://localhost:8787/admin/keys/uuid-here/logs?page=1&page_size=10" \
  -H "Authorization: Bearer sk-admin-xxx"
```

面向用户的「有活跃路由的模型」列表见 **`GET /v1/models`**（用户 Key）。

**管理端基础数据**（`Authorization: Bearer <MASTER_KEY>`，响应多为 `{ success, data, count? }`）：**`/admin/keys`**（上文）与 **`/admin/providers`**、**`/admin/models`**（含 **`GET /admin/models/import/catalog`** 与 **`POST /admin/models/import`**）、**`/admin/routes`**（REST：`GET/POST` 集合，`GET/PATCH/DELETE /:id`；路由列表支持 `GET /admin/routes?model_id=&provider_id=`）。**`POST /admin/routes`** 省略或空白 **`route_group`** 时写入 **`default`**；**`PATCH`** 若包含 **`route_group`** 则不得为仅空白字符串（否则 **400** `route_group cannot be empty`）。

### `GET /admin/models/import/catalog`

- **行为**：返回 `packages/admin/lib/model-presets/*.json`（合并后）每条预设的摘要（`id`、`display_name`、`vendor`、`context_window`、`max_tokens`、`supports_images`、`tier_count_usd`），供管理端勾选后再调用 **`POST /admin/models/import`**。

### `POST /admin/models/import`

- **请求体**：`{ "ids": ["glm-5", "gpt-5.2", ...] }`（**必填**；`ids` 须为非空字符串数组；重复 id 会去重；顺序保留）。
- **行为**：仅处理 `ids` 中在静态目录存在的 id；根据当前 **`BILLING_CURRENCY`**（`USD` → `usd` 分支，`CNY` → `cny` 分支；库内为其他历史值时按 **`USD`** 分支取价）写入 `models.pricing_profile`；**已存在同 `id` 的不导入、不覆盖**，该 id 记入 **`skipped_existing`**；否则 **INSERT** 新建并写入 `model_tags`。未知 id 或校验失败记入 **`failed`**，其余仍处理。
- **响应** `data`：`{ "billing_currency_used", "created", "updated"（恒为 0）, "skipped_existing": string[], "failed": [{ "id", "message" }] }`。

### `pricing_profile` 契约（`/admin/models`、`/admin/routes`）

- **存储位置**：`models.pricing_profile`（模型标准价，TEXT JSON）；`model_routes.price_override` 内短键 **`metered`**（供应侧覆盖，参与 `metered_cost`）、**`charged`**（用户预算侧覆盖，参与 `charged_cost`）；二者均为与目录相同的 canonical **`{ tiers }`** 契约。另可含 **`charged_factor`** / **`metered_factor`**（非负数字，相对目录标准价的备忘/展示；**不参与**运行时金额乘法）。**新建或更新路由时 API 要求** `price_override` 同时包含合法且非空的 **`metered`** 与 **`charged`**（各至少一档）；不得仅依赖“空则继承目录”省略写入。
- **Canonical 形状**（保存与管理 UI 输出）：仅包含 **`tiers`** 数组。非末档：`upto` 为有限数字 **≥ 0**（输入 token 上界，含端点）。**末档 `upto` 为 JSON `null`**，表示开放上界（无限）。每档另含 `label`（可 `null`）、`input_price`、`output_price`（$/1M），以及可选的 `cache_read_price` / `cache_write_price`（数字或 `null`）。**固定价** = 单档（末档 `upto: null`）；**阶梯价** = 多档；选档 basis 运行时固定为 **input_tokens**（与 `packages/core/src/db/pricing-profile.ts` 一致）。
- **公开列表**：`GET /v1/models` 返回完整 `pricing_profile` 字符串；`model_info.input_price` / `output_price` 为 **兼容展示**：取各档中 **最低 `input_price`** 所在档的 in/out（新客户端应解析 `tiers`）。详见 [user.md「获取模型列表」](user.md)。

#### Gateway Admin UI — Model Routes「Billing & Cost」

与 Proxy 侧 `usage-tracker` 一致（`packages/proxy/src/services/usage-tracker.ts` + `packages/core/src/db/pricing-profile.ts`）：

| 区块 | 含义 | 数据来源 |
|------|------|----------|
| **Standard price** | 目录标准价（只读） | 所选模型的 `models.pricing_profile`，展示**全部 tiers**（按 `input_tokens` 选档与运行时一致） |
| **User cost** | 用户扣费 | 保存为 **`charged`**（**必填**，至少一档）；运行时 **`charged_cost`** 使用该 profile |
| **Gateway cost** | 供应侧 metered | 保存为 **`metered`**（**必填**，至少一档）；运行时 **`metered_cost`** 使用该 profile |
| **Charged factor** | 相对目录标准价的用户侧倍率（备忘/展示） | 保存为 **`price_override.charged_factor`**（可选）；与 **`charged`** tiers 独立 |
| **Metered factor** | 相对目录标准价的供应侧倍率（备忘/展示） | 保存为 **`price_override.metered_factor`**（可选；缺省展示可回退 **`provider_factor`**） |
| **Provider factor** | 管理端辅助 | 仅用于「把目录各档乘系数写入 **metered** tiers」并通常与 **`metered_factor`** 同步写入；**单独保存 `provider_factor` 不会参与 `metered_cost`**，除非同时写入了合法 **`metered`** tiers |

路由列表卡片：在 **Metered override** / **Charged** 摘要旁展示 **`Ch ×`** / **`M ×`**（来自 `charged_factor` / `metered_factor`）。若 `price_override` 缺少 **`metered`** / **`charged`** 任一侧，保存会被 API 拒绝。实现见 `packages/admin/lib/pricing-ui.ts` 的 `getRoutePriceOverrideCardHint` 与 `parseChargedFactorFromPriceOverride` / `parseMeteredFactorFromPriceOverride`。

---

## 仪表盘与聚合（`/admin/stats`、`/admin/config`、…） {#admindashboard}

与 **`/admin/keys`** 相同，全程 **`Authorization: Bearer <MASTER_KEY>`**。成功响应一般为 `{ "success": true, ... }`；校验失败多为 `{ "success": false, "message": "..." }`。若未带有效 Master Key，中间件返回 **`{ "error": "Unauthorized" }`**（401）。

### `GET /admin/stats`

查询参数：

| 参数 | 说明 |
|------|------|
| `range` | `24h` / `7d` / `30d`，默认 `7d`；用于 `data.kpi` 的时间窗（`shared.rangeToDates`） |

响应 `data` 含：`gateway`（活跃 Key 数、当日请求数/费用/错误率）、`kpi`（时间窗内总请求、成功率、`totalCost`、`meteredCost`、`standardCost`、`activeUsers`、错误率）、`recentLogs`、`recentErrors`。

### `GET /admin/config`

返回 `system_config` 全表：`{ success, data: [{ key, value, description }, ...] }`。

### `PUT /admin/config`

请求体：`{ "key": "string", "value": "string" }`（`key` 必填；`value` 可省略或 `null` 视为空字符串）。

- **`BILLING_CURRENCY`**：仅允许写入 **`USD`** 或 **`CNY`**（大写）；否则返回 `400` 与 `success: false`。

与 **Proxy 错误 Webhook** 相关的键（默认不存在于种子数据，按需 `PUT` 写入即可）：

| `key` | 说明 |
|-------|------|
| `ALERT_WEBHOOK_WECOM_URL` | 企业微信群机器人 Webhook 完整 URL；非空则在该渠道告警。清空 `value` 可关闭。 |
| `ALERT_WEBHOOK_FEISHU_URL` | 飞书自定义机器人 Webhook 完整 URL；非空则在该渠道告警。清空 `value` 可关闭。 |

### `GET /admin/request-logs`

全库 `api_key_request_logs` 筛选分页（与按 Key 的 `/admin/keys/:id/logs` 互补）。

| 查询参数 | 说明 |
|----------|------|
| `page` | 默认 `1` |
| `page_size` | 默认 `20`，最大 `100` |
| `api_key_id` | 精确匹配 |
| `user_email` | 精确匹配 |
| `model_id` | 精确匹配 |
| `route_group` | 精确匹配 |
| `status` | 精确匹配 |
| `start_date` / `end_date` | 过滤 `created_at`（UTC，格式：`YYYY-MM-DD HH:mm:ss`） |

`data` 每条日志即 **`api_key_request_logs` 行**（读接口不 JOIN `models` / `providers`；展示名依赖写入时快照列）。**`model_name`** / **`provider_name`** 为请求当时展示名快照；**`provider_model_name`** 为上游模型 id；**`request_body`** 为客户端入口侧脱敏 JSON（无提示词正文；长度有上限）。**`upstream_request_body`** 为合并路由 `custom_params` 后、与发往供应商的 wire 体结构对齐的脱敏快照（规则同 `request_body`；迁移前或旧行可能为 `null`）。**`request_protocol`**（入口）与 **`upstream_protocol`**（所选路由实际转发协议）见上文注。升级前列可能为 `null`。

### `GET /admin/budget-audit-logs`

全库 **`user_audit_logs`** 筛选分页；左联 **`users`** 以返回用户 **`email`**（并支持按邮箱精确筛选）。路径名含 “budget” 为历史兼容，数据源已为用户级审计表。

| 查询参数 | 说明 |
|----------|------|
| `page` | 默认 `1` |
| `page_size` | 默认 `20`，最大 `100` |
| `user_id` | 精确匹配 `user_audit_logs.user_id` |
| `api_key_id` | 精确匹配 |
| `user_email` | 精确匹配（**`users.email`**，来自 JOIN） |
| `event_type` | 精确匹配（如 `usage_charge`、`period_reset`、`admin_adjust`、`key_created`、`key_revoked`、`key_deleted`、`user_created`、`user_deleted`） |
| `actor_type` | 精确匹配：`system` \| `admin` \| `service` |
| `reason_code` / `source` / `correlation_id` | 可选，精确匹配 |
| `start_date` / `end_date` | 与 **`GET /admin/request-logs`** 相同：过滤 `created_at`（`>=` / `<=`，UTC；建议格式 `YYYY-MM-DD HH:mm:ss` 或完整 ISO） |

`data` 每条为审计表列 + 来自 **`users`** 的 **`user_email`**（无关联用户时可能为 `null`）。详细语义见 [`../reference/user-audit-logs.md`](../reference/user-audit-logs.md)。

### `GET /admin/analytics/models`

| 查询参数 | 说明 |
|----------|------|
| `start_date` / `end_date` | 可选；默认约最近 7 天；开始时间最早不早于结束时间前 **180 天**（`clampAnalyticsRange`） |
| `tag` | 可选；非空时只统计带该 `model_tags.tag` 的模型 |

响应：`{ success, data: [...], tags: string[] }`（`tags` 为库内全部 distinct 标签，供筛选 UI）。

### `GET /admin/analytics/users`

| 查询参数 | 说明 |
|----------|------|
| `start_date` / `end_date` | 同上 |
| `email` | 可选，`user_email` **模糊**匹配（`LIKE %...%`） |

### `GET /admin/analytics/reliability`

| 查询参数 | 说明 |
|----------|------|
| `start_date` / `end_date` | 同上 |

响应 `data`：`providers`（按 `provider_id`）、`modelProviders`（按 `model_id` + `provider_id`）、`recentErrors`。
