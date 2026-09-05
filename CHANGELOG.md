# Changelog

## 2.9.0

### Minor Changes

- [#156](https://github.com/OctaFuse/octafuse-gateway/pull/156) [`f4544a2`](https://github.com/OctaFuse/octafuse-gateway/commit/f4544a22bb647826ca4e92fb58d27a361ae898a2) Thanks [@dyc87112](https://github.com/dyc87112)! - OctaFuse Gateway v2.9.0 重点完善流量治理、用量观测和管理体验：管理员可以分别限制用户与单把 API Key 的请求频率，通过密钥分析和入口域名记录定位流量来源；管理后台总览、路由调试与 Cloudflare 多域名部署也同步升级。

  ### Proxy

  - **用户与 API Key 双层限流**：用户级 RPM 控制该用户所有 Key 的合计请求量，Key 级 RPM 控制单把密钥。两层独立执行，并按当前时刻向前回溯 60 秒，不会在 UTC 自然分钟切换时重置。
  - **清晰的超限反馈**：超过任一层上限时返回 `429 gateway.rate_limited`，并通过 `Retry-After` 告知再次尝试前的等待时间；`GET /v1/me` 不参与两层计数。
  - **入口与密钥观测**：请求日志新增 `ingress_host`，用于记录请求实际进入的 Host，但不参与访问控制；写入请求用量时同步更新 API Key 的 `last_used_at`。
  - **路由自定义请求头**：`custom_params.headers` 作为上游 HTTP Headers 发送，不再混入 JSON 请求体；鉴权、Host、Content-Length 等受保护请求头不会被自定义值覆盖。
  - **默认参数合并**：除 `headers` 外的 `custom_params` 继续作为请求体默认值，并与客户端 JSON 深度合并；客户端显式值优先，因此该配置不能作为强制参数上限。
  - **计费记录一致性**：Chat、Responses、Anthropic Messages 和 Gemini 共用结构化的计费记录流程，统一整理用量、错误和上游请求 ID 后再写入日志；现有计费口径保持不变。
  - **Images Edits 兼容**：单张参考图使用 `image`，多张参考图使用 `image[]`，提升不同 OpenAI 兼容上游的接收兼容性。

  ### Admin

  - **限流配置**：用户详情可设置用户合计 RPM，用户列表会同步展示该限制，Keys 页面可设置单 Key RPM；空值表示不限，`0` 表示拒绝所有计次请求，小数和负数会被界面与 Admin API 一致拒绝。
  - **运营总览**：Dashboard 集中展示请求量、成功率、平均延迟、用户费用、趋势、热门模型、活跃用户、近期请求和错误信息。
  - **密钥分析**：新增按 API Key 汇总的请求量、Token、费用和最近使用时间；用户请求日志支持按 `api_key_id` 筛选，便于定位具体客户端或应用。
  - **分析页面对比**：模型、供应商和用户用量页面支持同时展开多条明细，减少逐项对比时反复开合。
  - **路由调试**：路由编辑将上游请求头与 JSON 默认参数分开配置；Playground 可预览最终发送的请求头和上游请求体，鉴权类敏感请求头会自动脱敏。
  - **供应商与模型目录**：新增 SiliconFlow 国际站导入模板并区分国内、国际端点，在供应商导入和配置界面补充平台或密钥页面快捷入口；新增 Gemini 3.8 Flash 模型预设，为 DeepSeek V4 Pro / Flash 的内置预设补齐工作日官方高峰时段，并修正 23 个阿里云百炼模型的 USD / CNY 预设价格。
  - **自托管管理后台修复**：修复 Node / Docker 管理后台经反向代理访问时，创建或修改集成密钥可能被同源校验误判为 `403` 的问题；非同源写操作仍会被拒绝。
  - **交互一致性**：多处保存、删除和异常反馈统一使用页面通知与确认对话框。

  ### Core / 部署

  - **迁移 0028**：`users.rate_limit` 保存用户共享限流，`api_keys.rate_limit` 保存单 Key 限流；`api_key_request_logs.ingress_host` 保存入口 Host，并增加 `ingress_host + created_at` 查询索引。D1、Postgres、MySQL 语义一致。
  - **滚动窗口实现**：Key 与用户窗口分别维护过去 60 秒的请求时间，跨 UTC 自然分钟不会重置；实际超限层决定本次 `Retry-After`。
  - **Cloudflare 多域名**：`PROXY_CUSTOM_DOMAIN` 与 `ADMIN_CUSTOM_DOMAIN` 支持以逗号分隔多个自定义域名；空白项会被忽略，重复域名会去重，单域名配置继续兼容。
  - **计价展示修正**：同优先级、同权重路由在展示代表价格时优先采用当前综合倍率更低的路由，使目录折扣更贴近可用价格；实际请求仍遵循原有选路策略。

  ### 文档

  - **限流与观测**：补充用户 / Key 双层 RPM、滚动窗口、`Retry-After`、`GET /v1/me` 豁免、单实例软上限与入口 Host 的接口和数据模型说明。
  - **路由请求配置**：明确自定义 Headers、请求体默认参数、客户端值优先规则和受保护请求头边界。
  - **Cloudflare 部署**：补充多域名环境变量格式、生成配置和部署行为。

  ### 升级说明

  - **数据库迁移**：必须应用 **0028**；新列均可空，未配置 `rate_limit` 的存量用户与 API Key 保持不限流。
  - **发布顺序**：备份数据库后先运行 v2.9.0 migrate，再滚动更新同版本 Proxy 与 Admin。回退旧版本时可保留新增列，无需立即删除。
  - **限流边界**：RPM 计数默认保存在每个 Proxy 进程 / isolate 内存中；Node 单进程接近精确，多进程、多副本或 Cloudflare 多 isolate 场景属于软上限，重启会重置窗口状态。
  - **配置兼容**：现有客户端 API 路径和鉴权方式保持不变，旧的单域名环境变量继续有效。用户级与 Key 级 RPM 不要求互相复制或满足大小关系。
  - **路由参数**：`custom_params.headers` 仅用于上游请求头；其余 `custom_params` 是默认请求体参数。客户端显式参数优先，不能仅凭此配置实现强制封顶。
  - **建议核验**：验证用户与 Key 两层 RPM、429 `Retry-After`、`GET /v1/me` 豁免、API Key 最近使用时间与分析数据、入口 Host 日志、自定义请求头，以及既有 Chat / Responses / Messages / Gemini / Images / Audio 路由。

## 2.8.0

### Minor Changes

- [#137](https://github.com/OctaFuse/octafuse-gateway/pull/137) [`654d29a`](https://github.com/OctaFuse/octafuse-gateway/commit/654d29a3f4d43cd0d8911ec43572540e0296e774) Thanks [@dyc87112](https://github.com/dyc87112)! - OctaFuse Gateway v2.8.0 重点升级额度、协议转换和峰谷计价：周期额度与永久额度分开记账，可同时承载订阅与加购；协议适配统一由注册表描述；模型官方时段与路由倍率可组合计算，并通过模型列表接口向前台输出当前折扣。同时，本版本打通阿里云百炼千问 / 万相的 OpenAI Images 调用路径，并补齐 Node / Docker 环境的实时语音调试能力。

  ### Proxy

  - **永久额度扣费**：先扣周期额度，不够的差额扣永久额度；`budget_max` 非空时总剩余 = 周期剩余 + wallet 余额，总剩余 ≤ 0 才 403。周期上限为 0 但 wallet 仍有余额时可继续请求。请求日志增加 `charged_wallet_cost`。
  - **DashScope 生图转换**：客户端仍打 `POST /v1/images/generations`；适配器 `dashscope-image-qwen` / `dashscope-image-wan` 改写为 DashScope `images.generations.multimodal`。千问 / 万相按张计费；千问 Pro 从响应 usage 反推 1K/2K 档。默认返回 URL，`response_format=b64_json` 时下载 OSS 再转 base64。
  - **额度预检**：Images / Audio / Tools 预检与实扣使用同一套周期 + 永久总余额，不再把 `budget_max=0` 误判为超额。
  - **模型列表价格信息**：`GET /v1/models` 与公开的 `GET /catalog/models` 按路由组返回 `discounts`，包含当前综合倍率、完整时段、业务时区和代表路由信息；`Discount.<group>:<factor>` 标签改为按当刻结果自动派生。
  - **峰谷计价合成**：目录标准价先乘模型 `pricing_profile.schedule` 的官方时段倍率，再分别乘路由的用户计费 / 供应成本倍率。模型存在官方时段时，路由须沿用相同的时段形状，只配置本路由倍率，避免上下游峰谷窗口错位。

  ### Admin

  - **永久额度加额**：新增 `POST /api/admin/users/:id/wallet/credit`（`kind` + `external_ref` 幂等）。用户详情拆开展示周期额度与永久额度；加购不要再写入 `budget_max`。`PATCH` 仍可修正 wallet 绝对值。
  - **DashScope 生图联调**：Playground / Simulator 对千问 / 万相转换路由使用 OpenAI Images JSON；调试台改写成 multimodal，模拟器走 Proxy `/v1/images/generations`。
  - **路由适配器**：下拉项从统一注册表生成，直接标明客户端协议 / 端点到上游协议 / 端点的映射；选中后自动回填匹配字段，避免透传与转换混淆。
  - **实时语音**：DashScope realtime ASR 默认改用浏览器麦克风；Docker Admin 运行层带上 `ws`，Node 入口为 `node-server.mjs`，调试台实时 ASR 不再 501。
  - **模型预设**：新增 `hy4-preview`、`qwen3.8-flash`、`glm-5.3-flash`。目录导入不再写入 `model_tags`，标签由运营导入后自行维护。
  - **模型 / 路由编辑**：模型页可维护官方时段倍率；路由页继承模型时段形状，并分别配置用户计费与供应成本倍率，同时预览每个时段的实际价格。

  ### Core

  - **统一协议适配注册表**：适配器 ID、客户端入口、上游协议 / 端点、模态、交互形态与计费口径集中到 `ADAPTER_REGISTRY`；配置层适配器与运行时 driver 分离，一个 driver 可服务多个稳定适配器 ID，便于后续扩展新模型协议。
  - **定价与展示口径统一**：目录标准价、模型官方时段和路由时段使用同一套解析与命中逻辑；模型列表的 `discounts` 与真实计费共用倍率语义，但仅用于展示，不参与替代账单计算。
  - **迁移 0027**：`users` 增加 `wallet_granted` / `wallet_spent`；`user_audit_logs.dedup_key` 唯一约束；`api_key_request_logs.charged_wallet_cost`。回填把 `budget_max − max(spent, base)` 的剩余迁入 wallet；`budget_max IS NULL` 与到期清零行（`max=0 AND period=none`）不抬回 `budget_base`；超支欠账钳到 0。

  ### 文档

  - **永久额度**：用户接口、Admin API、数据模型与请求生命周期写明先周期后永久、加额幂等与 0027 回填。
  - **协议与计价**：新增适配器 / driver 架构说明，补齐模型官方时段、路由倍率以及 `/v1/models` / `/catalog/models` 的 `discounts` 字段语义。
  - **DashScope 生图**：新增架构文档，标明 OpenAI Images 入口、转换适配器、按张计费与验收路径。
  - **Docker Admin**：standalone 入口、`ws` 拷贝与实时 WebSocket 约束写入部署与构建说明。

  ### 升级说明

  - **数据库迁移**：必须应用 **0027**；D1、Postgres 与 MySQL 语义一致。上线前分别使用 `0027-user-wallet-credit-audit.d1.sql`（D1）或 `0027-user-wallet-credit-audit.sql`（Postgres / MySQL）只读核对。
  - **发布顺序**：v2.8.0 的 Proxy / Admin 会直接读取 0027 新列，不能先连接未迁移的数据库。请在维护窗口内备份并暂停请求及 Admin 写入，执行 0027 后立即部署同版本 Proxy / Admin；禁止新旧版本混跑。确认服务正常后，门户再切到 `POST /api/admin/users/:id/wallet/credit`，不要再通过累加 `budget_max` 发放购买额度。
  - **配置变更**：阿里云千问 / 万相生图需路由适配器选 `dashscope-image-qwen` 或 `dashscope-image-wan`，请求协议保持 `openai` / `images.generations`。Token Plan 须显式覆盖 `images.generations.multimodal`。模型配置了官方时段后，既有路由时段必须调整为相同的窗口与星期形状。
  - **接口影响**：`GET /v1/models` 与 `GET /catalog/models` 增加 `discounts`，现有字段保持兼容。Chat / Messages / Gemini / Audio / Responses 入口不变。
  - **兼容性影响**：额度判定改为周期额度与永久额度的总余额；周期用尽但 wallet 有余额的用户将从 403 变为可继续调用。已导入模型行不会被静态目录覆盖。
  - **建议操作**：部署后核验 0027 回填、wallet 加额幂等与请求日志 `charged_wallet_cost`；检查模型 / 路由时段的实际价格预览和模型列表 `discounts`；再用 Playground / Simulator 冒烟 DashScope 生图、实时 ASR（麦克风）及既有 chat / messages / gemini / images / audio。

## 2.7.0

### Minor Changes

- [#124](https://github.com/OctaFuse/octafuse-gateway/pull/124) [`7a7adfe`](https://github.com/OctaFuse/octafuse-gateway/commit/7a7adfe7cc76ec60d392b41efbda3145a07e9f86) Thanks [@dyc87112](https://github.com/dyc87112)! - OctaFuse Gateway v2.7.0 为用户增加按模型维护的计费倍率，新增 DashScope 同步多模态 ASR 入口，并让每日时段可按工作日 / 周末分别定价；管理后台同步整理用户、请求日志与供应商目录。

  ### Proxy

  - **用户计费倍率**：LLM / Images / Audio 在路由 Charged cost 之后再乘 `users.charged_cost_factors[models.id]`；只改最终 `charged_cost` 与预算累加，供应成本与目录标准价不变。智能体工具不应用。Images / Audio 预检与实扣使用同一最终金额。`pricing_audit` v4 可带 `user_charged_factor`（未命中为 `null`）。
  - **DashScope 同步 ASR**：新增 `POST /v1/dashscope/services/aigc/multimodal-generation/generation`，按 `dashscope` + `audio.transcriptions.multimodal` 透传上游原生 JSON，并以 `usage.duration` / `usage.seconds` 按秒计费。
  - **分时计价按星期**：时段窗口可写可选 `days`（ISO 1=周一 … 7=周日），未写则每天循环；跨午夜时 `days` 锚定窗口开始日。工作日 / 周末可配置不同倍率。

  ### Admin

  - **Charged cost factors**：`POST` / `PATCH /api/admin/users` 可写入 `{ "<models.id>": number }`；未知模型 ID、负数拒绝。用户详情页按模型 ID 增删行，随计划一并保存；仅改该字段时审计 `reason_code` 为 `admin_patch_charged_cost_factors`。
  - **用户列表**：额度改为已消费 / 上限进度条，并展示周期重置、Keys 激活数 / 总数与用户计费倍率摘要；筛选与排序扫描效率同步整理。
  - **请求日志**：入站 / 上游协议路径、供应商与路由组并列展示，并按模型类型与操作打功能标签。
  - **调试台 / 模拟器**：请求体预览更完整；补齐 DashScope 同步 ASR 与 realtime 操作模板校验。
  - **供应商导入**：新增超算互联网 SCNet 模板（OpenAI chat + Anthropic Messages）。
  - **模型预设**：阿里云百炼目录收录 `qwen-image-3.0` / `qwen-image-3.0-pro` / `wan2.7-image` / `wan2.7-image-pro`（按张计费）。上游仍是 DashScope 原生接口，导入后不能直接打 `/v1/images/generations`。
  - **路由编辑**：每日时段编辑支持按星期选择，并展示工作日 / 周末提示。

  ### Core

  - **迁移 0026**：`users` 增加 `charged_cost_factors`（D1 / Postgres / MySQL）。鉴权 JOIN 带上该列，请求路径不再额外查用户。
  - **分时计价**：`pricing-schedule` 解析、校验与命中逻辑支持可选 `days`，并写入 `pricing_audit.schedule.local_weekday`。

  ### 文档

  - **用户计费倍率**：用户接口、Admin API 与流式计费说明补齐倍率相乘、预检与 `pricing_audit` v4。
  - **DashScope 音频**：同步多模态 ASR 入口、adapter 与 Playground / Simulator 联调路径写入架构与用户接口。
  - **分时计价**：时段 `days` 与业务时区下的星期命中规则写入时间与计费文档。
  - **文生图目录**：收录阿里云百炼当前代图片模型，并标明尚未接入 OpenAI Images 驱动。

  ### 升级说明

  - **数据库迁移**：必须应用 **0026**；三种数据库语义一致。未配置 `charged_cost_factors` 的用户计费行为与升级前一致。
  - **发布顺序**：拉取同版本的 proxy、admin 和 migrate 镜像；按现有发布流程执行一次 migrate Job，然后滚动重启 proxy 和 admin。
  - **配置变更**：需要按用户打折或加价时，在管理后台用户详情或 Admin API 写入对应目录模型 ID 的倍率。分时窗口若要区分工作日 / 周末，为窗口补 `days`；省略则仍每天生效。
  - **兼容性影响**：现有 Chat、Messages、Gemini、Images、Audio 和 Responses 接口保持不变。DashScope 同步 ASR 为增量入口。未写 `days` 的旧时段配置继续每天循环。阿里云图片预设仅进目录，不会自动打通 `/v1/images/generations`。
  - **建议操作**：部署后核验迁移 0026、用户计费倍率保存与请求日志中的 `user_charged_factor`；用 Playground / Simulator 冒烟 DashScope 同步 ASR 与既有 chat / messages / gemini / images / audio；如需新图片目录，再导入阿里云预设，但不要期待 OpenAI Images 入口可用。

## 2.6.0

### Minor Changes

- [#118](https://github.com/OctaFuse/octafuse-gateway/pull/118) [`9cf11c9`](https://github.com/OctaFuse/octafuse-gateway/commit/9cf11c904333aa35377d312fabd229350c71a95f) Thanks [@dyc87112](https://github.com/dyc87112)! - OctaFuse Gateway v2.6.0 重点完善项目级 Vertex AI 的服务账号鉴权与文生图计费，优化 Admin 路由、Playground 和 Simulator 的使用体验，同时新增多项供应商导入模板，并更新 Gemini 3.1 Flash-Lite 的模型 ID。

  ### Proxy

  - **项目级 Vertex AI 鉴权**：在供应商凭证栏粘贴 GCP 服务账号 JSON，Gateway 会在请求发出前自动换取 OAuth 2.0 access token。Vertex AI 的 OpenAI 兼容端点（`.../endpoints/openapi`）与原生 Gemini 端点均通过 `Authorization: Bearer` 鉴权，不会将服务账号 JSON 拼接到 `?key=` 或原样发送给上游。
  - **OpenAI 模型前缀**：通过 Vertex AI 的 OpenAI 兼容端点调用时，如果 `provider_model_name` 缺少 `google/`，Gateway 会自动补齐；原生 Gemini 端点保持原模型名。
  - **文生图计费**：通过 `image_billing_mode` 明确区分按 Token（`token`）和按张（`per_image`）计费；客户端取消、Gateway 超时以及明确的上游错误均不扣费。仅包含旧版 `image` 块但未声明计费模式的配置不再计费。
  - **每日时段计费**：新增 `schedule.mode: "override"`。命中每日时段后直接使用该时段的倍率，未命中时使用默认倍率；未设置 `mode` 的旧配置继续采用倍率叠乘规则。

  ### Admin

  - **Vertex AI 导入模板**：新增项目级 Vertex AI 模板；导入后替换项目 ID，并在供应商凭证栏粘贴 GCP 服务账号 JSON。Playground 使用与 Proxy 相同的凭证解析和 access token 换取流程。
  - **Gemini 鉴权**：供应商的 Gemini 端点可选择 `query-key` 或 `bearer`；使用服务账号时自动强制采用 Bearer 鉴权。
  - **路由编辑**：优化每日时段和计费倍率的展示与编辑，明确区分默认倍率与时段覆盖倍率，并改进倍率格式和时段提示。
  - **Playground / Simulator**：Playground 增加更多 LLM 请求样例、流式响应观察和 Gemini 工具调用联调能力；Simulator 可按客户端请求入口选择协议。
  - **供应商导入模板**：新增 BytePlus、阿里云百炼国际站、Meta Model API、Cerebras、SambaNova、DeepInfra、Novita、Command Code、Hugging Face 和 Vercel 等模板，并补充相应图标与端点配置。
  - **目录与导航**：优化模型目录、侧栏导航，以及供应商图标和端点信息的展示。
  - **模型预设**：将 `gemini-3.1-flash-lite-preview` 调整为 Google 当前使用的模型 ID `gemini-3.1-flash-lite`。该模型目前仍处于预览阶段，已导入的旧模型记录不会被静态目录自动更新。

  ### Core

  - **GCP JWT**：改进服务账号私钥的 PEM 解码和 JWT 签名，提升其在 Workers 与 Node.js 环境中的兼容性和稳定性。

  ### 文档

  - **项目级 Vertex AI**：更新用户 API 和供应商导入文档，明确服务账号 JSON、OAuth access token 与 Bearer 鉴权流程；删除已废弃的双协议说明。
  - **文生图**：补充两种计费模式、取消或超时不扣费，以及旧版配置的兼容规则。
  - **界面与部署**：更新 README 截图、路由与协议配置说明，以及容器镜像发布文档。

  ### 升级说明

  - **数据库迁移**：本版本没有数据库表结构变更。对于使用内置图片模型旧价目的 Postgres 部署，可先运行 `node scripts/db/migrate-image-billing-modes.mjs --dry-run`，确认后再运行 `--apply`。该脚本只处理已知的内置模型 ID；MySQL、D1 及自定义模型需要人工核对并补充 `image_billing_mode`。
  - **发布顺序**：拉取同版本的 proxy、admin 和 migrate 镜像；按现有发布流程执行一次 migrate Job，然后滚动重启 proxy 和 admin。
  - **配置变更**：项目级 Vertex AI 请在供应商凭证栏粘贴 GCP 服务账号 JSON，并替换导入模板中的 `YOUR_PROJECT_ID`；不要将 Vertex API Key 或服务账号 JSON 写入 `?key=`。
  - **兼容性影响**：现有 Chat、Messages、Gemini、Images、Audio 和 Responses 接口保持不变。已导入的 `gemini-3.1-flash-lite-preview` 不会自动改名，可删除后重新导入或通过 PATCH 修改。仅包含旧版 `image` 块但未声明 `image_billing_mode` 的图片价目将不再扣费；包含有效 `image_*` Token 单价的旧配置仍按 Token 模式计费。
  - **建议操作**：在 Admin 中核验 Vertex AI 服务账号的导入和鉴权，并通过 Playground 与 Simulator 验证请求；检查所有文生图模型的 `token` / `per_image` 配置，以及取消或超时不扣费的行为；如需使用新的 Flash-Lite 模型 ID，再导入 `gemini-3.1-flash-lite`。

## 2.5.0

### Minor Changes

- [#102](https://github.com/OctaFuse/octafuse-gateway/pull/102) [`e659ee5`](https://github.com/OctaFuse/octafuse-gateway/commit/e659ee5b23006804a8f32f59016f1171e7590848) Thanks [@dyc87112](https://github.com/dyc87112)! - OctaFuse Gateway v2.5.0 新增 OpenAI Responses 兼容入口，并重构 Admin Routes 工作台（总览 / 按模型、未接线模型）；同步扩充 Gemini 3.7 Flash、GLM-5.3、Grok 4.6 等模型目录。

  ### Proxy

  - **OpenAI Responses**：新增 `POST /v1/responses`，按 Chat 同一套鉴权、预算、Surface 选路、failover 与异步记账透传上游；支持非流式 JSON 与 `stream=true` typed SSE。
  - **Responses 会话约束**：`previous_response_id` 仅在单一上游目标（或不会切换目标的路由池）下透传；多目标无法保证回到同一上游时返回 **409** `responses.state_route_unavailable`。当前不提供 Conversations、background retrieve/cancel 或 Chat ↔ Responses 转换。
  - **流式计费**：Responses usage 取自终态事件（`response.completed` / `response.incomplete`），计入 reasoning / cached tokens。

  ### Admin

  - **Routes 工作台**：路由页改为「总览 / 按模型」两种工作区视图；总览按请求入口汇总拓扑，按模型视图拆开单模型接线。
  - **未接线模型**：尚无启用请求入口的模型单独成组，可从拓扑连线直接补 Surface / 路由组 / 上游。
  - **路由编辑**：每日时段窗口与自定义参数编辑体验整理（含参数折叠、时段新增入口）。
  - **供应商管理**：列表改为卡片网格，支持按状态 / 协议筛选（URL 可回放）；卡片展示密钥状态与路由数；编辑弹窗按协议分页配置 endpoints（含 `responses`）。
  - **Playground / Simulator**：增加 OpenAI Responses 联调入口，可与 Chat 切换。
  - **模型预设**：新增 `gemini-3.7-flash`、`glm-5.3`、`grok-4.6`、`grok-imagine-image-2.0`；同步 DeepSeek V4 Pro 正式版规格，并为 Grok 4.5 / 4 系列补齐 200K 上下文阶梯价。
  - **根路径**：`/` 重定向到 `/dashboard`，避免开发态立刻 `redirect()` 触发的 Turbopack 红屏。

  ### Core

  - **OpenAI endpoints**：`providers.endpoints` 增加 `responses` capability，可由 `openai.base` 派生 `/v1/responses`。
  - **供应商列表计数**：`listProviders` 返回 `routes_count` / `active_routes_count`（查询增量，无 schema 变更）。

  ### 文档

  - **用户接口**：补充 `POST /v1/responses` 请求体、`previous_response_id` 约束与错误码。
  - **功能 / 配置 / 生命周期**：功能地图、路由拓扑与流式计费说明纳入 Responses。
  - **文生图目录**：收录 `grok-imagine-image-2.0`。

  ### 升级说明

  - **数据库迁移**：无
  - **发布顺序**：更新 proxy / admin / migrate 三镜像后滚动重启即可。
  - **配置变更**：启用 Responses 时，为对应 Provider 配置 `endpoints.openai.responses`（或依赖 `openai.base` 派生），并为模型创建 `openai` + `responses` 请求入口与同协议 `passthrough` 上游。
  - **兼容性影响**：既有 Chat / Messages / Gemini / Images / Audio 入口不变；Responses 为增量能力。已导入的旧模型行不会被静态目录覆盖，改价需删后 re-import 或 PATCH。
  - **建议操作**：在 Admin 导入新模型预设；为需要 Responses 的模型挂路由后，用 Playground / Simulator 与 `POST /v1/responses` 冒烟，并回归 chat / messages / gemini / images / audio。

## 2.4.0

### Minor Changes

- [#96](https://github.com/OctaFuse/octafuse-gateway/pull/96) [`6f46220`](https://github.com/OctaFuse/octafuse-gateway/commit/6f46220bb378daadef9278634f23beb9a228064e) Thanks [@dyc87112](https://github.com/dyc87112)! - OctaFuse Gateway v2.4.0 新增 DashScope 原生 ASR/TTS 与实时音频能力，并将 Admin 认证从单一 `MASTER_KEY` 升级为具名 Admin API Keys；Routes Flow 粘滞运维体验同步增强。

  ### Proxy

  - **DashScope 音频路由**：支持经 OpenAI 兼容面或 DashScope 原生协议调用文件 ASR / TTS，并按适配器转发至百炼上游。
  - **DashScope Realtime**：新增 `GET /v1/dashscope/realtime` WebSocket 入口，透传原生实时 ASR / TTS 事件；Node 运行时补齐 realtime 代理。
  - **音频计费字符**：请求日志新增 `audio_characters`，TTS 按上游有效计费字符独立记账。

  ### Admin

  - **Admin API Keys**：控制台支持具名集成密钥的创建、轮换、吊销与权限；浏览器会话与 Bearer Key 身份分离，Access Keys 管理仅 Console Session 可写。
  - **DashScope 预设与联调**：Qwen Token Plan / Provider 导入增加 DashScope 音频端点与 ASR/TTS 模型目录；Playground 支持 DashScope realtime 联调；路由列表隐藏上游端点噪音展示。
  - **粘滞运维 UX**：Routes Flow 增强粘滞绑定摘要、刷新、用户数与拓扑默认密度等运维可视能力。
  - **阿里云 TTS 定价**：修正 Aliyun TTS 单价，并补充 CosyVoice 3.5 预设。

  ### Core

  - **迁移 0022**：`api_key_request_logs` 增加 `audio_characters`（D1 / Postgres / MySQL）。
  - **迁移 0023**：新增 `admin_api_keys` / `admin_sessions`，并将历史 `system_config.MASTER_KEY` 复制为全权限 Key `legacy-master`。
  - **迁移 0024**：删除遗留 `system_config.MASTER_KEY` 配置行。
  - **迁移 0025**：为 `user_audit_logs(actor_id, created_at)` 增加检索索引。

  ### 文档

  - **DashScope 音频架构**：新增 [dashscope-audio.md](./docs/developers/architecture/dashscope-audio.md)。
  - **Admin 认证**：更新 Admin API / Cloudflare 部署说明中的具名 Key 与 `legacy-master` 轮换指引。

  ### 升级说明

  - **数据库迁移**：必须应用 **0022**–**0025**；三种数据库语义一致。
  - **发布顺序**：维护窗口内先备份 → 执行迁移 → 立即部署同一版本的 Proxy / Admin / migrate；禁止新旧版本混跑（尤其 0023/0024 认证切换）。
  - **配置变更**：部署后尽快在 **系统集成 → 集成密钥** 为外部系统创建最小权限 Key，更新其 `GATEWAY_MASTER_KEY`（或等价变量），再轮换/吊销 `legacy-master`；Bearer Key（含 `*`）不可管理 `/admin/access-keys/*`。
  - **兼容性影响**：客户端推理 URL 不变；旧 `MASTER_KEY` 值在迁移后仍可通过 `legacy-master` 调用 Admin API，直至吊销。
  - **建议操作**：验证 Admin 登录、具名 Key 权限、DashScope ASR/TTS/realtime 冒烟，以及 chat / messages / gemini / images 既有协议回归。

## 2.3.0

### Minor Changes

- [`819588f`](https://github.com/OctaFuse/octafuse-gateway/commit/819588fe644519d0f95449c7867a052b8ce54514) Thanks [@dyc87112](https://github.com/dyc87112)! - OctaFuse Gateway v2.3.0 恢复 Route Pool Provider Sticky Routing，并将路由策略展示名与持久化 ID 对齐为 `hash_affinity` / `weight_priority`；Admin Routes Flow 同步增强粘滞绑定运维与拓扑可视化。

  ### Proxy

  - **Provider Sticky Routing**：Route Pool 可启用跨 isolate / 多实例共享的用户粘滞绑定（idle TTL 滑动、epoch 失效、失败解绑语义）；绑定命中时优先尝试粘滞目标，再进入 priority 层排序。
  - **route_trace.sticky**：请求日志可观测 `lookup` / `attempted_target` / `result`，便于对照 Prompt Cache 收益与 failover 成本。
  - **策略 ID 对齐**：运行时仅接受 `hash_affinity`、`weighted_random`、`weight_priority`、`weighted_round_robin`（原 `cache_affinity` / `fixed_order` 无别名）。

  ### Admin

  - **Sticky 运维**：Routes Flow 支持按 Pool 开关粘滞、配置 TTL、查看绑定分布 vs 权重、按用户解绑、整池 invalidate（epoch bump）。
  - **拓扑可视化**：Route Model Flow / Overview / Workspace Header 强化路由拓扑与策略来源展示，便于运维核对层内排序与 Failover。
  - **策略选择器**：全局、Pool、priority 层统一展示新策略 ID 与中文/多语文案。

  ### Core

  - **迁移 0020**：`route_pools` 增加 sticky 配置列，新增 `route_pool_sticky_bindings` 表（D1 / Postgres / MySQL）。
  - **迁移 0021**：将持久化策略 ID `cache_affinity` → `hash_affinity`、`fixed_order` → `weight_priority`（含全局、Pool、`tier_strategies`、模型 `route_policy`）。

  ### 文档

  - **Sticky cutover**：新增 [route-pool-sticky-routing-cutover.md](./docs/operators/migrations/route-pool-sticky-routing-cutover.md)。
  - **策略展示 ID cutover**：新增 [route-strategy-display-ids-cutover.md](./docs/operators/migrations/route-strategy-display-ids-cutover.md)。
  - **参考与 API**：更新 route-strategies、Admin API、README 多语言说明中的策略 ID。

  ### 升级说明

  - **数据库迁移**：必须应用 **0020** 与 **0021**；三种数据库语义一致。
  - **发布顺序**：维护窗口内先备份并暂停 Proxy 流量与 Admin 配置写入 → 执行迁移 → 立即部署同一版本的 Proxy / Admin / migrate；禁止新旧版本混跑（尤其 0021 无旧 ID 别名）。
  - **配置变更**：外部自动化写入的路由策略 ID 须同步改为 `hash_affinity` / `weight_priority`；Sticky 默认关闭，需在 Admin 按 Pool 显式启用。
  - **兼容性影响**：客户端推理 URL 不变；写入旧策略 ID 将 `400`；未迁移数据在新代码下会被视为非法并回退默认策略。
  - **建议操作**：部署后验证 Sticky 开关/TTL/解绑、全局/Pool/层策略保存与非法旧 ID 拒绝，以及 chat / messages / gemini / images / audio 各协议冒烟。

## 2.2.0

### Minor Changes

- [`57cbd07`](https://github.com/OctaFuse/octafuse-gateway/commit/57cbd0721601104dcfbee7313b62e45d2c89905c) Thanks [@dyc87112](https://github.com/dyc87112)! - OctaFuse Gateway v2.2.0 统一 Gemini Generate Content 路由语义，并将路由策略配置升级为可按 priority 层覆盖的 canonical 策略体系。

  ### Proxy

  - **Gemini operation 收敛**：公开 Surface 与上游 Target 统一使用 `models.generate`，流式与非流式请求共享同一 Route Pool；真实 wire action 继续使用 `generateContent` / `streamGenerateContent` 并写入 `route_trace.gemini.action`。
  - **Canonical 路由策略**：仅接受 `cache_affinity`、`weighted_random`、`fixed_order`、`weighted_round_robin`；不再接受 `affinity`、`strict`、`round_robin`。（后续 Unreleased / 0021 已再改为 `hash_affinity` / `weight_priority`。）
  - **按层策略**：Route Pool 可通过 `tier_strategies` 为不同 priority 层设置独立排序策略，未覆盖的层继续使用 Pool / 模型 / 全局策略。

  ### Admin

  - **Routes 策略编辑**：全局、Pool 与 priority 层统一使用可视化策略选择器；每层可查看实际策略来源与 Failover 规则。
  - **Provider Gemini 配置**：新配置优先写入单一 `models.generate` URL 模板（`{model}:{action}`），无法安全合并的历史双模板会保留并提示复核。
  - **Agent Tools Provider 卡片**：通过卡片与右侧抽屉维护凭证及 Standard / Charged / Metered 三账本单价，支持“仅保存配置”与“保存并启用”，并提示未保存、缺凭证、不可用和亏损定价状态。

  ### Core

  - **迁移 0017**：合并 Gemini `generateContent` / `streamGenerateContent` Surface，规范化 Target operation，并标记需要人工复核的冲突 Pool。
  - **迁移 0018**：为 `route_pools` 新增可空的 `tier_strategies` JSON 列。
  - **迁移 0019**：改写全局、模型、Pool 与按层配置中的旧路由策略 ID。

  ### 文档

  - **Docker 升级**：补充预构建镜像与本地构建场景的版本更新、迁移、重建和冒烟步骤。
  - **迁移 Runbook**：新增 0017–0019 的发布顺序、校验、冲突处理和回滚说明。

  ### 升级说明

  - **数据库迁移**：必须应用 0017、0018、0019；三种数据库的迁移语义一致。
  - **发布顺序**：备份数据库并暂停 Proxy 流量与 Admin 配置写入，先执行全部迁移，再检查 `[v220-conflict]` Gemini Pool，随后立即部署同一版本的 Proxy 与 Admin；禁止新旧版本混跑。
  - **配置变更**：所有持久化路由策略 ID 会迁移为 canonical 名称；外部自动化写入也必须同步使用新 ID。
  - **兼容性影响**：客户端 Gemini URL 不变；Admin / API 的 Gemini operation 配置改为 `models.generate`。历史 Provider per-action endpoint 模板仍兼容读取，历史路由策略 ID 不再接受。
  - **建议操作**：部署后分别验证 Gemini 流式/非流式请求、全局/Pool/priority 层策略、Tools Active Provider 与三账本日志。

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

### Patch Changes

- [#74](https://github.com/OctaFuse/octafuse-gateway/pull/74) [`58e6383`](https://github.com/OctaFuse/octafuse-gateway/commit/58e6383c7439fcc72ed5539af299c6c701121f36) Thanks [@dyc87112](https://github.com/dyc87112)! - Improve Images `/v1/images/edits` client-error diagnostics: reject non-`multipart/form-data` Content-Type with an explicit message (instead of a misleading `Missing model`), and log structured `[Gateway Images] request rejected` fields (`contentType`, `bodyKeys`, `hasModel`, …) for all Images 4xx early exits. Proxy also logs truncated JSON bodies for Gateway-generated 4xx responses.

- [#76](https://github.com/OctaFuse/octafuse-gateway/pull/76) [`6019524`](https://github.com/OctaFuse/octafuse-gateway/commit/601952484c9ca01a5f21d1e4e5e5c79d5e441d8a) Thanks [@dyc87112](https://github.com/dyc87112)! - Fix Admin Docker multi-arch build on `linux/arm64` (Alpine musl): explicitly install `@swc/core-linux-*-musl` after `npm ci --ignore-scripts`, so `next-intl` can load native SWC when evaluating `next.config` under buildx/QEMU.

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

### Patch Changes

- [#69](https://github.com/OctaFuse/octafuse-gateway/pull/69) [`33941bf`](https://github.com/OctaFuse/octafuse-gateway/commit/33941bf54c8578a50b49c3abc327d956153b0bcf) Thanks [@dyc87112](https://github.com/dyc87112)! - Fix Admin console login being kicked out immediately on plain HTTP (e.g. Docker quickstart): make `admin_session` `Secure` opt-in via `ADMIN_COOKIE_SECURE` instead of always-on ([#36](https://github.com/OctaFuse/octafuse-gateway/issues/36)).

## 1.10.1

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
