# 管理后台配置指南

本页按“部署好以后要做什么”的顺序组织。它不替代 API 文档，只帮助使用者在管理后台（Admin）中建立可用配置。

## 1. 先确认实例边界

| 项目 | 说明 |
|------|------|
| 代理服务 URL | 客户端实际调用地址，例如 `http://localhost:8787` 或 `https://gateway.example.com`。 |
| 管理后台 URL | 管理控制台地址，例如 `http://localhost:8789` 或 `https://gateway-admin.example.com`。 |
| 管理后台登录 | 只用于打开管理 UI。 |
| Admin API Key | 后台创建的具名、可授权 Bearer，用于外部系统调用 `/api/admin/*`。建议每个集成独立且最小权限。 |
| 用户 API Key | 发给客户端调用代理服务（Proxy）的 Key，不应与 Admin API Key 混用。 |

## 2. 配置供应商

供应商（Provider）表示一个上游模型入口。**一个供应商 = 一把上游 API Key + 启用状态**（`active` / `disabled`）。

配置时重点检查：

- 上游 Base URL / `endpoints` 与协议类型是否匹配。
- 上游 API Key 是否真实可用（列表为脱敏；明文经管理后台「显示」或 `GET /api/admin/providers/:id/api-key`）。
- 供应商 `status` 是否为 **active**（disabled 或空密钥的行不会参与调度）。
- 如使用导入模板，导入后须补齐真实 API Key（导入占位 key 会标为 pending）。

需要同一供应商多账号时：创建**多个供应商**（各一把 key），再在模型下挂多条路由——不要期望「一个供应商多把 key」。

供应商导入模板的维护说明见 [developers/reference/provider-import-presets.md](../developers/reference/provider-import-presets.md)。

![供应商列表：卡片展示密钥状态、协议能力与路由数，可按状态和协议筛选](../assets/screenshots/providers.png)

## 3. 配置模型与路由

Routes 工作台支持**总览（Overview）**与**按模型（By model）**两种视角，并在 **Unrouted models** 区域集中展示尚未启用请求入口的模型。拓扑仍按 **请求入口（Request Surface）→ 路由池（Route Pool）→ 上游目标（Upstream Target）** 组织：请求入口表示客户端协议 / operation，路由池表示一组可故障转移的上游目标，上游目标才是具体供应商与上游模型。完整概念见 [developers/architecture/route-topology.md](../developers/architecture/route-topology.md)。

![路由工作台：按请求入口、路由组与上游分层展示策略、粘滞与故障转移](../assets/screenshots/routes.png)

点击拓扑中的任一上游目标，即可在路由编辑页面集中配置客户端协议 / operation、路由组、上游映射、自定义参数，以及用户计费与供应成本倍率。

![路由编辑页面：配置客户端入口、上游映射、自定义参数与计费倍率](../assets/screenshots/route-editor.png)

常见做法：

- 对客户端暴露稳定的模型名，例如 `gpt-4.1`、`claude-sonnet` 或团队内部命名。
- 同一模型下配置多个供应商路由：
  - **请求协议 / operation**：客户端从哪个协议与操作进入，例如 `openai.chat`、`openai.responses`、`anthropic.messages`、`openai.images.generations`。同一模型可以同时挂 Chat 与 Responses，互不影响。
  - **上游协议 / operation**：上游目标实际调用的供应商能力。同协议、同 operation 使用 `passthrough`；OpenAI ASR / TTS 转 DashScope 时必须选择对应的显式 adapter；`*` 仅用于迁移兼容。
  - **`priority`（层）**：数字**越大**越先试（硬序）。
  - **`weight`（同层）**：配合路由池 / 模型 / 全局路由策略（默认 **hash_affinity**）决定层内顺序。
  - **`route_group`**：如 `default` / `free`，客户端用 `modelId:group` 选择。
