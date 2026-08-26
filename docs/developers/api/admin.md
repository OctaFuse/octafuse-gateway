# 管理接口

后台 Console Session 与具名 Admin API Key 共用的管理 API。

## 部署与路径（Octafuse）

- **对外 URL**：`{GATEWAY_MASTER_URL}/api/admin/...`（Admin Pages 根 URL；外部集成方约定使用同名环境变量。例如创建 Key：`POST .../api/admin/keys`）。由 **Admin Pages**（`packages/admin`）提供，**Proxy Worker 不提供 `/admin`**。
- **本文档中的路径**：一律指内部 Hono 挂载路径 **`/admin/...`**（与实现代码一致）；集成时请将前缀换成 **`/api/admin`**。

## 认证

外部系统在请求头中携带具名 Admin API Key：

```bash
Authorization: Bearer sk-admin-<64 hex characters>
```

浏览器登录会创建数据库 Session，并通过 `admin_session` Cookie 识别为 `console:<username>`。Console 拥有完整业务权限，也是唯一可以管理集成密钥的主体。

集成密钥（Integration Keys）在后台 **系统集成 → 集成密钥（Integration Keys）** 创建。每个外部集成应使用独立、最小权限 Key；Key 主体记录为 `admin_key:<id>`。权限包括 `users.*`、`user_keys.*`、`providers.*`、`models.*`、`routes.*`、`config.*`、`analytics.read`、`logs.read` 和 `playground.execute`；`*.write` 自动包含对应 `*.read`，`*` 代表全部可委派业务权限，但不包含集成密钥或 Session 管理。

升级迁移会把非空 `system_config.MASTER_KEY` 原值复制为普通全权限 Key `legacy-master`，确保旧调用方继续工作；随后的迁移会删除该配置行。新认证只读取 `admin_api_keys`。请在稳定后为外部系统创建具名 Key，并轮换或吊销 `legacy-master`。

无效或已吊销 Key 返回 `401`；权限不足返回 `403`，响应包含 `required_permission`。任何 Bearer Key（包括 `*`）均不能访问 `/admin/access-keys/*`。

登录成功 / 失败、登出与 `401` 未认证不落库，而是以结构化 JSON 写入日志流（Cloudflare Logs / 容器 stdout），`event` 取值 `admin.auth.login`、`admin.auth.login_failed`、`admin.auth.logout`、`admin.auth.unauthorized`，附带 `client_ip`、`user_agent`，Bearer 场景另附 `key_prefix`（前 12 位）。请在日志平台按 `event` 建立告警规则（例如同一 IP 的 `admin.auth.login_failed` 频次）。

## 时间与时区约定

存储 / 查询 / 业务日界 / `BUSINESS_TIMEZONE` 的完整约定见 **[time-and-timezone.md](../reference/time-and-timezone.md)**。摘要：库内 UTC；API 时间字段返回 ISO 8601 UTC（`Z`）；Admin 墙钟与业务日界按 `BUSINESS_TIMEZONE`。

- **计费币种**：`system_config.BILLING_CURRENCY` 仅允许 **`USD`** 或 **`CNY`**（各库的 **`0002_seed.sql`** 默认 `USD`），与 `pricing_profile` / Key 预算数值单位一致；`GET /v1/me` 返回 `billing_currency`（见用户接口文档）。**`PUT /admin/config`** 写入该键时由服务端白名单校验。
- **全局路由策略**：`system_config.ROUTE_STRATEGY`（默认 `hash_affinity`；四选一，见 [route-strategies.md](../reference/route-strategies.md)）。**`PUT /admin/config`** 白名单校验；Route Pool / 模型级配置可覆盖。
- **Proxy 错误告警（可选）**：`ALERT_WEBHOOK_WECOM_URL`、`ALERT_WEBHOOK_FEISHU_URL` 存**完整**群机器人 Webhook URL（含 query `key` / hook id）。**未配置或值为空则不告警**。Proxy 在 **`api_key_request_logs.status = error`** 且用量写入成功后，分别向已配置的 URL 发送一条**按错误类型归类**的文本摘要（企业微信 `msgtype=text`、飞书 `msg_type=text`）：首行含类别与优先级（如上游超时、供应商鉴权、限流、5xx、敏感内容拦截、请求/模型错误、路由配置），并分组展示影响用户、路由/协议、供应商、原始 `error_message`、处理建议与发生时间（UTC+8）；发送失败只打日志，不影响请求。键名常量见 `@octafuse/core` 导出 `ALERT_WEBHOOK_WECOM_URL_KEY` / `ALERT_WEBHOOK_FEISHU_URL_KEY`。

### `/admin/keys` 统一响应格式

所有 **`/admin/keys`** 与 **`/admin/keys/:id`**、**`/admin/keys/:id/logs`** 的 JSON 响应使用同一信封：

- 成功：`{ "success": true, "data": ... }`，部分接口另有 `message`、`total`、`page`、`page_size` 等字段。
- 失败：`{ "success": false, "message": "..." }`，HTTP 状态码 4xx/5xx。

若认证无效，在到达业务处理函数前返回 `{ "success": false, "message": "Unauthorized" }`（401）；权限不足返回 403。

---

## Admin API 矩阵 {#admin-api-matrix}

