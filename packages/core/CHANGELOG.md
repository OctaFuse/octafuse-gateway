# @octafuse/core

## 2.2.0

## 2.1.2

### Patch Changes

- [#85](https://github.com/OctaFuse/octafuse-gateway/pull/85) [`9b7a9f6`](https://github.com/OctaFuse/octafuse-gateway/commit/9b7a9f6ddea090970d35f9b71976becd936c73f0) Thanks [@dyc87112](https://github.com/dyc87112)! - 优化 Admin 路由与 Provider 体验，请求日志补充外部系统字段，并修复干净仓库下 Admin 本地开发（Turbopack）无法解析 core 源码的问题。

  ### Admin

  - **路由列表 / 拓扑**：同优先级内按状态、权重与名称稳定排序；因子状态芯片与无障碍文案完善。
  - **路由详情**：自定义参数展示与 tooltip；布局响应式调整。
  - **Provider 卡片**：布局与按钮交互优化；移除未使用的 endpoint 复制入口。
  - **请求日志**：补充展示 `external_system`，便于区分外部系统来源。
  - **本地开发**：修复 Turbopack 下 `@octafuse/core` 源码解析，干净 checkout 可运行 `dev:admin`。

  ### Core

  - **请求日志**：读写路径补充 `external_system` 字段（D1 / Postgres / MySQL）。

  ### 升级说明

  - 数据库迁移：无
  - 配置变更：无
  - 兼容性影响：无（纯增量字段与 Admin UX）
  - 建议操作：更新 proxy / admin / migrate 三镜像后滚动重启

## 2.1.1

### Patch Changes

- [`8e1f634`](https://github.com/OctaFuse/octafuse-gateway/commit/8e1f634d846cc97da4e1e47456e141103fc1d7e6) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy

  - **User+model 熔断**：敏感内容与普通上游 400 共用 `20s → 1m → 3m → 5m → 10m` 退避（不区分请求体）；短路用 code 区分类别（`circuit.sensitive_content` / `circuit.client_error`）。替换原独立 sensitive-content 熔断实现。
  - **Images / Audio**：退出普通 400（`client_error`）熔断，仅保留 sensitive_content 触发。
  - **Failover**：循环内复查已熔断 provider；401/403 provider 冷却由 10min 调整为 5min。
  - **错误码契约**：网关自造 / 熔断 / 上游分类错误增加固定 `code`（`gateway.*` / `circuit.*` / `upstream.*`）与响应头 `X-OctaFuse-Error-Code`；body 既有 `error` 形状纯增量。
  - **诊断**：`gateway.upstream_request_failed` 的 message 附带原始 fetch 错误摘要（与 `route_resolution_failed` 一致），便于客户端与 Langfuse 排查。

  ### Admin

  - **阿里云模型预设**：新增正式版 `qwen3.8-max` 与 `qwen3.7-flash`；同步修正 `qwen3.8-max-preview` 的缓存价 / 模态 / 输出上限；`qwen3.7-plus` / `qwen3.7-max` 的 `max_tokens` 对齐为 `128000`。

  ### 文档

  - 更新 API 与 `proxy-request-lifecycle` / `runtime-data` 说明，覆盖错误码头与 user+model 熔断行为。

## 2.1.0

### Minor Changes

- [`3a53d2f`](https://github.com/OctaFuse/octafuse-gateway/commit/3a53d2f1b3e11308e7d5497b895978d55c37f152) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy / Core

  - **Tools / AI Detection**：新增 `POST /v1/tools/ai-detection`（腾讯 TMS 引擎；按字符计费单元扣预算）。
  - **Tools / Pricing**：新增只读 `GET /v1/tools/pricing`（返回工具单价；不含引擎密钥）。
  - **工具三账本定价**：web-search / web-fetch / web-deep-search / ai-detection 统一 **metered / standard / charged**；`cost` 为 charged 兼容别名。
  - **`@octafuse/tool-engines`**：抽出共享引擎客户端包（web-search / web-fetch / web-deep-search / ai-detection）；Proxy 与 Admin Playground 共用，避免 Admin 直接依赖 Proxy 源码。

  ### Admin UI

  - **Tools**：配置页全局 secrets 显隐；调用记录展示 std / charged / metered / profit 与 engine provider。
  - **Request Logs**：区分 agent tools 与上游模型，展示引擎 provider。
  - **Playground / Simulator**：支持 AI Detection 联调。
  - **Providers**：删除时若仍被 `model_routes` 引用则拒绝，避免断路由。

  ### 文档 / 工程

  - 更新用户 / 开发者 / 运维文档与 API 说明（工具定价、AI Detection、route topology）。
  - Docker 构建纳入 `packages/tool-engines`；新增 docker-compose smoke workflow。

## 2.0.0

### Major Changes

- [#74](https://github.com/OctaFuse/octafuse-gateway/pull/74) [`c8b4372`](https://github.com/OctaFuse/octafuse-gateway/commit/c8b4372217383d550cf47874e3c1416de8b54b6f) Thanks [@dyc87112](https://github.com/dyc87112)! - 单键化 Provider（一个 provider 一把 api_key）并引入可切换路由策略。

  **破坏性变更**

  - 删除 `provider_api_keys` 表与 Admin `/providers/:id/keys*` API；密钥写入 `providers.api_key`，启用状态为 `providers.status`
  - 删除网关侧 per-key RPM/TPM/并发软限流与粘性 key 绑定（`models.sticky_config`）
  - `models.sticky_config` 替换为 `models.route_policy`；`model_routes` 新增 `weight`
  - 新增全局 `system_config.ROUTE_STRATEGY`（默认 `affinity`）与四策略：`affinity` / `weighted_random` / `strict` / `round_robin`
  - 新增路由拓扑 v2：`model_surfaces`（公开请求入口）→ `route_pools`（故障转移池）→ `model_routes`（上游 Target）；支持 request / upstream operation、Pool 级策略与路由追踪字段
  - Proxy 调度改为 priority 分层 + 策略排序 + provider 维度熔断；请求日志 `provider_key_*` 列语义改为 provider id/name/fingerprint

  上线前请用 `scripts/db/export-provider-api-keys.mjs` 导出密钥，再依次应用迁移 `0015_single_provider_key.sql` 与 `0016_route_surfaces_pools.sql`。详见 `docs/operators/migrations/single-provider-key-cutover.md`。

## 1.11.0

### Minor Changes

- [`6a236f0`](https://github.com/OctaFuse/octafuse-gateway/commit/6a236f02aace3619644a79c7dad96a50ad1f01fb) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy / Core

  - **Audio Transcriptions**：新增 OpenAI 兼容 `POST /v1/audio/transcriptions`（multipart；预算预检、OpenAI 路由故障转移；请求日志不落音频二进制）。
  - **Audio 计费双模式**：`pricing_profile.audio_billing_mode` 支持 **`per_second`（按时长）** 与 **`token`（按上游 usage）**；日志 `billing_kind` 为 `audio_per_second` / `audio_tokens`；迁移 **`0014_request_log_audio_billing`**（`audio_duration_seconds`）。
  - **`GET /v1/models`**：`kind` 支持 `audio`（默认仍仅 LLM；`kind=all` 不过滤）。
  - **Provider endpoints**：OpenAI 能力含 `audio.transcriptions`（可由 `base` 派生或显式完整 URL）。

  ### Admin UI

  - **Models / Routes**：Kind 支持 **Audio**；模型表单与路由计费面板支持 Audio 双模式目录价。
  - **Playground / Simulator**：支持语音转写联调（上传音频 → `/v1/audio/transcriptions`）。
  - **Request Logs**：展示 Audio 计费种类与时长 / token 审计信息。
  - **Providers**：端点能力识别含 audio；完善 Provider 身份与导入体验。

  ### 模型 / Provider 预设

  - **Audio**：`openai-audio.json`（`whisper-1` 按秒；`gpt-4o-mini-transcribe` / `gpt-4o-transcribe` / `gpt-4o-transcribe-diarize` 按 token）。
  - **新增**：Claude Opus 5；七牛 / OpenCode / ZenMux 等 Vendor 预设与图标；Catalog 本地化描述与链接；图像模型目录价与文案校正。

  ### 文档

  - 更新 README（多语言）与用户 / 开发者 / 运维文档，覆盖 Audio 双模式计费、Admin 验收与 Cloudflare 部署说明。

## 1.10.2

## 1.10.1

### Patch Changes

- [`c6e475b`](https://github.com/OctaFuse/octafuse-gateway/commit/c6e475b822dd1d4d753cf9a251ca79d71e47f192) Thanks [@dyc87112](https://github.com/dyc87112)! - Fix MySQL 8.4 seed migration ambiguity; pin Admin to `@opennextjs/cloudflare@1.19.4` (upstream unused-OG bundle fix) and set `NEXT_PRIVATE_MINIMAL_MODE=1` so Workers skip the broken middleware-manifest require—no `patch-package` needed.

## 1.10.0

### Minor Changes

- [`336b292`](https://github.com/OctaFuse/octafuse-gateway/commit/336b2925ea09b74b41f180b6fb67ba4fcfba38ed) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy / Core

  - **Tools / Web Fetch**：新增 **web-fetch** 工具接入与调用计费（[#65](https://github.com/OctaFuse/octafuse-gateway/issues/65)）。
  - **Tools / Web Deep Search**：新增 **web-deep-search** 工具接入（含 Firecrawl / Jina 等 Provider）（[#66](https://github.com/OctaFuse/octafuse-gateway/issues/66)）。
  - **Image 计费**：image 模型支持按 **token** 与按 **per image** 两种计费方式（[#63](https://github.com/OctaFuse/octafuse-gateway/issues/63)）。
  - **Images**：客户端取消时按预检扣费回退；上游超时拉长至 5 分钟。
  - **错误排查**：model not found 时输出 model id，便于定位。

  ### Admin UI

  - **Tools**：完善 web-fetch / web-deep-search 配置与文档对齐。
  - **Providers**：新建/编辑页优化；API Key 创建与编辑时可见；OpenAI 协议下 chat/image 通用 `baseUrl` 模板；Import 价格按系统币种显示。
  - **Models**：卡片布局更紧凑；Route 页可直接打开 model 编辑框。
  - **Playground / Simulator**：支持 image 模型两个不同端点的请求测试。
  - **Analytics**：Time range 增加今天/本周/本月快捷选择，默认 today。
  - **国际化**：优化语言切换组件。

  ### 模型预设

  - **新增**：火山方舟 Seedream 系列；千问 token plan；qwen3.8-max-preview（暂对齐 3.7-max）。
  - **重构**：image 模型静态数据独立文件；Seedream 模型名称调整。

  ### 文档

  - 更新 README 与用户/开发者文档，覆盖 web-fetch、web-deep-search 与相关配置说明。

## 1.9.0

### Minor Changes

- [`d2c2ee9`](https://github.com/OctaFuse/octafuse-gateway/commit/d2c2ee943acdb4421102b0dc45eaa0bcef0ce509) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy / Core

  - **OpenAI 生图协议**：新增图像生成上游协议支持（[#60](https://github.com/OctaFuse/octafuse-gateway/issues/60)）。
  - **Tools / Web Search**：Proxy 规划工具调用路径；新增 **web-search** 工具，支持多 Provider 与调用计费。
  - **Web Search Providers**：接入 Tavily、腾讯云 WSA、阿里云 Cleversee；优化计费字段命名与配置结构。
  - **`GET /v1/models`**：支持可选 `kind` 参数过滤模型类型（`llm` / `image` / `all`）。

  ### Admin UI

  - **Tools**：新增 Tools 板块，支持工具配置与工具调用查询；完善 web-search 配置页。
  - **Providers**：能力徽章与导入体验增强（OpenAI / Anthropic / Gemini 端点）；`baseUrl` 改造。
  - **Models**：新建/编辑表单同时支持 LLM 与 image 模型；修正 image 模型 pricing / 计费文案；卡片布局紧凑化。
  - **Routes**：编辑页调整「Provider model name」与「Upstream protocol」字段顺序。
  - **Analytics**：Provider 分析页增加缓存命中率统计列；成功率 / 缓存命中率样式区分；计费相关列名国际化（Std → Standard）。

  ### 模型预设

  - **新增 / 修正**：kimi-k3、step-3.7-flash；修正多模型 `context-window` / `max-token` 数据。

  ### 文档

  - 完善计费说明（supplier cost / catalog list price / user charge、日时段调价）。
  - 优化本地开发与 Cloudflare 部署文档、README 快速上手。

## 1.8.0

### Minor Changes

- [`ca03995`](https://github.com/OctaFuse/octafuse-gateway/commit/ca0399517901cebfe73fce5f202121a6eec9d24a) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy / Core

  - **动态调价（Pricing Schedule）**：支持按日时段配置计价倍率（如高峰期 2x），计费与审计对齐（[#56](https://github.com/OctaFuse/octafuse-gateway/issues/56)）。

  ### Admin UI

  - **Routes**：日时段调价编辑器与路由计价面板；动态调价配置体验完善。
  - **国际化**：补全未翻译文案，清理无用 i18n 配置；Providers 等页面翻译优化。
  - **Providers**：去掉无用顶部内容，布局精简。
  - **Audio Logs**：筛选项布局与多选筛选（事件来源 / 事件原因）；用户变更详情列优化；修复 metadata 从 null 变为有值时表格不展示的问题。
  - **Playground / Simulator**：页面交互与展示优化。

  ### 模型预设

  - **新增**：gpt-5.6 系列模型静态数据。

  ### 文档

  - 更新 README。

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

## 0.2.1

## 0.2.0

## 0.1.1

### Patch Changes

- [`b873e9d`](https://github.com/OctaFuse/octafuse-gateway/commit/b873e9d7be95893e746d2b59de1c6a406e28166c) Thanks [@dyc87112](https://github.com/dyc87112)! - Add Changesets (fixed single version line), `release.yml` + tag-driven Docker builds with GitHub Release digests, and CI to enforce matching `package.json` versions. Include root `octafuse` in npm workspaces for tooling. No change to gateway runtime behavior.
