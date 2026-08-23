---
"octafuse": minor
---

OctaFuse Gateway v2.7.0 为用户增加按模型维护的计费倍率，新增 DashScope 同步多模态 ASR 入口，并让每日时段可按工作日 / 周末分别定价；管理后台同步整理用户、请求日志与供应商目录。

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