逻辑分层：**Catalog**（供应商 → 模型 → 模型路由）、**Tenancy / Billing**（用户 / Key、`system_config` 中的配额相关项）、**Observability**（全站日志、按 Key 日志、分析聚合）。下列为 **Admin 应用** 对外 **`/api/admin/*`**（内部 **`/admin/*`**）的路径与主要数据表；外部调用方需持有对应资源权限。

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
| `/admin/users/:id/wallet/credit` | POST | `users.wallet_granted` + `user_audit_logs`（`wallet_credit`，`dedup_key` 幂等） | 门户加购、外部集成方 |
| `/admin/keys` | GET | `api_keys` **JOIN** `users`（分页列表；预算只读） | Admin UI、外部集成方 |
| `/admin/keys` | POST | `api_keys`（+ 可能 `users`） | 外部集成方、运维脚本 |
| `/admin/keys/:id` | GET | `api_keys` **JOIN** `users` | 外部集成方、Admin UI |
| `/admin/keys/:id` | PATCH, DELETE | `api_keys` | Admin UI、外部集成方 |
| `/admin/keys/:id/logs` | GET | `api_key_request_logs`（Key 范围，分页） | 外部集成方、Admin UI |
| `/admin/providers` | GET, POST, GET/PATCH/DELETE `/:id` | `providers`（单键 `api_key` + `status`；列表脱敏） | Admin UI |
| `/admin/providers/:id/api-key` | GET | `providers.api_key` 明文揭示 | Admin UI |
| `/admin/providers/import/catalog` | GET | 内置 Provider 模板摘要（无密钥） | Admin UI |
| `/admin/providers/import` | POST | 请求体 `{"ids":["0","1",…]}`：catalog 键（非 provider id）；每次导入新增 `providers` 行（UUID id；同名自动后缀）；占位 API Key，须在 Admin 中替换 | Admin UI、运维脚本 |
| `/admin/models` | GET, POST, GET/PATCH/DELETE `/:id` | `models`（含可选 `route_policy`），`model_tags` | Admin UI |
| `/admin/models/import/catalog` | GET | 内置静态目录可选项摘要（不含完整 `pricing_profile`） | Admin UI |
| `/admin/models/import` | POST | 请求体 `{"ids":["…"]}`：仅导入指定预设 → `models`（按 `BILLING_CURRENCY` 选用 USD/CNY 价；**同 id 不覆盖**，记入 `skipped_existing`；**不**写入 `model_tags`） | Admin UI、运维脚本 |
| `/admin/routes` | GET（`?model_id=&provider_id=`）, POST, GET/PATCH/DELETE `/:id` | `model_surfaces`、`route_pools`、`model_routes`（Surface → Pool → Target） | Admin UI |
| `/admin/routes/pools/:poolId` | PATCH | `route_pools.strategy` / `tier_strategies` / `sticky_routing`（Pool 策略与 Provider 粘性） | Admin UI |
| `/admin/routes/pools/:poolId/sticky/bindings/summary` | GET | 活跃粘性绑定按 target 聚合（epoch 有效且未过期） | Admin UI |
| `/admin/routes/pools/:poolId/sticky/bindings/lookup` | GET | 按 `user_id` / `email` + surface 上下文反查单用户绑定 | Admin UI |
| `/admin/routes/pools/:poolId/sticky/bindings/:affinityHash` | DELETE | 强制解绑（不校验 `binding_token`） | Admin UI |
| `/admin/routes/pools/:poolId/sticky/reset` | POST | bump `sticky_epoch`，使本 pool 全部绑定失效 | Admin UI |
| `/admin/playground` | POST | Routes：`routeId` 直连上游；Tools：`toolId`+`provider` 读 catalog 直连引擎（均可测、不计费、不写日志、无 failover） | Admin UI、运维联调 |
| `/admin/stats` | GET | 多表聚合（含 `api_key_request_logs`、`api_keys` 等） | Admin UI |
| `/admin/config` | GET, PUT | `system_config`（含 `ROUTE_STRATEGY`） | Admin UI |
| `/admin/access-keys`、`/:id`、`/:id/secret`、`/:id/rotate`、`/:id/revoke` | GET, POST, PATCH | `admin_api_keys`；仅 Console Session，同源写请求 | Admin UI |
| `/admin/business-timezone` | GET | `system_config.BUSINESS_TIMEZONE` | Admin UI（Provider 首屏加载） |
| `/admin/request-logs` | GET | `api_key_request_logs`（**GlobalLogs**，多条件筛选分页） | Admin UI |
| `/admin/budget-audit-logs` | GET | **`user_audit_logs`**（左联 **`users`** 取 `email` 等，多维筛选分页） | Admin UI |
| `/admin/analytics/models` | GET | `api_key_request_logs`，可选联 `model_tags` | Admin UI |
| `/admin/analytics/providers` | GET | `api_key_request_logs`，按 Provider 聚合 | Admin UI |
| `/admin/analytics/users` | GET | `api_key_request_logs`，左联 **`users`**（用户维度） | Admin UI |
| `/admin/analytics/reliability` | GET | `api_key_request_logs` | Admin UI |

说明：**GlobalLogs**（`/admin/request-logs`）与 **KeyScopedLogs**（`/admin/keys/:id/logs`）互补；**UserScopedLogs**（`/admin/users/:id/logs`）按 `user_id` 拉全量请求历史。**全局审计列表**（`/admin/budget-audit-logs`，表为 **`user_audit_logs`**）记录预算与用户/密钥生命周期事件，与请求日志正交。各类审计行何时产生（含高频 `usage_charge`）见 [`../reference/user-audit-logs.md`](../reference/user-audit-logs.md)。**数据模型总览**见 [`../architecture/user-keys-data-model.md`](../architecture/user-keys-data-model.md)。

### 与 Proxy `GET /catalog/models` 的区别 {#admin-vs-proxy-catalog}

名称里虽都有 “catalog / models”，但 **Admin 不提供** Proxy 上的公开 discovery 接口；下列三者勿混用：