- 图片生成模型：导入或手建后确认 `output_modalities` 含 `image`、`pricing_profile` 的 `image_billing_mode`（`token` / `per_image`），并挂 **OpenAI 协议** active 路由；细节见 [developers/reference/image-models.md](../developers/reference/image-models.md)。
- 音频模型：ASR 可按时长或 Token 计费，TTS 可按字符计费；可使用 OpenAI 兼容的 `/v1/audio/transcriptions`、`/v1/audio/speech`，或 DashScope 原生实时音频。跨协议路由与 adapter 见 [DashScope 音频架构](../developers/architecture/dashscope-audio.md)。
- **路由策略**：先按 priority 层读路由池 `tier_strategies[priority]`（若有）；否则路由池 `strategy` → 模型 `route_policy.rules` 的 `{protocol}.{capability}:{group}` → `{protocol}:{group}` → 模型顶层 `route_policy.strategy` → 管理后台 Config 全局 `ROUTE_STRATEGY` → 代码默认 `hash_affinity`。四种策略及完整键格式见 [developers/reference/route-strategies.md](../developers/reference/route-strategies.md)。
- **供应商粘性（Provider sticky，可选）**：在拓扑视图（Topology）的路由组 / 路由池节点打开粘性配置（关闭时芯片为 `Sticky · Off`，启用后为 `Sticky · {ttl}`），按路由池启用并设置空闲 TTL（默认 3600 秒）。它不是第五种层内策略：`hash_affinity` 用无状态哈希稳定首选，粘性则记住上次成功的上游目标，并可在绑定有效时跨 priority 优先尝试。弹窗还可查看绑定分布与路由权重、按用户解绑，或通过 `sticky_epoch` 整池失效；默认关闭。完整语义见 [供应商粘性（route-strategies）](../developers/reference/route-strategies.md#provider-sticky-routingpool-前置规则非第五策略)。
- 在路由的 **Custom params** 中配置思考参数、输出长度或供应商扩展字段等默认值；它们会与上游请求体深度合并，客户端显式传入的字段优先，因此不能用于强制覆盖客户端参数。
- 设置价格口径：先维护模型**目录标准价（Standard）**，再在路由上设用户计费（Charged）/ 供应成本（Metered）的默认倍率；如需对齐供应商高峰 / 闲时价，再配置**每日时段（Daily schedule）**（共享起止时间，每行分别填两侧倍率；命中该时段时覆盖默认倍率；时区见系统配置的业务时区）。
- 在请求日志（Request Logs）中核对三笔账：供应成本、目录标准价、用户计费是否符合业务预期。

路由默认参数合并规则见 [developers/api/user.md](../developers/api/user.md#route-默认参数合并)；时段调价契约见 [developers/api/admin.md](../developers/api/admin.md) 中的 `price_override.schedule`；调度与熔断见 [developers/architecture/proxy-request-lifecycle.md](../developers/architecture/proxy-request-lifecycle.md)。

## 4. 配置智能体工具（可选）

智能体工具（Agent Tools）是代理服务上面向 Agent 的 **可扩展产品 API**（`/v1/tools/*`），**不是** Chat Completions 的一部分。在管理后台 → **智能体工具 → 工具配置（Tools → Configuration）**：

- 每种工具以供应商卡片展示各引擎；点击卡片后在右侧抽屉维护凭证与三账本单价：**目录标准价（Standard）/ 用户计费（Charged）/ 供应成本（Metered）**。
- 当前工具与引擎：
  - **Web Search**：博查、Tavily、阿里云 CleverSee、腾讯云联网搜索 WSA
  - **Web Fetch**：Firecrawl、Tavily Extract、Jina Reader
  - **Web Deep Search**：Firecrawl Search、Jina Search
  - **AI 率检测（AI Detection）**：多引擎 catalog，当前仅腾讯云 TMS 已实现；按 `billingUnitChars` 字符单元计费
- **仅保存配置**不会切换线上引擎；**保存并启用**会保存当前草稿并把该供应商设为此工具唯一的活跃引擎（Active）。未实现或凭证不完整的引擎不可启用。
- 卡片会提示活跃、未保存、缺少凭证、暂不可用与亏损定价（`charged < metered`）等状态。清空当前活跃引擎的凭证前，应先切换到另一个凭证完整的引擎。
- 成功请求分别按三种绝对单价写入 `metered_cost` / `standard_cost` / `charged_cost`，仅 **charged** 累加用户预算；上游失败三列均为 0。智能体工具不应用模型路由倍率或每日时段。币种由 `BILLING_CURRENCY` 决定，调用记录见 **智能体工具 → 工具调用记录（Tools → Invocations）**（与请求日志同源）。

字段与引擎白名单见 [developers/api/user.md](../developers/api/user.md) 中各 Tools 章节。

## 5. 创建用户与 API Key

用户 API Key 是客户端真正使用的凭证。对接外部门户时可用 `external_system` 区分产品或租户，并以 `(external_system, external_user_id)` 幂等创建 User；预算归属 User，API Key 负责鉴权、扣费归集和审计。

建议：

- 为不同人、团队、客户或项目创建独立用户或独立 Key。
- 给 Key 设置可识别名称和 metadata，方便后续审计。
- 为用户设置预算与周期重置策略。
- 停用不再需要的 Key，而不是长期共享一把 Key。

用户、Key、预算和审计的数据模型见 [developers/architecture/user-keys-data-model.md](../developers/architecture/user-keys-data-model.md)。

## 6. 验证调用

最小验证：

```bash
curl -sS http://localhost:8787/health
curl -sS http://localhost:8787/catalog/models
```

用户推理、Images、Audio、Tools 与各协议客户端示例见 [connect-clients.md](./connect-clients.md)；完整 API 字段见 [developers/api/user.md](../developers/api/user.md)。

预算状态验证：

```bash
curl -sS http://localhost:8787/v1/me \
  -H "Authorization: Bearer sk-your-api-key"
```

## 7. 日常观察

日常排障优先看：

- 请求日志：是否命中正确模型、请求入口、路由池、上游目标与供应商；重点查看 `request_operation`、`model_surface_id`、`route_pool_id`、`route_target_id`、`route_trace`。启用供应商粘性后查看 `route_trace.sticky.lookup`、`attempted_target` 与 `result`，结合 cache read token 和 failover 次数判断绑定收益及异常解绑。`provider_key_*` 现为 provider id / name / key 指纹；Tools 行为 `model_id` 形如 `tool:web-search`。
- 错误状态：401 多半是认证问题；403 常见于预算或配额；502 多与路由或上游有关；全部上游熔断时可能为网关 **429**；智能体工具未配置活跃引擎 Key 时为 **503**。
- 成本字段：区分 **供应成本**、**目录标准价**、**用户计费**（日志 / API 字段分别为 `metered_cost`、`standard_cost`、`charged_cost`）；Images / Audio 另见 `billing_kind`（及 image count / `audio_duration_seconds` 等列）。
- 审计日志（Audit Logs）：确认预算扣减、周期重置、Key 生命周期等事件。

更细的日志和计费语义见 [developers/reference/streaming-billing.md](../developers/reference/streaming-billing.md)、[developers/reference/image-models.md](../developers/reference/image-models.md)、[developers/api/user.md「语音转写」](../developers/api/user.md#语音转写audio-transcriptions) 与 [developers/reference/user-audit-logs.md](../developers/reference/user-audit-logs.md)。
