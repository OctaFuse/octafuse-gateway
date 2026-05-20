# @octafuse/proxy

## 1.1.0

### Minor Changes

- [`32fbd64`](https://github.com/OctaFuse/octafuse-gateway/commit/32fbd6495714fc82765d720a341ed0498b4b9d31) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy / 用户 API

  - **`GET /v1/models`**：支持按 `route_groups` 查询参数筛选；未传时默认仅返回 `default`/`free` 路由组（兼容 Agent 拉列表）；响应 `model_info` 增加 **`route_groups`** 字段。
  - **`GET /v1/me`**：新增 `resolveMeMetadata`，**优先返回 `users.metadata`**，Key metadata 作回退/补全。
  - **可观测性**：Node 运行时记录未处理 rejection/异常；OpenAI/Anthropic/Gemini egress 在 writer 关闭时的非致命错误写日志。

  ### Admin API（`/api/admin/*`）

  - **`GET /admin/users`**：列表支持 `sort` / `order`（`budget_spent`、`budget_max`、`budget_base`、`budget_reset_at`、`created_at`），服务端校验白名单与 NULL 排序规则。
  - **`GET /admin/keys`**：列表支持 `sort` / `order`（`budget_spent`、`budget_reset_at`、`created_at`）。
  - **创建用户**：识别外部系统 + 邮箱唯一约束冲突，返回明确错误（不再笼统 500）。
  - **分析/统计**：统一 API 与 DB 的日期范围处理（`shared.ts` 日期工具）；补充 core 单测与 `npm run test` 入口。

  ### Admin UI

  - 重构 **网关密钥** 与 **用户** 列表/详情：预算周期与重置标签格式化、金额展示更稳健（`coerceMoneyAmount`）、Key 状态色块、用户 metadata 摘要、列表点击排序等。
  - **Provider/Model 预设**：新增 Ollama、OpenRouter、SiliconFlow、火山方舟 Agent Plan、百炼 Coding Plan、小米 MiMo Token Plan、Gemini 3.5 Flash 等；修正 DeepSeek/MiniMax base URL；vendor id 去掉 `-official` 后缀以统一导入目录。

  ### 文档与运维

  - README（中英文）大幅扩充：架构、快速开始、调试沙箱/客户端模拟器、相对 LiteLLM 等方案的优势说明。
  - 文档：`octafuse-docs` → **`octafuse-website`** 链接；Proxy 转发失败可选 **企业微信/飞书 Webhook** 告警（`ALERT_WEBHOOK_*`，见 admin API 文档）；Cloudflare 部署与 D1 database id 同步；`.gitignore` 忽略 `data/`。

### Patch Changes

- Updated dependencies [[`32fbd64`](https://github.com/OctaFuse/octafuse-gateway/commit/32fbd6495714fc82765d720a341ed0498b4b9d31)]:
  - @octafuse/core@1.1.0

## 1.0.2

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@1.0.1

## 1.0.0

### Major Changes

- [#12](https://github.com/OctaFuse/octafuse-gateway/pull/12) [`6c86fc5`](https://github.com/OctaFuse/octafuse-gateway/commit/6c86fc5afb480e0345b3e67a4a80e57d7fa14ced) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Database & schema (D1 / Postgres / MySQL)

  - Rewrote engine baselines and Drizzle schema: add **`users`** table, slim **`api_keys`** (drop budget fields from keys), rename/replace legacy audit storage with **`user_audit_logs`** (user budget audit), add **`user_id`** on **`request_logs`**, and align analytics SQL.

  ### Core services & write paths

  - Introduce **`user-service`** (`getOrCreateUser`, budget reset, plan updates) and slim **`key-service`** to create/revoke/rename keys only.
  - Route critical writes through **`updateUserBudgetWithAuditTx`** and **`insertRequestUsageAndChargeTx(userId)`**; use conditional **`UPDATE`** on Postgres/MySQL to guard concurrency.
  - Add **`UsersRepository`**, **`UserAuditLogsRepository`**, and **`apiKeys.getApiKeyWithUserByKey`**; remove obsolete **`api_keys`** budget helpers.

  ### Admin API

  - Add **`/admin/users`** CRUD and related sub-resources; trim **`/admin/keys`** (no budget on keys); register **`users-service`** in the admin app.

  ### Admin UI

  - Add **`/gateway/users`** list and detail; rework **`/gateway/keys`** (no budget editing, simplified JOIN display); filter **audit logs** by **`user_id`**.
  - Improve user detail (metadata summary, keys), **API Keys** “New Key” flow, **Audit Logs** UX (snapshot field filters, copy, placeholders), and branding/titles.
  - **Create user** now **requires email** when creating without a user id; DB and forms enforce non-null email.

  ### Audit logging & docs

  - Replace legacy user-audit mapping with the **user budget audit** pipeline; remove deprecated mappers and refresh migration / audit docs.

  ### Tooling & housekeeping

  - Add a **client simulator** to exercise proxy requests locally.
  - Docs: README and conventions; fix admin **session expired** event name; GitHub Actions workflow image description tweak.

### Patch Changes

- Updated dependencies [[`6c86fc5`](https://github.com/OctaFuse/octafuse-gateway/commit/6c86fc5afb480e0345b3e67a4a80e57d7fa14ced)]:
  - @octafuse/core@1.0.0

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`b873e9d`](https://github.com/OctaFuse/octafuse-gateway/commit/b873e9d7be95893e746d2b59de1c6a406e28166c)]:
  - @octafuse/core@0.1.1
