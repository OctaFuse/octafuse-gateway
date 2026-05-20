---
"octafuse": minor
"@octafuse/admin": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
---

### Proxy / 用户 API

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