| 接口 | 部署 | 鉴权 | 数据含义 |
|------|------|------|----------|
| **`GET /catalog/models`**（Proxy） | `GATEWAY_URL` | 无 | **运行时**可调用模型 + `protocols` / `protocols_by_group`（由 active `model_routes` 聚合） |
| **`GET /admin/models`** | Admin `/api/admin/*` | Console Session 或 `models.read` | 库内 **全部**模型 CRUD 列表（含 tags、路由计数；**不**含按 route 的协议聚合） |
| **`GET /admin/models/import/catalog`** | Admin | Console Session 或 `models.read` | 仓库内 **静态 preset** 摘要，供导入 UI 勾选，**非**运行时 route 真相 |

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

响应：`{ success, data: [...], total, page, page_size }`；列表行含 **`active_keys_count`**（激活中的 API Key 数）、**`keys_count`**（该用户全部 API Key 数，含已吊销）等（与实现 `AdminUserListItem` 对齐）。

### `POST /admin/users`

按 **`(external_system, external_user_id)`** 幂等创建（若已存在则返回已有用户）；无外部对时每次新建随机 uuid 用户。请求体至少含 **`email`**；可选 `budget_max`、`budget_base`、`budget_period`、`metadata`、`charged_cost_factors` 等（与 `AdminUserCreateInput` 对齐）。外部对须同空或同非空。

`charged_cost_factors` 为 `{ "<models.id>": number }`（倍率 ≥ 0）。`null` 或 `{}` 表示清空。未知目录模型 ID、负数或非对象会返回 **400**。创建后可在管理后台用户详情的 Charged cost factors 中维护。

### `GET /admin/users/:id`

用户详情（`getUserInfo`：含预算列、外部身份、`charged_cost_factors` 对象或 `null` 等；周期型预算可能触发懒重置）。**不含**密钥列表；枚举密钥请用 **`GET /admin/users/:id/keys`**。用户列表行（`GET /admin/users`）含 **`active_keys_count`**、**`keys_count`**，其中 `charged_cost_factors` 同样解析为对象或 `null`。

### `PATCH /admin/users/:id`

更新邮箱、预算计划、`status`、`metadata`（合并或 `metadata_replace`）、外部身份对、`charged_cost_factors`（对象或 `null`，校验规则与创建相同）、`wallet_granted` / `wallet_spent`（永久额度绝对值，运维修正）等。仅改用户计费倍率时，审计 `reason_code` 为 `admin_patch_charged_cost_factors`。**密钥级字段不可在此修改**。加购增量请用下方 **`wallet/credit`**，不要把金额加进 `budget_max`。

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

响应：`{ success, message, data: { transition: { before, after, carryover }, user: <getUserInfo> } }`。换档只动周期额度，永久额度不变。

### `POST /admin/users/:id/wallet/credit`

永久额度增量加额（门户加购、注册赠额、退款扣回）。请求体：

| 字段 | 必填 | 说明 |
|------|------|------|
| `amount` | 是 | 非零数字；负值用于退款扣回 |
| `kind` | 是 | `topup` \| `signup_bonus` \| `admin_adjust` \| `refund` |
| `external_ref` | 是 | 写入 `user_audit_logs.dedup_key`；同一用户同一引用重放不重复加额 |
| `reason` | 否 | 审计 `reason_text` |

响应：`{ success, data: { status: "applied" \| "duplicate", walletGranted, walletSpent, walletBalance } }`。加额流水用现有 `GET /admin/budget-audit-logs?user_id=&event_type=wallet_credit`，不另建端点。

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
curl -X POST http://localhost:8789/api/admin/keys \
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
curl -X POST http://localhost:8789/api/admin/keys \
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
curl -X PATCH http://localhost:8789/api/admin/keys/uuid-here \
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
curl http://localhost:8789/api/admin/keys/uuid-here \
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
curl -X DELETE http://localhost:8789/api/admin/keys/uuid-here \
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

> 注：LLM、Audio token 与 Image token 模式按 `models.pricing_profile.tiers` 选档；Image `per_image`、Audio `per_second` 与 Agent Tool `fixed_tool_cost` 使用各自计费基数。模型请求中，`metered_cost` / 路由侧 `charged_cost` = 目录价 × 有效倍率（无 `schedule.mode` 时叠乘；`override` 时窗内用窗口 factor），`standard_cost` = 目录价（不乘路由倍率）；若 `users.charged_cost_factors` 含该目录模型 ID，再对路由用户计费乘一次该倍率并六位四舍五入（只改最终 `charged_cost` 与预算累加）。**Tools** 在 catalog 直接配置三账本绝对单价（`metered` / `standard` / `charged`，无 Route factor/schedule，也不应用用户计费倍率），成功后分别写入三列，仅 `charged_cost` 累加预算。嵌套 `metered`/`charged` tiers **不计价**。**`pricing_audit`** 新写入为 **v4**（模型见 `packages/core/src/db/pricing-audit.ts`；Tools 为 `kind=fixed_tool_cost` + `unit_prices` / `totals`；v4 模型审计可带 `user_charged_factor`，未命中为 `null`）。**`request_protocol`** 为客户端调用的 Gateway 入口协议；**`upstream_protocol`** 为本次请求所选路由的 `model_routes.upstream_protocol` 快照。历史字段 `total_cost` 与 **`billing_factor`** 列已移除。列表接口返回列为 `api_key_request_logs` 全字段（与 `packages/core/src/types.ts` 中 `RequestLogRow` 一致）。

### 示例

```bash
curl "http://localhost:8789/api/admin/keys/uuid-here/logs?page=1&page_size=10" \
  -H "Authorization: Bearer sk-admin-xxx"
```

