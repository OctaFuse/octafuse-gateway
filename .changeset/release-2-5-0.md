---
"octafuse": minor
---

OctaFuse Gateway v2.5.0 新增 OpenAI Responses 兼容入口，并重构 Admin Routes 工作台（总览 / 按模型、未接线模型）；同步扩充 Gemini 3.7 Flash、GLM-5.3、Grok 4.6 等模型目录。

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
