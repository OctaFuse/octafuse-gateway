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
- **查询**：`start_date` / `end_date` 等过滤参数为 **UTC** `YYYY-MM-DD HH:mm:ss`（与 DB `created_at` 直接比较）。
- **Admin 显示与自定义时间窗输入**：按 `system_config.BUSINESS_TIMEZONE`（默认 `UTC`；如 `Asia/Shanghai`）墙钟展示与输入，Apply 后转为 UTC 查询；与浏览器本地时区无关。
- **业务日界**：同样按 `BUSINESS_TIMEZONE` 计算「今日」边界，用于 Admin 仪表盘等 KPI。
- **读取业务时区**：`GET /admin/business-timezone` → `{ "success": true, "data": { "business_timezone": "Asia/Shanghai" } }`（需 `MASTER_KEY` 或 Admin 会话）。
- **计费币种**：`system_config.BILLING_CURRENCY` 仅允许 **`USD`** 或 **`CNY`**（各库的 **`0002_seed.sql`** 默认 `USD`），与 `pricing_profile` / Key 预算数值单位一致；`GET /v1/me` 返回 `billing_currency`（见用户接口文档）。**`PUT /admin/config`** 写入该键时由服务端白名单校验。
- **Proxy 错误告警（可选）**：`ALERT_WEBHOOK_WECOM_URL`、`ALERT_WEBHOOK_FEISHU_URL` 存**完整**群机器人 Webhook URL（含 query `key` / hook id）。**未配置或值为空则不告警**。Proxy 在 **`api_key_request_logs.status = error`** 且用量写入成功后，分别向已配置的 URL 发送一条**按错误类型归类**的文本摘要（企业微信 `msgtype=text`、飞书 `msg_type=text`）：首行含类别与优先级（如上游超时、供应商鉴权、限流、5xx、敏感内容拦截、请求/模型错误、路由配置），并分组展示影响用户、路由/协议、供应商 key、原始 `error_message`、处理建议与发生时间（UTC+8）；发送失败只打日志，不影响请求。键名常量见 `@octafuse/core` 导出 `ALERT_WEBHOOK_WECOM_URL_KEY` / `ALERT_WEBHOOK_FEISHU_URL_KEY`。

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
| `/admin/users/:id/budget/transition/preview` | POST | `users`（只读计算） | 外部集成方 |
| `/admin/users/:id/budget/transition` | POST | `users` + `user_audit_logs`（原子转换） | 外部集成方 |
| `/admin/keys` | GET | `api_keys` **JOIN** `users`（分页列表；预算只读） | Admin UI、外部集成方 |
| `/admin/keys` | POST | `api_keys`（+ 可能 `users`） | 外部集成方、运维脚本 |
| `/admin/keys/:id` | GET | `api_keys` **JOIN** `users` | 外部集成方、Admin UI |
| `/admin/keys/:id` | PATCH, DELETE | `api_keys` | Admin UI、外部集成方 |
| `/admin/keys/:id/logs` | GET | `api_key_request_logs`（Key 范围，分页） | 外部集成方、Admin UI |
| `/admin/providers` | GET, POST, GET/PATCH/DELETE `/:id` | `providers` | Admin UI |
| `/admin/providers/:id/keys` | GET, POST | `provider_api_keys`（列表脱敏 `fingerprint`） | Admin UI |
| `/admin/providers/:id/keys/:keyId` | PATCH, DELETE | `provider_api_keys` | Admin UI |
| `/admin/providers/import/catalog` | GET | 内置 Provider 模板摘要（无密钥） | Admin UI |
| `/admin/providers/import` | POST | 请求体 `{"ids":["0","1",…]}`：catalog 键（非 provider id）；每次导入新增 `providers` 行（UUID id；同名自动后缀）；不含 API Key，须在 Admin 中手动添加 | Admin UI、运维脚本 |
| `/admin/models` | GET, POST, GET/PATCH/DELETE `/:id` | `models`，`model_tags` | Admin UI |
| `/admin/models/import/catalog` | GET | 内置静态目录可选项摘要（不含完整 `pricing_profile`） | Admin UI |
| `/admin/models/import` | POST | 请求体 `{"ids":["…"]}`：仅导入指定预设 → `models`，`model_tags`（按 `BILLING_CURRENCY` 选用 USD/CNY 价；**同 id 不覆盖**，记入 `skipped_existing`） | Admin UI、运维脚本 |
| `/admin/routes` | GET（`?model_id=&provider_id=`）, POST, GET/PATCH/DELETE `/:id` | `model_routes` | Admin UI |
| `/admin/stats` | GET | 多表聚合（含 `api_key_request_logs`、`api_keys` 等） | Admin UI |
| `/admin/config` | GET, PUT | `system_config` | Admin UI |
| `/admin/business-timezone` | GET | `system_config.BUSINESS_TIMEZONE` | Admin UI（Provider 首屏加载） |
| `/admin/request-logs` | GET | `api_key_request_logs`（**GlobalLogs**，多条件筛选分页） | Admin UI |
| `/admin/budget-audit-logs` | GET | **`user_audit_logs`**（左联 **`users`** 取 `email` 等，多维筛选分页） | Admin UI |
| `/admin/analytics/models` | GET | `api_key_request_logs`，可选联 `model_tags` | Admin UI |
| `/admin/analytics/users` | GET | `api_key_request_logs`，左联 **`users`**（用户维度） | Admin UI |
| `/admin/analytics/reliability` | GET | `api_key_request_logs` | Admin UI |