面向用户的「有活跃路由的模型」列表：**Agent / SDK** 用 **`GET /v1/models`**（用户 Key）；**门户 / 公开 discovery** 用 Proxy **`GET /catalog/models`**（无需 Key，含协议能力，见 [用户接口](./user.md#公开模型目录catalog-discovery)）。

**管理端基础数据**（Console Session 或具有对应权限的 `Authorization: Bearer <ADMIN_API_KEY>`，响应多为 `{ success, data, count? }`）：**`/admin/keys`**（上文用户 Key）与下列 Catalog API。

### Providers（`/admin/providers`）

一个 Provider = **一把** `api_key` + **`status`**（`active` \| `disabled`）。**无** `/admin/providers/:id/keys*` 子资源（迁移 0015 已删除 `provider_api_keys`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/providers` | 列表；`api_key` **脱敏**；含 `endpoints`、`status`、`has_pending_key`、`routes_count`、`active_routes_count` |
| POST | `/admin/providers` | 创建；**`name` + `api_key` 必填**；可选 `id`、`description`、`endpoints`、`status` |
| GET | `/admin/providers/:id` | 详情（脱敏 `api_key`） |
| PATCH | `/admin/providers/:id` | 部分更新；`api_key` 空串/未传 = **不改密钥**；`status` 仅 `active` \| `disabled` |
| DELETE | `/admin/providers/:id` | 删除；仍被 `model_routes` 引用时返回 **409**，须先删除或改绑对应 Target |
| GET | `/admin/providers/:id/api-key` | **揭示明文** `api_key`（`{ success, data: { api_key } }`） |
| GET / POST | `/admin/providers/import/catalog`、`/import` | 静态模板导入（占位 key，须手动替换） |

`endpoints` JSON 权威形状：

```json
{
  "openai": {
    "base": "https://api.example.com/v1",
    "endpoints": {
      "chat": "https://api.example.com/v1/chat/completions",
      "responses": "https://api.example.com/v1/responses",
      "images.generations": "https://api.example.com/v1/images/generations",
      "images.edits": "https://api.example.com/v1/images/edits",
      "audio.transcriptions": "https://api.example.com/v1/audio/transcriptions"
    }
  },
  "anthropic": {
    "base": "https://api.example.com/v1",
    "endpoints": { "messages": "https://api.example.com/v1/messages" }
  },
  "gemini": {
    "base": "https://generativelanguage.googleapis.com/v1beta/models",
    "auth": "query-key",
    "endpoints": {
      "models.generate": "https://example.com/v1beta/models/{model}:{action}"
    }
  }
}
```

`base` 走标准路径派生；capability 完整 URL 模板存在则覆盖派生结果。Gemini canonical 键为 **`models.generate`**，模板必须含 `{model}` 与 `{action}`；历史 `generateContent` / `streamGenerateContent` 键仍可读写，但新 UI 与规范化后的路由只生成 `models.generate`。可选 **`gemini.auth`**：`query-key`（`?key=`）或 `bearer`（`Authorization`）；省略则为 `query-key`。`auth` 仅允许出现在 `gemini`。

### Models / Routes

- **`/admin/models`**：CRUD；`PATCH` 可写 **`route_policy`**（TEXT JSON 或 `null` 清空）。含 **`GET /admin/models/import/catalog`** 与 **`POST /admin/models/import`**。Image 路由使用 OpenAI 协议；Audio 路由支持 OpenAI 与 DashScope，按 operation / adapter 校验。
- **`/admin/routes`**：REST `GET/POST`、`GET/PATCH/DELETE /:id`；列表支持 `?model_id=&provider_id=`。创建时校验 provider 对该协议是否配置了 `endpoints` base 或任一 capability，并创建或复用对应 Request Surface / Route Pool。
  - **`priority`**：层（Proxy 按 **DESC** 硬序）。
  - **`weight`**：同层权重，整数 **≥ 1**（默认 1）；非法 → **400**。
  - **`POST`** 省略或空白 **`route_group`** → **`default`**；**`PATCH`** 若含 `route_group` 则不得为仅空白（否则 **400**）。
  - **`request_protocol` / `request_operation`**：公开请求入口，例如 `openai` + `chat` / `responses`；省略 operation 使用兼容值 `*`。
  - **`upstream_protocol` / `upstream_operation`**：Target 实际调用的协议 / capability；省略 operation 时跟随请求 operation。
  - **`adapter`**：同协议、同 operation 使用 `passthrough`；OpenAI ASR / TTS 转 DashScope 使用白名单中的显式 adapter。未声明的跨协议或 operation 组合返回 **400**，见 [DashScope 音频架构](../architecture/dashscope-audio.md)。
  - **`GET` 响应**：除 Target 字段外包含 `route_pool_id` 与 `surfaces`（JSON 数组字符串），用于还原 Surface → Pool → Target 拓扑。
- **`PATCH /admin/routes/pools/:poolId`**：设置当前 Pool 的策略与按层覆盖。body 示例：

```json
{
  "strategy": "hash_affinity",
  "tier_strategies": { "10": "hash_affinity", "0": "weight_priority" },
  "sticky_routing": { "enabled": true, "idle_ttl_seconds": 3600 }
}
```

  - **`strategy`**：四策略之一；`null` / 空值表示继承模型 / 全局配置。
  - **`tier_strategies`**：priority（整数键）→ 策略名；`null` / `{}` 清空列。非法 key 或策略名 → **400**。
  - **`sticky_routing`**：`{ enabled: boolean, idle_ttl_seconds?: number }`；`idle_ttl_seconds` 默认 3600，范围 60–86400；写入时递增 `sticky_epoch` 使旧绑定失效。
  - 字段均可选，至少提供其一。

- **Sticky 绑定可观测 / 排障**（挂在 `/admin/routes/pools/:poolId/sticky/*`，须在 `/:id` 通配之前注册）：
  - **`GET .../sticky/bindings/summary`** → `{ total_active, stale_count, targets: [{ route_target_id, active_count, share, last_updated_at }] }`。活跃行条件：`pool_epoch = route_pools.sticky_epoch` 且 `expires_at > now`。
  - **`GET .../sticky/bindings/lookup?user_id=&email=&model_id=&route_group=&protocol=&request_operation=`**  
    用 surface 上下文（`resolveModelSurface`）校验属于该 pool，再按 `SHA-256(userId|model|routeGroup|protocol)` 查绑定。`email` 与 `user_id` 二选一。返回 `{ user_id, affinity_hash, affinity_key, binding }`；`binding` 可为 `null`。
  - **`DELETE .../sticky/bindings/:affinityHash`**：强制删除该 hash 行（管理端解绑，无 token CAS）。
  - **`POST .../sticky/reset`**：仅 bump `sticky_epoch`，返回 `{ sticky_epoch }`。历史行不立即删除，随 GC / 覆盖消失。

完整拓扑与 operation 白名单见 [route-topology.md](../architecture/route-topology.md)。

### `models.route_policy`（`PATCH /admin/models/:id`）

模型级路由策略覆盖（优先级低于 Route Pool 与 `tier_strategies`，高于全局 `ROUTE_STRATEGY`）。形状与解析见 [route-strategies.md](../reference/route-strategies.md)。

```json
{
  "strategy": "hash_affinity",
  "rules": {
    "openai:default": { "strategy": "hash_affinity" },
    "openai.chat:default": { "strategy": "weight_priority" }
  }
}
```

- **清空**：`null` 或空串 ⇒ 列 `NULL`（回退全局）。
- **校验**：`normalizeModelRoutePolicyInput`；须含顶层 `strategy` 和/或至少一条合法 `rules`。
- **运行时**：仅 Proxy failover 路径；Admin Playground **不走**策略排序。解析时先看 `route_pools.tier_strategies[priority]`，再看 `route_pools.strategy`，然后才是模型 `route_policy`。

### `GET /admin/models/import/catalog`

- **行为**：返回 `packages/admin/lib/model-presets/*.json`（合并后）每条预设的摘要（`id`、`display_name`、`vendor`、`context_window`、`max_tokens`、`description`、`i18n`、`tier_count`、`pricing_label`、`pricing_preview`），供管理端勾选后再调用 **`POST /admin/models/import`**。英文描述与本地化摘要直接维护在对应的模型预设记录中。价格预览按当前 **`BILLING_CURRENCY`** 选用 `usd` / `cny` 分支（与导入写入同源）；响应另含顶层 **`billing_currency`**。

### `POST /admin/models/import`

- **请求体**：`{ "ids": ["glm-5", "gpt-5.2", ...] }`（**必填**；`ids` 须为非空字符串数组；重复 id 会去重；顺序保留）。
- **行为**：仅处理 `ids` 中在静态目录存在的 id；根据当前 **`BILLING_CURRENCY`**（`USD` → `usd` 分支，`CNY` → `cny` 分支；库内为其他历史值时按 **`USD`** 分支取价）写入 `models.pricing_profile`；**已存在同 `id` 的不导入、不覆盖**，该 id 记入 **`skipped_existing`**；否则 **INSERT** 新建。标签由运营在导入后自行维护，导入**不**写入 `model_tags`。未知 id 或校验失败记入 **`failed`**，其余仍处理。
- **响应** `data`：`{ "billing_currency_used", "created", "updated"（恒为 0）, "skipped_existing": string[], "failed": [{ "id", "message" }] }`。

### 运维验收：文生图模型 `gpt-image-2`

> 模型与计费总览见 [文生图模型（Image Models）](../reference/image-models.md)。

不新增独立「Images」管理页；与 LLM 共用 Models + Routes。Admin 内闭环：**Routes → Playground → Simulator → Request Logs**。

1. **Provider**：配置可用的 OpenAI（或兼容）Provider Key，并在 `endpoints.openai` 写 `base`（如 `https://api.openai.com/v1`）或 `endpoints.images.generations` 完整 URL。
2. **Import**：Admin → Models → Import → 勾选 **`gpt-image-2`**（`output_modalities: ["image"]`，`pricing_profile.tiers` 含 `image_*` token 单价）。**已存在同 id 不会覆盖**——旧按张行需 **删除后 re-import** 或打开编辑填入 token 单价后保存。
3. **列表**：筛选 Kind=Image，卡片应显示 Image token 单价（如 text / img-in / img-out）。
4. **Routes**：为 `gpt-image-2` 建路由；弹窗 Billing「Standard (catalog)」应显示 **token 分项单价**；`upstream_protocol` 对 OpenAI 兼容生图锁定 `openai`，DashScope 转换允许 `dashscope`（保存 anthropic/gemini 应 400）。Models admin 本身不引用 provider base URL。
5. **Playground**（不计费、不写 logs）：选 openai 透传路由 → Send → 上游由 `resolveUpstreamEndpoint(…, images.generations)` 解析（通常 `…/images/generations`）返回图并可预览。DashScope 转换路由同样可测：请求体仍用 OpenAI Images JSON，调试台改写成 `images.generations.multimodal`。anthropic / gemini 路由禁用 Send。
6. **Simulator**（真实 Proxy）：选同一模型 → 协议锁定 openai → 请求打到 `{proxy}/v1/images/generations` → 出图；**Open Request Logs** 核对 `raw_usage` 与 `pricing_audit.kind=image_tokens`，`charged_cost` 随 usage 分项变化（非固定按张）。DashScope 转换路由也走这条 OpenAI 入口（adapter `dashscope-image-*`），不要改成 dashscope 协议。
7. **回归**：任意 LLM 模型仍走 chat/completions（Playground / Simulator 行为不变）。
8. **curl**（可选，用户 API Key）：

```bash
curl -sS "$GATEWAY_URL/v1/images/generations" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"a red apple","size":"1024x1024","quality":"low","n":1}'
```

成功响应含图片；请求日志按上游 `usage` token 分项扣费。用户 API 说明见 [user.md「Images」](user.md#images图片生成--编辑)。

### 运维验收：语音转写 `whisper-1` / `gpt-4o-*-transcribe`

不新增独立「Audio」管理页；与 LLM / Image 共用 Models + Routes。Admin 内闭环：**Routes → Playground → Simulator → Request Logs**。用户 API 见 [user.md「语音转写」](user.md#语音转写audio-transcriptions)。

1. **Provider**：配置可用的 OpenAI（或兼容）Provider Key；`endpoints.openai.base`（如 `https://api.openai.com/v1`）即可派生 `/audio/transcriptions`，或在 `endpoints.openai.endpoints["audio.transcriptions"]` 写完整 URL。
2. **Import**：Admin → Models → Import → Kind=Audio → 勾选例如 **`whisper-1`**（`per_second`）或 **`gpt-4o-mini-transcribe`**（`token`）。**已存在同 id 不会覆盖**——改价需删除后 re-import，或打开编辑后保存。
3. **列表**：筛选 Kind=Audio；卡片按模式展示按秒单价或 token in/out（$/1M）。
4. **Routes**：为模型建路由；`upstream_protocol` **锁定 openai**（保存 anthropic/gemini 应 400）；Billing「Standard (catalog)」应显示对应 Audio 目录价。
5. **Playground**（不计费、不写 logs）：选该 openai 路由 → 上传音频 → Send → 上游由 `resolveUpstreamEndpoint(…, audio.transcriptions)` 解析；非 openai 路由禁用 Send。
6. **Simulator**（真实 Proxy）：选同一模型 → 协议锁定 openai → 请求打到 `{proxy}/v1/audio/transcriptions` → 出转写文本；**Open Request Logs** 核对：
   - `whisper-1`：`billing_kind=audio_per_second`、`audio_duration_seconds`、`pricing_audit.kind=audio_per_second`
   - `gpt-4o-*-transcribe`：`billing_kind=audio_tokens`、`pricing_audit.kind=audio_tokens`（含 `tokens.*`）
7. **curl**（可选，用户 API Key）：

```bash
curl -sS "$GATEWAY_URL/v1/audio/transcriptions" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -F model=whisper-1 \
  -F file=@recording.webm \
  -F language=zh \
  -F response_format=json
```

### 运维验收：国内文生图 `seedream-*`（火山方舟）

与 `gpt-image-2` 共用同一套 OpenAI Images 驱动；Seedream 目录价为 **`image_billing_mode: per_image`**（按张），不再用 16384 token 折算。

1. **Provider**：Admin → Providers → Import → **Volcengine Ark**（**不要**写 `openai.base`；只配 `endpoints.chat` + `endpoints.images.generations`，避免派生出不存在的 `/images/edits`）。填入火山 API Key。
2. **Import**：Models → Import → 勾选：**`doubao-seedream-5-0`** / **`doubao-seedream-5-0-pro`**。**已存在同 id 不会覆盖**——改价需删后 re-import、PATCH，或跑 `node scripts/db/migrate-image-billing-modes.mjs --dry-run` / `--apply`。
3. **目录价口径**（**`per_image`**；权威单价 `image.default`；与火山方舟 / BytePlus 公开价对齐）：
   | catalog / `provider_model_name` | 官方约价 | `image.default` CNY | USD |
   |---|---|---|---|
   | `doubao-seedream-5-0` | ¥0.22 / 张（一口价，不按分辨率翻倍） | **0.22** | **0.035** |
   | `doubao-seedream-5-0-pro` | ≤2.36MP ¥0.30 / >2.36MP ¥0.60；参考图首张免费、之后 ¥0.02 | **0.30**（`2k`）；高档 **0.60**（`3k`/`4k`）；`image.input.default=0.02` | **0.045** / **0.09**；input **0.003** |
4. **Routes**：`upstream_protocol=openai`（锁定）；`provider_model_name` 与 catalog id 同名即可。`watermark` / `sequential_image_generation` 等由客户端请求或 route `custom_params` 按需传入，**不**写在模型预设里。
5. **Playground / Simulator**：选该路由 → generations；Seedream **图生图**走 `POST /v1/images/generations` + JSON `image`（勿用 multipart `/v1/images/edits`，火山无 OpenAI edits 形态）。
6. **Request Logs**：核对 `pricing_audit.kind=image_per_image`、`billing_kind`、`output_image_count=1`、`charged_cost≈官方单价×charged_factor`。
7. **curl**（用户 API Key）：

```bash
curl -sS "$GATEWAY_URL/v1/images/generations" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"doubao-seedream-5-0","prompt":"海边灯塔水彩封面","size":"2K","n":1,"watermark":false}'
```

### `pricing_profile` / `price_override` 契约（`/admin/models`、`/admin/routes`）

- **模型目录价**：`models.pricing_profile`（TEXT JSON）。
  - **Token（LLM）**：canonical `{ "tiers": [...] }`。非末档 `upto` 为有限数字 **≥ 0**；**末档 `upto` 为 JSON `null`**（开放上界）。LLM 选档 basis 为上游 **`input_tokens`**（`packages/core/src/db/pricing-profile.ts`）。
  - **Image 双模式**（显式 `image_billing_mode`；Admin 保存禁止混配）：
    - **`token`**：`{ "image_billing_mode": "token", "tiers": [ { image_* $/1M ... } ] }`。扣费权威 = 上游 `usage`；`pricing_audit.kind=image_tokens`。缺省无 mode 且 tier 含正 `image_*` 时运行时推断为 `token`。
    - **`per_image`**：`{ "image_billing_mode": "per_image", "image": { "default", "input"?, "uncertain_result_policy"? } }`（**无 `tiers`**；写入时会剥离历史占位零档）。扣费权威 = 确认输出张数 × `image.default`（+ 可选参考图 `image.input`）；`pricing_audit.kind=image_per_image`。日志列 `billing_kind` / `input_image_count` / `output_image_count`。
    - 无 mode 且仅有 legacy `image` 块：**不计费**（避免旧数据突然扣款）；须显式设 `per_image` 或跑迁移脚本。
    - `gpt-image-2` / Gemini：token 预设；Seedream / GLM / Grok：per_image 预设（见 [image-models.md](../reference/image-models.md)）。
  - **Audio 双模式**（显式 `audio_billing_mode`；Admin 保存禁止与 Image 计费字段混配）：
    - **`per_second`**：`{ "audio_billing_mode": "per_second", "audio": { "price_per_second", "minimum_seconds"? } }`（**无 `tiers`**）。扣费权威 = 计费秒数 × `price_per_second`；`pricing_audit.kind=audio_per_second`。日志列 `billing_kind=audio_per_second`、`audio_duration_seconds`。
    - **`token`**：`{ "audio_billing_mode": "token", "tiers": [ { "input_price", "output_price", "upto": null } ] }`（$/1M）。扣费权威 = 上游 transcription `usage`（`type=tokens`）；`pricing_audit.kind=audio_tokens`。日志列 `billing_kind=audio_tokens`，并写入 input/output token。
    - 预设：`whisper-1` → `per_second`；`gpt-4o-mini-transcribe` / `gpt-4o-transcribe` / `gpt-4o-transcribe-diarize` → `token`（见 [user.md「语音转写」](user.md#语音转写audio-transcriptions)）。
  - Request log：迁移 **`0013_request_log_image_billing`** 增加 `billing_kind`、`input_image_count`、`output_image_count`；**`0014_request_log_audio_billing`** 增加 `audio_duration_seconds`。
- **模型 Kind（Admin UI，无独立 DB 列）**：
  - **Audio（语音转写）**：`pricing_profile` 含有效 `audio_billing_mode`（`per_second` + `audio`，或 `token` + `tiers`）；见 `isAudioTranscriptionModel`（`packages/core`）。
  - **Image（文生图）**：非 Audio，且 `output_modalities` 含 `image`（**不要**用 `input` 含 `image` 判断——多模态 LLM 也会有）。
  - **LLM**：其余；仅当 `output_modalities` 缺失时，才用历史 `pricing_profile.image` 兜底判定。
  - Models / Routes UI 侧栏 Kind 为 **`llm` | `image` | `audio`（无 All）**，URL `?kind=` 与 `?vendor=` 组合；默认 `llm`。Image 卡片按 mode 展示 `/M` 或 `/image`；Audio 卡片按 mode 展示 `/s` 或 token in/out。
  - 文生图与语音转写**不使用**聊天字段 `context_window` / `max_tokens`（多数预设与保存为 `null`；Admin 卡片/表单隐藏这两项；部分 ASR token 预设可带 context/max 供上游约束）。LLM 的 `max_tokens` 缺省仍为 8192。迁移 **`0010_models_max_tokens_nullable`** 允许 `max_tokens` 为 NULL。
- **路由计价（canonical）**：`model_routes.price_override` 只维护倍率（不复制计费模式或基础单价），**不再**要求 nested `metered` / `charged` tiers：

```json
{
  "charged_factor": 1.2,
  "metered_factor": 1.0,
  "schedule": {
    "mode": "override",
    "charged": [
      { "start": "00:00", "end": "24:00", "factor": 1.2, "days": [1, 2, 3, 4, 5] },
      { "start": "00:00", "end": "24:00", "factor": 0.8, "days": [6, 7] }
    ],
    "metered": [
      { "start": "00:00", "end": "24:00", "factor": 1.2, "days": [1, 2, 3, 4, 5] },
      { "start": "00:00", "end": "24:00", "factor": 0.8, "days": [6, 7] }
    ]
  }
}
```

  - `charged_factor` / `metered_factor`：相对目录价的默认倍率（缺省 `1`；`metered_factor` 缺失时可回退读历史 `provider_factor`）；未命中分时时段时使用。
  - `schedule`（可选）：分时窗口，时区为 `system_config.BUSINESS_TIMEZONE`；半开区间 `[start, end)`，仅 `end` 可为 `24:00`；允许跨午夜。可选 `days` 为 ISO 星期数组（`1`=周一 … `7`=周日）；省略表示每天。跨午夜时 `days` 锚定窗口**开始日**（例如周五 `22:00–06:00` 覆盖周五 22:00 至周六 06:00）。窗口在请求进入 Gateway 时锁定，长流式请求跨越边界不会切换倍率。同侧窗口在一周循环上禁止重叠。
  - `schedule.mode`：
    - **缺省或 `"multiply"`**（存量）：`charged_cost` = 目录价 × `charged_factor` × 命中窗 `factor`（未命中窗按 `1`）；`metered_cost` 同理。
    - **`"override"`**（Admin UI 新写入）：命中窗时窗口 `factor` 就是对标准价的倍率；未命中用上方默认 `charged_factor` / `metered_factor`。两侧共享同一套 start/end（及可选 `days`），各写自己的 `factor`。
  - `standard_cost` 仅为目录价。嵌套 `metered`/`charged` tiers **写入时剥离、运行时忽略**。`pricing_audit.schedule.evaluated_at_utc` 记录本次选窗使用的请求开始时刻，并带 `local_weekday`（1–7）。非法 `mode` 或非法 `days` 在 Admin API 写入时拒绝。
- **公开列表**：`GET /v1/models` 返回完整 `pricing_profile` 字符串；`model_info.input_price` / `output_price` 为 **兼容展示**：取各档中 **最低 `input_price`** 所在档的 in/out。详见 [user.md「获取模型列表」](user.md)。

#### Gateway Admin UI — Model Routes「Billing & Cost」

与 Proxy `usage-tracker` 一致：

| 区块 | 含义 | 数据来源 |
|------|------|----------|
| **Standard price** | 目录标准价（只读） | `models.pricing_profile`（LLM/Image token/Audio token 的 tiers，或 Image per_image / Audio per_second 的单价块） |
| **Charged factor** | 用户侧默认倍率（窗外） | `price_override.charged_factor` |
| **Metered factor** | 供应侧默认倍率（窗外） | `price_override.metered_factor` |
| **Schedule** | 共享 start/end 与可选星期，每行 Charged / Metered 倍率（覆盖默认） | `price_override.schedule`（`mode: "override"`） |

路由列表卡片展示 **`Ch ×`** / **`M ×`**；有 schedule 时附加 **Sch** 提示。

---

## 仪表盘与聚合（`/admin/stats`、`/admin/config`、…） {#admindashboard}

与 **`/admin/keys`** 相同，请求需使用 Console Session，或携带具有对应权限的 **`Authorization: Bearer <ADMIN_API_KEY>`**。成功响应一般为 `{ "success": true, ... }`；无效或已吊销 Key 返回 401，权限不足返回 403 及 `required_permission`。

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
- **`ROUTE_STRATEGY`**：仅允许 **`hash_affinity`** \| **`weighted_random`** \| **`weight_priority`** \| **`weighted_round_robin`**（小写）；非法 → `400`。这是全局同层路由策略缺省，模型 `route_policy` 与 `route_pools.strategy` 可覆盖。详见 [route-strategies.md](../reference/route-strategies.md)。Proxy 进程内缓存约 **30s**。

Agent Tools 也通过该接口维护配置：

| 工具 | Catalog 键 | Active 键 | Provider 白名单 |
|------|------------|-----------|-----------------|
| Web Search | `WEB_SEARCH_CATALOG` | `WEB_SEARCH_ACTIVE` | `bocha`、`tavily`、`cleversee`、`tencent_wsa` |
| Web Fetch | `WEB_FETCH_CATALOG` | `WEB_FETCH_ACTIVE` | `firecrawl`、`tavily`、`jina` |
| Web Deep Search | `WEB_DEEP_SEARCH_CATALOG` | `WEB_DEEP_SEARCH_ACTIVE` | `firecrawl`、`jina` |
| AI Detection | `AI_DETECTION_CATALOG` | `AI_DETECTION_ACTIVE` | 当前 `tencent_tms`（多 provider 架构，可扩展） |

Catalog JSON 以 Provider id 为键。联网类工具每项为 `{ apiKey, metered, standard, charged }`（Admin 保存时同步写兼容键 `cost = charged`；仅有旧 `cost` 时 resolve 三列相等）；AI Detection 为凭证字段并集 + 三账本单价 + 可选 `billingUnitChars`。设置 Active 前必须配齐该引擎所需凭证（未实现引擎不可 Active）。每种工具同时只启用一个 Active Provider。单价均须 ≥ 0。

### 运维验收：Agent Tools（Playground / Simulator）

Admin 内闭环：**Tools Config → Playground（引擎）→ Simulator（Proxy）→ Tools Invocations**。

1. **Config**：Admin → Tools → Configuration，为某引擎填入凭证与**三账本单价**（供应 / 目录 / 用户）并保存；Active 指向已配齐凭证的引擎（AI Detection 第一版为 `tencent_tms`）。再保存后 catalog JSON 应展开为 `metered` / `standard` / `charged`（及 `cost`）。
2. **Playground Tools**（不计费、不写 logs）：Admin → Playground → **Tools** 模式，或 Config 行内 **Test in Playground**（`?mode=tools&tool=…&provider=…`）。选工具 + **任意 catalog 引擎**（不限 Active）→ Send → 直连上游引擎，确认密钥与响应形态。
3. **Simulator Tools**（真实 Proxy）：Admin → Simulator → Kind=**Tools** → 选工具与用户 API Key → Send 打到 `{proxy}/v1/tools/{id}` → 核对响应 `cost`（= charged）与预算；**Open Tools Invocations** / Request Logs 核对三列不同（若配置了不同单价）、`budget_spent` 仅增 charged、失败请求三列 0、`pricing_audit` v4 `fixed_tool_cost`。
4. **边界**：Playground Tools **不经** Proxy、**不扣**用户预算、**不写** `api_key_request_logs`；Simulator Tools **走** Proxy 全链路。二者共用 **`@octafuse/tool-engines`** 引擎客户端（Admin 不得再依赖 `packages/proxy`）。LLM / Image / Audio 的 Routes 模式行为不变。
5. **curl**（可选，用户 API Key，等价 Simulator）：

```bash
curl -sS "$GATEWAY_URL/v1/tools/ai-detection" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"sample paragraph for AI-rate detection"}'
```

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

`data` 每条日志即 **`api_key_request_logs` 行**（读接口不 JOIN `models` / `providers`；展示名依赖写入时快照列）。**`model_name`** / **`provider_name`** 为请求当时展示名快照；**`provider_model_name`** 为上游模型 id；**`provider_key_id`** / **`provider_key_label`** / **`provider_key_fingerprint`** 为最终选用 Provider 快照（现为 **provider id / name / api_key 指纹**；0015 前旧行可能仍为历史 key 池 id）。**`request_body`** 为客户端入口侧脱敏 JSON（无提示词正文；长度有上限）。**`upstream_request_body`** 为合并路由 `custom_params` 后、与发往供应商的 wire 体结构对齐的脱敏快照（规则同 `request_body`；迁移前或旧行可能为 `null`）。**`request_protocol`**（入口）与 **`upstream_protocol`**（所选路由实际转发协议）见上文注。升级前列可能为 `null`。

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
| `provider_id` | 可选；Provider 精确匹配 |
| `user_email` | 可选；用户邮箱精确匹配 |

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
