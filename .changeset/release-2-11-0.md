---
"octafuse": minor
---

OctaFuse Gateway v2.11.0 重点提升文本流式请求的稳定性与故障转移能力，并扩展用户级模型计价策略：运维可以控制用户倍率与路由倍率的组合方式，业务系统可以直接获取指定用户的模型展示折扣；同时统一无可用路由等代理错误的对接契约，并补充最新模型与价格目录。

### Proxy

- **文本流式超时保护**：Chat Completions、Responses、Anthropic Messages 与 Gemini 流式请求新增首包、流中空闲和记账绝对兜底三档保护。默认分别为 2 分钟、30 秒和 10 分钟，也可通过 `STREAM_FIRST_CHUNK_TIMEOUT_MS`、`STREAM_IDLE_TIMEOUT_MS`、`USAGE_SAFETY_TIMEOUT_MS` 按部署环境调整；流中空闲超时会取消上游并将请求记录为 `incomplete`，避免连接长期悬挂。
- **首个流式事件故障转移**：可通过 `STREAM_FIRST_EVENT_TIMEOUT_MS` 与 `STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS` 为指定路由组启用首个 SSE 事件超时。命中超时后，本次上游尝试按 524 失败处理并继续故障转移；该能力默认关闭，未指定路由组时仅作用于 `default`。
- **统一代理错误契约**：面向客户端的错误响应统一使用 `X-OctaFuse-Error-Code` 分类，并补充完整错误码说明。模型存在但当前入口没有可用上游目标时，统一返回 `404 gateway.no_route` 与 `No available route`，便于客户端区分模型不存在、路由缺失和上游失败。
- **用户计费倍率策略**：用户模型倍率支持 `multiply` 与 `min` 两种全局组合模式。默认 `multiply` 延续“路由用户计费倍率 × 用户倍率”；`min` 则取路由倍率与用户倍率中的较小值。LLM、Images 与 Audio 的实际扣费、模型价格展示和计价审计使用同一模式。

### Admin

- **用户倍率模式配置**：Gateway 配置页新增用户计费倍率组合方式，可直接选择默认的叠乘模式或最低倍率模式；配置通过 `USER_CHARGED_COST_FACTOR_MODE` 保存，Proxy 约 30 秒内刷新。
- **用户专属展示折扣接口**：新增 `GET /admin/users/:id/display-discounts`，供门户或业务服务在公开模型目录上叠加指定用户的模型折扣。接口需要管理端 `users.read` 权限，只返回该用户已配置倍率且存在可用路由的模型，不占用用户或 API Key 的 RPM。
- **模型与价格目录更新**：新增 GPT Image 2.5 Flare、GPT Image 2.5 Sunburst 与 GLM-5.3-FlashX 预设；同步调整 Claude Sonnet 5、GPT-5.6 Terra 和 GPT-5.6 Luna 的 USD / CNY 目录价格，并补齐对应的导入校验。

### Core / 配置

- **倍率审计信息完善**：模型请求的 `pricing_audit` 可记录用户倍率组合模式和最终组合倍率，便于核对路由价格、用户折扣与实际扣费之间的关系；未给用户配置当前模型倍率时，仍保持原路由价格。
- **跨部署配置一致**：流式超时环境变量已接入 Node / Docker 与 Cloudflare 配置生成流程；无效或非正整数值会回退到代码默认值。首个 SSE 事件故障转移和用户倍率模式保存在 `system_config`，无需新增数据库字段。

### 文档

- **错误与流式运行说明**：新增代理错误码参考，并补充流式超时、故障转移、请求日志状态和不同部署方式下的配置位置。
- **用户计价与目录接入**：补充两种用户倍率组合方式、个性化折扣 overlay 接口，以及新增图片和文本模型的目录与计价说明。

### 升级说明

- **数据库迁移**：本版本没有新增数据库迁移，可在已完成 v2.10.0 数据库迁移的环境中直接升级 Proxy 与 Admin。
- **错误状态兼容**：`gateway.no_route` 从 `502` 调整为 `404`，响应文案统一为 `No available route`。如果客户端、监控或重试规则依赖原状态码或旧文案，请改为优先判断 `X-OctaFuse-Error-Code: gateway.no_route`。
- **流式超时行为**：三档流式保护升级后即按默认值生效。存在超长静默思考、工具调用或检索任务时，请在部署前评估并按需提高环境变量；`STREAM_FIRST_EVENT_TIMEOUT_MS` 默认关闭，不会在未配置时改变首事件故障转移行为。
- **用户倍率兼容**：默认 `multiply` 与 v2.10.0 及更早版本的用户倍率算法一致。只有明确切换为 `min` 后，已配置用户倍率的 LLM、Images 与 Audio 计费和展示价格才会采用最低倍率策略。
- **目录导入行为**：模型目录导入不会覆盖数据库中已存在的同 ID 模型。已有 Claude Sonnet 5、GPT-5.6 Terra 或 GPT-5.6 Luna 如需采用新目录价格，请由管理员核对后手动更新；新增模型也需要按需导入并配置路由。
- **建议核验**：升级后分别验证长流式请求、空闲超时与可选首事件故障转移；检查无可用路由响应的状态码和错误头；再核对两种用户倍率模式、个性化折扣接口权限及新增模型的目录价格。
