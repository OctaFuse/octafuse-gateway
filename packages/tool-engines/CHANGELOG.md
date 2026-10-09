# @octafuse/tool-engines

## 2.14.0

### Minor Changes

- [#209](https://github.com/OctaFuse/octafuse-gateway/pull/209) [`775cd46`](https://github.com/OctaFuse/octafuse-gateway/commit/775cd46283efb2788e399e45183d1856c60dc1f4) Thanks [@dyc87112](https://github.com/dyc87112)! - OctaFuse Gateway v2.14.0 重点扩展图像与语音模型接入，并提升用户计费和后台配置体验。已有 OpenAI 客户端可以通过新适配器调用 MiniMax 图像与音频、火山方舟 / BytePlus Seedream 和 Gemini 图片模型，也可以按需使用厂商原生入口。管理员可以为同一用户、同一模型的不同路由组设置独立折扣，在用户详情中预览可用模型与折扣，并更安全地保存额度和网关配置。

  ### Proxy

  - **MiniMax 图像与音频接入**：新增 `minimax` 协议，通过 `minimax-asr-file`、`minimax-tts` 和 `minimax-image` 适配器，将 OpenAI 语音转写、语音合成和图像生成请求转换为 MiniMax 原生调用。同时提供 `POST /v1/minimax/speech_to_text`、`POST /v1/minimax/t2a_v2` 与 `POST /v1/minimax/image_generation` 原生入口；同步语音合成支持非流式及 SSE。转写按时长、语音合成按上游用量字符数、生图按成功张数计费，MiniMax 业务错误也会纳入网关的失败处理。
  - **Seedream 专用生图接入**：新增火山方舟与 BytePlus 共用的 `volcengine` 协议。OpenAI 图像生成请求可通过 `volcengine-image` 转换；原生入口 `POST /v1/volcengine/images/generations` 支持 JSON 和 SSE。两条入口均按成功张数计费，并将明确的宽高尺寸换算为分辨率计价档位；支持组图的模型可通过 OpenAI `n` 参数生成多张图片。
  - **Gemini 图片模型接入**：现有 Gemini `generateContent` / `streamGenerateContent` 入口补齐图片模型处理，也可通过新增的 `gemini-image` 适配器使用 OpenAI `POST /v1/images/generations`，对接 Gemini API 或 Vertex AI。图片与文本用量按响应分项计费；无有效图片、客户端取消或网关超时的 Gemini 生图请求不扣用户额度。OpenAI 入口返回 `b64_json` 图片与分项用量，支持参考图和尺寸映射。
  - **百炼原生能力扩展**：补齐 DashScope SpeechSynthesizer 语音合成及 SSE、多模态语音合成与生图的原生分流、异步文件转写提交与任务查询，并支持选择 Qwen-TTS-Realtime 会话透传。原有 OpenAI 转换路由保持可用；浏览器跨域调用放行 `language`、`X-DashScope-SSE` 与 `X-DashScope-Async` 请求头。
  - **更多厂商参数可由客户端传入**：OpenAI 图像生成、图像编辑、语音合成和转写入口支持将额外顶层字段按上游原生结构深度合并到请求体，便于传入图像比例、语音设置等厂商特有参数。OpenAI SDK 可通过 `extra_body` 发送这些字段；额外字段总量上限为 32KB，模型名及适配器声明的计费、响应解析关键字段仍受保护。
  - **用户折扣按路由组细分**：在现有用户级模型倍率基础上，新增按路由组设置不同倍率的能力。文本、图像和音频的实际扣费、`GET /v1/models` 及用户展示折扣采用一致的匹配规则：优先使用具体分组，随后使用 `*` 兜底；未匹配时保持原路由计费。已有“相乘”与“取较小值”组合模式继续生效。

  ### Admin

  - **用户详情重新分区**：按“概览”“额度与计费”“模型列表”“活动记录”组织信息，支持按模型和路由组编辑用户倍率。保存时只提交改动过的字段，避免用页面加载时的旧数据覆盖期间新增的消费；修改额度重置周期或时间不再清零本周期已消费额度，离开未保存页面时会提示。
  - **用户模型与折扣预览**：用户详情新增模型列表预览，按已保存的配置查看该用户可见的模型和分组折扣，便于核对目录倍率、路由倍率与最终倍率。预览默认展示 `default`、`free` 分组的文本模型，可按模型类型、分组或模型筛选；它不发起模型调用、不消耗用户 RPM，未保存的倍率不会进入预览。
  - **网关配置独立保存**：配置页每张卡片可分别保存，明确显示未保存状态，并支持撤销本卡片的修改，减少多个配置区一起提交造成的误操作。
  - **路由适配器更易选择和使用**：编辑路由时按供应商协议和模型名筛选适配器，并直接展示客户端入口、字段映射、计费方式、调用限制和 SDK 示例。供应商 DashScope 端点说明也更明确，帮助区分仅配置 Base 与按套餐配置部分端点的用法；已保存的路由不受影响。
  - **多模态调试完善**：调试台（Playground）和模拟器（Simulator）可调用 MiniMax、火山方舟及 DashScope 原生入口，并编辑 Gemini 生图请求、预览返回图片。MiniMax 非流式语音的 hex 音频可解码播放；生图样例按模型选择合适的最低分辨率档位，页面布局和请求编辑区域也同步优化。
  - **供应商卡片**：未配置密钥或待确认的卡片不再显示「点击前往」。导入供应商和编辑密钥时，仍可从弹窗打开对应平台。
  - **供应商预设扩展**：新增按量计费的“千问 AI 平台”，更新“千问 AI 平台（Token Plan）”主机与端点，并新增 MiniMax 国际站。按各渠道能力补齐百炼、千问、火山方舟、BytePlus、MiniMax，以及 DeepSeek、混元、千帆、智谱、LongCat、月之暗面、Kimi Code、阶跃、小米 MiMo 和七牛的 Responses 或 Anthropic 端点；LongCat 的 Chat 地址改为官方的 `/openai/v1/chat/completions`。硅基流动国内与国际站补齐生图、语音转写和语音合成地址，Together AI 补齐语音转写与语音合成，OpenRouter 补齐 Responses。百炼 Coding Plan、混元 Token Plan、百川和超算互联网没有对应官方入口，预设保持原样。原生图像和音频端点与 OpenAI 对话端点分开配置；只支持部分 OpenAI 能力的模板不再写 `openai.base`，改为列出确认过的完整地址，涉及智谱、Z.AI、硅基流动、Gemini 兼容层、xAI、Together、OpenRouter 和 Vercel AI Gateway。官方 OpenAI、Azure，以及该协议下能力都覆盖的 `base` 保持不变。已导入的供应商不会自动改写。
  - **新增模型预设**：新增 Claude Haiku 5.5（`claude-haiku-5-5`）、Gemini Nano Banana 2.1（`gemini-nano-banana-2.1`），以及 MiniMax 文件转写（`minimax-asr-1.0`）、语音合成（`minimax-speech-2.8-hd` / `minimax-speech-2.8-turbo`）和图像模型（`minimax-image-01` / `minimax-image-01-live`）。补齐对应模态、计费方式和目录价格，Claude Haiku 5.5 包含按提示长度区分的价格档位。
  - **目录价格与图像计价修正**：修正 Claude Sonnet 5.5 的缓存读取价格、Seedream 5.0 Pro 的分辨率价格档位，以及 Grok Imagine Image 2.0 的分辨率、质量和参考图计价。OpenAI 图像入口未传 `size` 时，可使用额外字段 `resolution` 选择计价档位；已有数据库模型不会自动改价。

  ### Core / 接口

  - **用户倍率数据结构扩展**：`users.charged_cost_factors` 保留原有“模型 → 数字”格式，新增“模型 → 分组倍率对象”格式，支持具体路由组和 `*` 兜底。新写入的计价审计通过 `user_charged_factor_route_group` 记录命中的分组键，数字配置或未命中时为 `null`。
  - **管理接口与参数审计**：新增只读接口 `GET /api/admin/users/:id/models`，供管理端预览指定用户的模型与折扣，按筛选条件限量返回。多模态请求日志补充 `extra_fields` 与 `restored_upstream_paths`，记录额外参数及网关恢复的受保护字段，data URL 内容会脱敏。

  ### 文档

  - **多模态配置与能力说明**：补充 MiniMax、Seedream、Gemini 图像接入和 OpenAI 图像兼容说明，更新百炼音频、用户分组倍率及相关 API 文档。新增厂商原生能力覆盖参考和图像模型文档生成工具，明确已支持入口、转换限制与尚未覆盖的能力。

  ### 升级说明

  - **数据库与部署**：从 v2.13.0 升级无需新增数据库结构迁移或必填配置。建议备份数据库后，将 Proxy、Admin 与 migrate 镜像统一更新到 v2.14.0；从更早版本升级时，仍需按顺序执行尚未应用的迁移。
  - **新能力按需配置**：MiniMax 图像与音频需为供应商补齐 `minimax.base`，Seedream 新适配器需补齐 `volcengine.base`，Gemini 图片转换需有效的 Gemini 端点，再导入所需模型并配置对应路由。已有 OpenAI 透传 Seedream 路由可以继续使用，无需强制切换；视频、音乐等未实现能力不因新增协议而自动可用。
  - **存量供应商与模型不自动更新**：导入预设不会覆盖数据库中已有的同 ID 模型或既有供应商端点。需要新主机、端点或修正价格时，请由管理员核对后手动调整。本次收窄的 OpenAI 端点同样不会改写已导入供应商；若卡片仍通过 Base 声明了未实际支持的端点，需要在供应商里改成具体地址。Anthropic 与 Google 的 CNY 预设为 USD × 7 的换算占位价，并非独立人民币刊例。若选择使用 `scripts/db/migrate-image-billing-modes.mjs` 更新图像数据，应先备份并检查 `--dry-run` 结果；脚本会修改多种指定目录模型的计费配置和价格，不仅是本次修正的型号，也不适用于 Sonnet 缓存价格更新，不应作为常规升级步骤直接执行 `--apply`。
  - **百炼图像尺寸参数变化**：`dashscope-image-qwen` 与 `dashscope-image-wan` 现在将 `size` 原样写入上游 `parameters.size`，不再自动把 `1024x1024` 改成 `1024*1024`。已有客户端或路由默认参数依赖这一转换时，需要调整；千问可按模型支持范围使用 `1K` / `2K` 或 `宽*高`，万相也应按对应模型要求填写，取值由上游校验。
  - **转换与流式边界**：`gemini-image` 只支持单张、非流式、`b64_json` 的图像生成，不支持 `/v1/images/edits`；需要流式或原始 Gemini 响应时使用原生入口。`volcengine-image` 同样只返回非流式 JSON，Seedream 5.0 Pro / Flash 的 `n` 只能为 1。MiniMax 文件转写转换不支持流式，单文件上限为 25MB；原生转写透传目前也会整段缓冲，不能实时下发 SSE，无法读取时长时按文件估算计费。
  - **用户倍率与接口兼容**：已有数字倍率配置及全局组合模式行为不变，无需重写存量配置。只有使用新分组配置时，直接读取或写入 `charged_cost_factors` 的业务系统才需兼容对象值；读取计价审计时应允许新增分组键。管理端模型预览是基于已保存配置的限量列表，不代表完整目录或未保存草稿的结果。
  - **额外参数使用范围**：额外字段必须按目标上游的原生结构传入，不能覆盖受保护字段。DashScope 语音合成的 `input.*` 参数仍需写在路由请求参数中；混合协议路由池会向每条候选路由发送同一份额外字段，应先确认它们适用于所有目标上游。
  - **建议核验**：升级后验证一条新多模态转换路由及一条原生路由，核对返回结果、成功图片数或语音用量与实际扣费；检查百炼图像尺寸、修正后的目录价格、用户分组倍率及兜底行为，并验证修改用户信息不会覆盖新增消费、网关配置卡片可独立保存。调试台直连上游仍可能产生供应商费用，完整网关鉴权与扣费应通过模拟器或真实客户端核验。

### Patch Changes

- Updated dependencies [[`775cd46`](https://github.com/OctaFuse/octafuse-gateway/commit/775cd46283efb2788e399e45183d1856c60dc1f4)]:
  - @octafuse/core@2.14.0

## 2.13.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.13.0

## 2.12.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.12.0

## 2.11.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.11.0

## 2.10.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.10.0

## 2.9.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.9.0

## 2.8.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.8.0

## 2.7.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.7.0

## 2.6.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.6.0

## 2.5.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.5.0

## 2.4.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.4.0

## 2.3.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.3.0

## 2.2.0

### Patch Changes

- Updated dependencies []:
  - @octafuse/core@2.2.0

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

- Updated dependencies [[`9b7a9f6`](https://github.com/OctaFuse/octafuse-gateway/commit/9b7a9f6ddea090970d35f9b71976becd936c73f0)]:
  - @octafuse/core@2.1.2

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

- Updated dependencies [[`8e1f634`](https://github.com/OctaFuse/octafuse-gateway/commit/8e1f634d846cc97da4e1e47456e141103fc1d7e6)]:
  - @octafuse/core@2.1.1

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

### Patch Changes

- Updated dependencies [[`3a53d2f`](https://github.com/OctaFuse/octafuse-gateway/commit/3a53d2f1b3e11308e7d5497b895978d55c37f152)]:
  - @octafuse/core@2.1.0