说明：**GlobalLogs**（`/admin/request-logs`）与 **KeyScopedLogs**（`/admin/keys/:id/logs`）互补；**UserScopedLogs**（`/admin/users/:id/logs`）按 `user_id` 拉全量请求历史。**全局审计列表**（`/admin/budget-audit-logs`，表为 **`user_audit_logs`**）记录预算与用户/密钥生命周期事件，与请求日志正交。各类审计行何时产生（含高频 `usage_charge`）见 [`../reference/user-audit-logs.md`](../reference/user-audit-logs.md)。**数据模型总览**见 [`../architecture/user-keys-data-model.md`](../architecture/user-keys-data-model.md)。

### 与 Proxy `GET /catalog/models` 的区别 {#admin-vs-proxy-catalog}

名称里虽都有 “catalog / models”，但 **Admin 不提供** Proxy 上的公开 discovery 接口；下列三者勿混用：

| 接口 | 部署 | 鉴权 | 数据含义 |
|------|------|------|----------|
| **`GET /catalog/models`**（Proxy） | `GATEWAY_URL` | 无 | **运行时**可调用模型 + `protocols` / `protocols_by_group`（由 active `model_routes` 聚合） |
| **`GET /admin/models`** | Admin `/api/admin/*` | MASTER_KEY | 库内 **全部**模型 CRUD 列表（含 tags、路由计数；**不**含按 route 的协议聚合） |
| **`GET /admin/models/import/catalog`** | Admin | MASTER_KEY | 仓库内 **静态 preset** 摘要，供导入 UI 勾选，**非**运行时 route 真相 |

