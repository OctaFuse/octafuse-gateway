---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

### Proxy

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
