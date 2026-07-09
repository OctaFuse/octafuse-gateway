# Changelog

## 1.7.0

### Minor Changes

- [`6845acf`](https://github.com/OctaFuse/octafuse-gateway/commit/6845acf084a4fea71a1d0a8df0034f81de6300f5) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy

  - **5xx 熔断策略**：调整 Gateway 上游 5xx 熔断逻辑；Provider key 已熔断且用户继续请求时直接返回错误，**不再触发告警**（[#41](https://github.com/OctaFuse/octafuse-gateway/issues/41)）。
  - **TTFT 记录**：区分 **reason TTFT** 与 **content TTFT**；修正此前仅按 content 首 token 记录导致 reasoning 场景 TTFT 偏大的问题。
  - **请求日志**：`api_key_request_logs` 增加首 token 等**分析时间**字段；Proxy 侧写入与查询链路对齐（[#52](https://github.com/OctaFuse/octafuse-gateway/issues/52)）。

  ### Admin UI

  - **国际化**：Admin 模块基础 i18n（**中文 + 英文**）。
  - **Analytics**：用户 Usage 行展开查看模型统计；增加 reason / content **TTFT** 展示与处理；Dashboard 大盘优化并移除 **Top Users Trend**；Time range 默认去掉 **90d**，Custom 选择布局优化；业务管理时间统一按**配置的业务时区**展示。
  - **Request Logs**：支持新增分析时间字段的查询与管理。
  - **Reliability**：Provider 列显示 **Name** 而非 Id。
  - **Routes**：左侧 Provider 过滤仅显示 **name**（去掉 id）。
  - **Providers**：API Key **label** 固定宽度，为其他信息腾出空间（[#55](https://github.com/OctaFuse/octafuse-gateway/issues/55)）。
  - **Models**：Import 弹窗支持按**名称搜索**（[#51](https://github.com/OctaFuse/octafuse-gateway/issues/51)）。

  ### 模型与 Provider 预设

  - **新增/更新**：grok-4.5 静态数据；Provider import 预设更新。

  ### 文档

  - 重构文档目录结构；完善本地开发与 Cloudflare 部署说明。

## 1.6.0

### Minor Changes

- ### Proxy

  - **限流、粘性路由与熔断**：Gateway 限流与路由策略优化；Provider 密钥在上游 **429** 时缩短 cooldown，降低并发故障时的级联影响。
  - **错误告警**：告警可选 **UTC+8 发生时间**；摘要格式更清晰。
  - **请求日志**：`api_key_request_logs` 增加 **request id** 与 **message id** 记录。

  ### Admin API

  - **Provider 预设**：新增 **hy token plan** Provider 导入模板。

  ### Admin UI

  - **Providers**：卡片式布局重构；Key 信息维护与 **Import** 流程优化；弹窗支持点击空白处关闭。
  - **Analytics**：Model / Provider Usage 支持行展开查看子维度统计；Provider Usage 点击名称跳转 Request Logs；Token 紧凑显示默认 **Compact**，K/M/B 分级样式区分。
  - **Request Logs**：展示与 request id / message id 对齐；修复 **Time range (UTC)** custom 点击无效（Audit Logs 同步修复）。
  - **Models / Routes**：页面结构与弹出框交互优化。

  ### 模型与 Provider 预设

  - **新增/更新**：Qwen 批量静态数据；hy3；Gemini 3 Flash、Gemini 2.5 系列；Longcat 2.0；Claude Sonnet 5；gpt-5.4-nano 等。

  ### 部署

  - **Cloudflare Workers**：`gen-wrangler` + Build variables 部署模型；`cloudflare-worker/` 多实例 env 与文档完善；修复 Admin OpenNext 与 Proxy 在 Cloudflare Builds 上的构建问题。

## 1.5.0

### Minor Changes

- [`9467578`](https://github.com/OctaFuse/octafuse-gateway/commit/9467578fb50fa09c4f5f563cc71bddb417314d13) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy

  - **敏感内容熔断**（`sensitive-content-circuit-breaker`）：检测到上游敏感内容拒绝时，按 `userId + baseModelId` 进程内短路 3 分钟，避免用户反复提交导致 Provider 封禁。
  - **Gemini 上游**：兼容多种 Provider `baseUrl` 与鉴权方式（含 Vertex 非 query key）；流式 query 参数修正（`applyGeminiStreamQueryParams`）。
  - **错误告警**：按错误类型与延迟分类；告警摘要拆分 model 行；usage 记录增加 model / provider 名称。

  ### Admin API

  - **预算转换**：`POST /admin/users/:id/budget/transition/preview` 与 `.../transition`，支持预览与原子应用（`budget-transition-service`）。

  ### Admin UI

  - **Analytics**：Model / Provider / User Usage 页面优化；Token 紧凑显示增加 `K` 单位；统一 `TimeRange` 组件。
  - **Request Logs**：拆分 **model**（请求 model）与 **route**（实际路由 provider + key）列。
  - **Model Routes**：按协议 + 分组展示卡片；倍率显示、复制按钮与标签样式优化；新建/编辑 route 时 Provider 按 name 排序。
  - **Providers**：列表按 name 升序；编辑页 API Key 维护优化（[#35](https://github.com/OctaFuse/octafuse-gateway/issues/35)）。
  - **Alerts**：告警展示改进。

  ### 模型与 Provider 预设

  - **新增/更新**：Doubao Seed 2.1 Pro/Turbo、Seed Evolving；Kimi K2.7 Code；glm-5.2 等静态数据与定价。

  ### 部署

  - **Docker migrate**：Compose / entrypoint 支持 migrate 一次性 Job 自动执行（[#27](https://github.com/OctaFuse/octafuse-gateway/issues/27)）。

## 1.4.0

### Minor Changes

- ### Schema / 数据迁移

  - **Provider API Key 池**：新增 `provider_api_keys` 表，支持同一 Provider 配置多条上游密钥（`label`、`status`、`weight`、`priority`）；迁移 `0004` 将历史 `providers.api_key` 迁入默认条目；`0005` 移除 `providers.api_key` 列。
  - **请求日志**：`api_key_request_logs` 增加 `provider_key_id`、`provider_key_label`、`provider_key_fingerprint` 字段，便于追踪实际使用的上游密钥。

  ### Proxy

  - **密钥调度**（`provider-key-scheduler`）：按 `priority` 降序分批 failover；同批内 **weighted-random** 选取；单实例内存 **cooldown**（默认 60s）跳过近期失败的 key。

  ### Admin API

  - **Provider 密钥 CRUD**：`provider_api_keys` 的列表、创建、更新、删除；**`reveal`** 接口返回明文密钥（管理端鉴权）。
  - **导入预设**：文档与模板移除 API Key 占位符，改为部署后手动添加密钥的说明。

  ### Admin UI

  - **Provider 密钥管理**：掩码展示、一键复制、明文查看；Provider 页 **Import** 流程优化（[#31](https://github.com/OctaFuse/octafuse-gateway/pull/31)）。
  - **Models**：维护并展示 **input/output modalities**、**released** 日期；卡片增加 **vendor 图标**与悬停样式（[#22](https://github.com/OctaFuse/octafuse-gateway/issues/22)）。
  - **Routes**：支持 **复制配置新建** route（[#21](https://github.com/OctaFuse/octafuse-gateway/issues/21)）；Route Config 去掉按 vendor 分组的卡片布局，增加 vendor logo 与悬浮效果（[#25](https://github.com/OctaFuse/octafuse-gateway/issues/25)）；筛选导航与卡片样式优化。
  - **Gateway / Routes**：编辑区按钮布局调整（Duplicate 等操作更易达）。

  ### 模型与 Provider 预设

  - **新增**：Claude Fable 5、glm-5.2、gpt-5.4-mini 等静态数据。
  - **更新**：阿里云阶梯价调整；Anthropic / ByteDance / Xiaomi 展示名规范化；各 vendor **modalities** 与 **release date** 修正。

  ### 部署注意

  - 须按顺序执行迁移 **`0004_provider_api_keys`** → **`0005_drop_providers_api_key`**（D1 / Postgres / MySQL 均已提供）；先部署能读写 `provider_api_keys` 的代码再应用 `0005`。

## 1.3.0

### Minor Changes

- [#19](https://github.com/OctaFuse/octafuse-gateway/pull/19) [`54b9c7d`](https://github.com/OctaFuse/octafuse-gateway/commit/54b9c7dc70f2960cf09f732e8e32b1652cd5f5b2) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Admin UI

  - **模型页**：新增 vendor 侧边栏筛选；支持 metadata 摘要展示与详情预览模态框。
  - **路由页**：新增 vendor / provider 筛选导航；按 vendor、provider、status 分组与计数。
  - **Provider 页**：移除未使用的操作项，界面更简洁。

## 1.2.0

### Minor Changes

- [`aacee2d`](https://github.com/OctaFuse/octafuse-gateway/commit/aacee2d7060b6c2b45074841bcb62d7b0475ecb5) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy / 公开 API

  - **新增 `GET /catalog/models`**：无需 API Key 的运行时模型目录发现；按 active 路由聚合 `upstream_protocol`，支持 `route_groups` CSV 过滤。
  - **重构 `GET /v1/models`**：抽取 `model-list-parse` 与 `public-models` 服务；`model_info` 增加 **`description`**，展示价由 `pricing_profile.tiers` 最低 input 档派生；移除 **`supports_images`** 字段。
  - **上游错误处理**：Chat / Messages / Gemini 路由统一使用 `materializeNonOkResponse`；请求日志 `error_message` 从上游 JSON 体提取更可读摘要。

  ### Admin UI

  - **模型 / Provider 页**：「备注」统一为「**描述**」；Provider 列表拉取后排序。
  - **Provider 复制**：新增复制按钮与 `suggestDuplicateProviderId`，模态框预填源 Provider 配置。
  - **系统配置页**：Master Key / Webhook 支持 Show/Hide；成功提示与错误处理优化。

  ### 模型与 Provider 预设

  - **新增预设**：Tencent（Hy3 preview）、MiniMax M3 等。
  - **更新定价与参数**：DeepSeek、Xiaomi、Anthropic、Google、Moonshot、OpenAI 等 context window / max_tokens / 阶梯价。
  - **预设结构整理**：合并 model preset 导入、精简 `model-vendors.json` 标签、移除未使用的 vendor 文件。

  ### Schema

  - 从 models 相关 API 与 Drizzle/baseline 中移除 **`supports_images`**（仅 baseline 变更）。

  ### 文档与运维

  - **API 文档**：区分公开 **`/catalog/models`**、用户 **`/v1/models`** 与 Admin **`/admin/models`**。
  - **README（中英文）**：本地开发、Docker / Cloudflare 部署与 API Key 配置说明增强。
  - **Zeabur**：migrate 镜像明确为 **一次性 Job**；新增 `zeabur-migrate-once.sh` 与 `docker/entrypoint.migrate.sh` 调整。

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

## 1.0.2

### Patch Changes

- [`a6b0107`](https://github.com/OctaFuse/octafuse-gateway/commit/a6b0107d5dd5e84423d9528da1a0165db56160d8) Thanks [@dyc87112](https://github.com/dyc87112)! - 1. 调整 dockerfile 的位置以适应一些 PaaS 的自动化部署流程 2. 优化 dockerfile 中的安全漏洞问题 3. 优化 docker example 文件

## 1.0.1

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

## 0.2.2

### Patch Changes

- [#10](https://github.com/OctaFuse/octafuse-gateway/pull/10) [`cbcdbec`](https://github.com/OctaFuse/octafuse-gateway/commit/cbcdbec39047e907ac718050a7d90428c7b5c6ce) Thanks [@dyc87112](https://github.com/dyc87112)! - always create and push root **vX.Y.Z** after `changeset tag` (private workspace default skips `v*` tags)

## 0.2.1

### Patch Changes

- [#8](https://github.com/OctaFuse/octafuse-gateway/pull/8) [`ef46a21`](https://github.com/OctaFuse/octafuse-gateway/commit/ef46a216662527fed64084243b1bacc16dfd0adf) Thanks [@dyc87112](https://github.com/dyc87112)! - release pipeline: inject PAT into checkout/git push for tags, add Docker workflow concurrency, embed CHANGELOG section in GitHub Release notes

## 0.2.0

### Minor Changes

- [#4](https://github.com/OctaFuse/octafuse-gateway/pull/4) [`c83fa69`](https://github.com/OctaFuse/octafuse-gateway/commit/c83fa6977568448988805b9a06f976df9b75d732) Thanks [@dyc87112](https://github.com/dyc87112)! - first release

## 0.1.1

All notable changes to this project are recorded via [Changesets](.changeset/README.md) and merged into this file on each **Version Packages** release PR.

## 0.1.0

Baseline before automated Changesets entries; see git history for prior work.