门户 / 公开站应使用 Proxy **`GET /catalog/models`**，详见 [用户接口 · 公开模型目录](./user.md#公开模型目录catalog-discovery)。Agent 与兼容客户端默认仍用 **`GET /v1/models`**（需用户 Key，默认 `default,free` route group）。

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

用于**绝对值**设置、运维修正、取消/到期回收等不依赖当前预算快照的变更。若需基于当前 `budget_max/budget_spent` 计算结转并原子写入，请使用下方 **`budget/transition`**。

### `POST /admin/users/:id/budget/transition/preview`

只读预览预算转换，不写库。请求体（`AdminBudgetTransitionInput`）：

| 字段 | 必填 | 说明 |
|------|------|------|
| `target_budget_base` | 是 | 新周期基础额度（数值，≥ 0） |
| `budget_period` | 是 | `none` \| `daily` \| `weekly` \| `monthly` |
| `budget_reset_at` | 否 | 下次重置时间（ISO UTC）；缺省按 `budget_period` 推算 |
| `carryover_strategy` | 否 | `remaining_or_overage`（默认）或 `none` |
| `reset_spent` | 否 | 是否将 `budget_spent` 归零，默认 `true` |
| `metadata` | 否 | JSON 对象，merge 进 `users.metadata`（仅 apply 时写入） |
| `reason` | 否 | 审计 `reason_text`（仅 apply 时写入） |

`remaining_or_overage` 计算：`carryover = budget_max - budget_spent`，`next_budget_max = target_budget_base + carryover`（`carryover` 可为负，表示超额抵扣）。

响应：`{ success, data: { before, after, carryover } }`，其中 `before/after` 含 `budget_max`、`budget_base`、`budget_spent`、`budget_period`、`budget_reset_at`。

### `POST /admin/users/:id/budget/transition`

原子应用上述转换并写入 `user_audit_logs`（`eventType=admin_adjust`，`reasonCode=budget_transition`）。请求体与 preview 相同（`metadata`/`reason` 在 apply 时生效）。

响应：`{ success, message, data: { transition: { before, after, carryover }, user: <getUserInfo> } }`。

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
| `sort` | 可选，白名单：`budget_spent` \| `budget_reset_at` \| `created_at`；默认 `created_at` |
| `order` | 可选：`asc` \| `desc`；默认 `desc`。与 `sort` 均在服务端 `ORDER BY`（分页全局有效） |

非法 `sort` 或 `order` 返回 **`400`**，body 含 `message`（例如 `Invalid sort; allowed: budget_spent, budget_reset_at, created_at`）。

`budget_spent` / `budget_reset_at` 排序列来自 JOIN 的 **`users`**；`created_at` 来自 **`api_keys`**。`budget_reset_at` 的 NULL 规则：`asc` → `NULLS LAST`，`desc` → `NULLS FIRST`。

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

> 注：三列成本均以 **`models.pricing_profile`** 按 `input_tokens` 选档为基数。`metered_cost` = 目录价 × `price_override.metered_factor` × 可选 `schedule.metered`；`charged_cost` = 目录价 × `charged_factor` × 可选 `schedule.charged`；`standard_cost` = 目录价（不乘路由倍率）。嵌套 `metered`/`charged` tiers **不计价**。**`pricing_audit`** 新写入为 **v4**（见 `packages/core/src/db/pricing-audit.ts`：含 `base_factor` / `schedule` / `effective_factor`）。**`request_protocol`** 为客户端调用的 Gateway 入口协议；**`upstream_protocol`** 为本次请求所选路由的 `model_routes.upstream_protocol` 快照。历史字段 `total_cost` 与 **`billing_factor`** 列已移除。列表接口返回列为 `api_key_request_logs` 全字段（与 `packages/core/src/types.ts` 中 `RequestLogRow` 一致）。

### 示例

```bash
curl "http://localhost:8787/admin/keys/uuid-here/logs?page=1&page_size=10" \
  -H "Authorization: Bearer sk-admin-xxx"
```

面向用户的「有活跃路由的模型」列表：**Agent / SDK** 用 **`GET /v1/models`**（用户 Key）；**门户 / 公开 discovery** 用 Proxy **`GET /catalog/models`**（无需 Key，含协议能力，见 [用户接口](./user.md#公开模型目录catalog-discovery)）。

**管理端基础数据**（`Authorization: Bearer <MASTER_KEY>`，响应多为 `{ success, data, count? }`）：**`/admin/keys`**（上文）与 **`/admin/providers`**（`POST` 创建时 body 仍含 **`api_key`**，服务端写入 **`provider_api_keys`** 的 `label=default` 行；`providers` 表不再存密钥。列表响应含 **`active_key_count`** / **`has_pending_key`**。含 **`GET/POST /admin/providers/:id/keys`**、**`PATCH/DELETE /admin/providers/:id/keys/:keyId`** 多 key 管理；key 列表脱敏 `fingerprint` + **`is_pending_import`**，不回显明文）、**`/admin/models`**（含 **`GET /admin/models/import/catalog`** 与 **`POST /admin/models/import`**）、**`/admin/routes`**（REST：`GET/POST` 集合，`GET/PATCH/DELETE /:id`；路由列表支持 `GET /admin/routes?model_id=&provider_id=`）。**`POST /admin/routes`** 省略或空白 **`route_group`** 时写入 **`default`**；**`PATCH`** 若包含 **`route_group`** 则不得为仅空白字符串（否则 **400** `route_group cannot be empty`）。

### `GET /admin/models/import/catalog`

- **行为**：返回 `packages/admin/lib/model-presets/*.json`（合并后）每条预设的摘要（`id`、`display_name`、`vendor`、`context_window`、`max_tokens`、`tier_count_usd`），供管理端勾选后再调用 **`POST /admin/models/import`**。

### `POST /admin/models/import`

- **请求体**：`{ "ids": ["glm-5", "gpt-5.2", ...] }`（**必填**；`ids` 须为非空字符串数组；重复 id 会去重；顺序保留）。
- **行为**：仅处理 `ids` 中在静态目录存在的 id；根据当前 **`BILLING_CURRENCY`**（`USD` → `usd` 分支，`CNY` → `cny` 分支；库内为其他历史值时按 **`USD`** 分支取价）写入 `models.pricing_profile`；**已存在同 `id` 的不导入、不覆盖**，该 id 记入 **`skipped_existing`**；否则 **INSERT** 新建并写入 `model_tags`。未知 id 或校验失败记入 **`failed`**，其余仍处理。
- **响应** `data`：`{ "billing_currency_used", "created", "updated"（恒为 0）, "skipped_existing": string[], "failed": [{ "id", "message" }] }`。

### `provider_api_keys.limit_config`（`PATCH /admin/providers/:id/keys/:keyId`）

Per-key **网关侧**软限流（进程内存；与上游供应商限额独立）。写入 `provider_api_keys.limit_config` 列（TEXT JSON）。

- **形状**：`{ "rpm": 500, "tpm": 200000, "max_concurrency": 32 }`；字段均可选，至少一个正整数才生效。
- **清空**：`null` 或空字符串 ⇒ 该 key **不限流**（列置 `NULL`）。
- **校验**：`normalizeProviderKeyLimitConfigInput`（`packages/core/src/db/provider-key-limit-config.ts`）；非法 JSON 或全无有效字段 ⇒ **400**。
- **运行时**：60s 滑动窗口 RPM/TPM + 并发 acquire/release；Workers 多 isolate 为软限制，建议设为供应商真实限额约 **90%**。详见 [proxy-request-lifecycle.md §3.3](../architecture/proxy-request-lifecycle.md#33-限流三阶段)。

### `models.sticky_config`（`PATCH /admin/models/:id`）

Opt-in **粘性 key 路由**：同一用户尽量连续命中同一把 provider key（保上游 prompt cache）。写入 `models.sticky_config` 列（TEXT JSON）。

- **形状**：

```json
{
  "ttl_seconds": 600,
  "short_wait_ms": 3000,
  "rules": {
    "openai:default": { "enabled": true },
    "openai:free": { "enabled": true, "ttl_seconds": 300, "short_wait_ms": 1000 }
  }
}
```

- **Rule 键**：`"{upstream_protocol}:{route_group}"`（协议与 group 均规范化为小写匹配；输入大小写不敏感）。
- **顶层缺省**：`ttl_seconds=600`（空闲绑定 TTL，秒）、`short_wait_ms=3000`（网关限流短等待，毫秒）；各 rule 可覆盖。
- **启用**：`rules` 中对应条目存在且 `enabled !== false`；列为 `NULL`、`rules` 无条目、或 `enabled=false` ⇒ 该「协议 × 分组」无粘性。
- **清空**：`null` 或空字符串 ⇒ 整列 `NULL`（全关）。Admin UI 删除最后一条 rule 时亦会整列清空。
- **校验**：`normalizeModelStickyConfigInput`（`packages/core/src/db/model-sticky-config.ts`）；`rules` 须至少一条合法 rule。
- **运行时**：仅 Proxy failover 路径生效（`/v1/*`）；Admin Playground **不走** sticky。详见 [proxy-request-lifecycle.md §3.5](../architecture/proxy-request-lifecycle.md#35-粘性绑定)。

### `pricing_profile` / `price_override` 契约（`/admin/models`、`/admin/routes`）

- **模型目录价**：`models.pricing_profile`（TEXT JSON，canonical `{ "tiers": [...] }`）。非末档 `upto` 为有限数字 **≥ 0**；**末档 `upto` 为 JSON `null`**（开放上界）。选档 basis 为上游 **`input_tokens`**（`packages/core/src/db/pricing-profile.ts`）。
- **路由计价（canonical）**：`model_routes.price_override` 只维护倍率，**不再**要求 nested `metered` / `charged` tiers：

```json
{
  "charged_factor": 1.2,
  "metered_factor": 1.0,
  "schedule": {
    "charged": [{ "start": "00:00", "end": "08:00", "factor": 0.5 }],
    "metered": [{ "start": "00:00", "end": "08:00", "factor": 0.5 }]
  }
}
```

  - `charged_factor` / `metered_factor`：相对目录价的基础倍率（缺省 `1`；`metered_factor` 缺失时可回退读历史 `provider_factor`）；**参与运行时**。
  - `schedule`（可选）：每日循环窗口，时区为 `system_config.BUSINESS_TIMEZONE`；半开区间 `[start, end)`，仅 `end` 可为 `24:00`；允许跨午夜；未命中 → 时段倍率 `1`。窗口在请求进入 Gateway 时锁定，长流式请求跨越边界不会切换倍率。
  - 运行时：`charged_cost` = 目录选档单价 × `charged_factor` × `schedule.charged`；`metered_cost` 同理；`standard_cost` 仅为目录价。嵌套 `metered`/`charged` tiers **写入时剥离、运行时忽略**。`pricing_audit.schedule.evaluated_at_utc` 记录本次选窗使用的请求开始时刻。
- **公开列表**：`GET /v1/models` 返回完整 `pricing_profile` 字符串；`model_info.input_price` / `output_price` 为 **兼容展示**：取各档中 **最低 `input_price`** 所在档的 in/out。详见 [user.md「获取模型列表」](user.md)。

#### Gateway Admin UI — Model Routes「Billing & Cost」

与 Proxy `usage-tracker` 一致：

| 区块 | 含义 | 数据来源 |
|------|------|----------|
| **Standard price** | 目录标准价（只读） | `models.pricing_profile` 全部 tiers |
| **Charged factor** | 用户侧基础倍率 | `price_override.charged_factor`（运行时参与 `charged_cost`） |
| **Metered factor** | 供应侧基础倍率 | `price_override.metered_factor`（运行时参与 `metered_cost`） |
| **Daily schedule** | 每日时段倍率（两侧独立） | `price_override.schedule.charged` / `.metered` |

路由列表卡片展示 **`Ch ×`** / **`M ×`**；有 schedule 时附加 **Sch** 提示。

---

## 仪表盘与聚合（`/admin/stats`、`/admin/config`、…） {#admindashboard}

与 **`/admin/keys`** 相同，全程 **`Authorization: Bearer <MASTER_KEY>`**。成功响应一般为 `{ "success": true, ... }`；校验失败多为 `{ "success": false, "message": "..." }`。若未带有效 Master Key，中间件返回 **`{ "error": "Unauthorized" }`**（401）。

### `GET /admin/stats`

查询参数：

| 参数 | 说明 |
|------|------|
| `range` | `1h` / `1d` / `24h` / `7d` / `14d` / `30d`（UI 快捷按钮；`90d` 仍可通过 API 传入）；无 `start_date`+`end_date` 时默认 `1d` |
| `start_date` / `end_date` | UTC `YYYY-MM-DD HH:mm:ss`；**与 Request Logs / Analytics 相同**；两者同时提供时优先于 `range` |

响应 `data` 含：

- **`gateway`**：活跃 Key 数、`keysTotal` / `keysActive`、`accountsTotal` / `accountsActive`、当日请求数/费用/Token/错误率
- **`kpi`**：时间窗内总请求、成功率、三档成本、`activeUsers`、错误率、Token 汇总（input/output/cache）、`avgLatencyMs`、近 60 秒近似 **`rpm`** / **`tpm`**
- **`modelDistribution`**：按 `model_id` 聚合 Top 10（请求、Token、三档成本）
- **`topUsers`**：按 `charged_cost` 排序 Top 12
- **`timeseries`**：按 `granularity`（`1h`/`1d`/`24h`→`hour`，更长→`day`）的 Token/请求/成本趋势；含 `cache_hit_rate`
- **`granularity`**：`hour` | `day`
- **`recentLogs`**、**`recentErrors`**

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

### `GET /admin/business-timezone`

返回当前 Admin 业务时区（IANA 名称，非法或未配置时服务端回落 `UTC`）：

```json
{ "success": true, "data": { "business_timezone": "Asia/Shanghai" } }
```

Admin UI 登录后由 `BusinessTimezoneProvider` 调用，用于时间列展示与时间范围自定义输入。

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

`data` 每条日志即 **`api_key_request_logs` 行**（读接口不 JOIN `models` / `providers`；展示名依赖写入时快照列）。**`model_name`** / **`provider_name`** 为请求当时展示名快照；**`provider_model_name`** 为上游模型 id；**`provider_key_id`** / **`provider_key_label`** / **`provider_key_fingerprint`** 为最终选用的 provider key 快照（迁移前旧行可能为 `null`）。**`request_body`** 为客户端入口侧脱敏 JSON（无提示词正文；长度有上限）。**`upstream_request_body`** 为合并路由 `custom_params` 后、与发往供应商的 wire 体结构对齐的脱敏快照（规则同 `request_body`；迁移前或旧行可能为 `null`）。**`request_protocol`**（入口）与 **`upstream_protocol`**（所选路由实际转发协议）见上文注。升级前列可能为 `null`。

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

`data` 每行除用量/成本/可靠性字段外，含 TTFT 聚合（来自 `api_key_request_logs.first_reasoning_token_ms` / `first_token_ms`）：

| 字段 | 说明 |
|------|------|
| `cache_read_tokens` / `cache_write_tokens` | 区间内 prompt cache 读/写 token 合计 |
| `cache_hit_rate` | 缓存命中率（%）：`cache_read_tokens / input_tokens`（`input_tokens` 已含 cache 分量） |
| `avg_first_reasoning_token_ms` | 平均 TTFT (reasoning)：请求起点 → 首个 reasoning/thinking chunk |
| `avg_first_token_ms` | 平均 TTFT (content)：请求起点 → 首个 content/tool chunk |
| `avg_effective_ttft_ms` | 有效 TTFT：`AVG(COALESCE(first_reasoning_token_ms, first_token_ms))`，用户感知首响应 |
| `avg_reasoning_phase_ms` | reasoning → content 过渡阶段平均时长（两者均非空时） |
| `reasoning_ttft_rate` | 含 reasoning TTFT 的请求占比（%） |
| `content_ttft_rate` | 含 content TTFT 的请求占比（%） |

### `GET /admin/analytics/providers`

| 查询参数 | 说明 |
|----------|------|
| `start_date` / `end_date` | 同上 |
| `tag` | 可选；非空时只统计带该 `model_tags.tag` 的模型 |
| `model_id` / `route_group` | 可选；钻取过滤 |

响应：`{ success, data: [...], tags: string[] }`；`data` 行字段与 **models** 分析相同（含上表 TTFT 聚合列），按 `provider_id` 分组。

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
