---
"octafuse": minor
"@octafuse/admin": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
---

### Proxy / 公开 API

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
