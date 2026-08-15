# Octafuse API 文档

多协议 AI 能力网关：提供 OpenAI、Anthropic、Gemini 兼容推理，Images、Audio Transcriptions、Agent Tools、用户 API Key、公开能力目录、用量与日志。实现分布在 **`packages/proxy`**（用户协议）、**`packages/admin`**（管理协议）、**`packages/tool-engines`**（Tools 上游引擎客户端，source-only）与共享库 **`packages/core`**。

## 部署形态与 Base URL

生产默认：**Cloudflare**（Proxy Worker + Admin Pages）+ **D1**。同一套 API 也可跑在 **Node + Postgres / MySQL**（或 Hybrid）；总表见 **[architecture/runtime-data.md](../architecture/runtime-data.md)**。

| 用途 | 运行时（典型） | Base URL（示例） | 路径前缀 |
|------|----------------|------------------|----------|
| 健康检查与用户 API | Proxy（CF Worker 或 Node） | `https://<proxy>/` | `/`、`/health`、`/catalog/*`、`/v1/*`、`/v1beta/*` |
| 管理 API | Admin（OpenNext 或 Node） | `https://<admin>/` | **`/api/admin/*`**（服务端重写为内部 `/admin/*`） |

**与实现对齐**：Proxy 路由以 **`packages/proxy/src/app.ts`** 及各 **`packages/proxy/src/routes/**`**（含 **`routes/catalog.ts`**）为准；根路径 JSON 见该文件（`name: octafuse-proxy`）。管理路由以 **`packages/admin/lib/admin-app.ts`** 及 **`packages/admin/lib/routes/admin/**`** 为准。

## 扩展文档

- [运行时与数据存储架构](../architecture/runtime-data.md)（Cloudflare / Node，D1 / Postgres / MySQL）
- [2.0 路由拓扑](../architecture/route-topology.md)（Request Surface → Route Pool → Upstream Target）
- [渠道模型思考参数配置说明](../reference/provider-thinking-configs.md)
- [文生图模型（gpt-image-2 / Seedream）](../reference/image-models.md)
- [路由策略（hash_affinity / weighted_random / …）](../reference/route-strategies.md)
- [流式计费与客户端取消](../reference/streaming-billing.md)
- [Admin 分层约束](../architecture/admin-layered.md)
- [用户审计日志（`user_audit_logs`）](../reference/user-audit-logs.md)
- Schema 与迁移：D1 在 **`packages/core/migrations-d1/`**（`wrangler.d1.jsonc` 与之同目录）；Postgres 在 **`packages/core/migrations-postgres/`**；MySQL 在 **`packages/core/migrations-mysql/`**

## 基础信息

- **Content-Type**：`application/json`（除非个别接口另有说明）

## 认证方式

| 认证类型 | 使用场景 | 说明 |
|---------|---------|------|
| 无认证 | 健康检查、公开目录 | Proxy：`/`、`/health`、**`GET /catalog/models`**（运行时模型能力发现，见 [用户接口](./user.md#公开模型目录catalog-discovery)） |
| 具名 Admin API Key | 管理接口 | 后台创建并授予资源权限；请求打在 **`{GATEWAY_MASTER_URL}/api/admin/...`**（Admin Pages 根 URL） |
| Bearer Token (User Key) | 用户接口 | `sk-…`，请求打在 **Proxy** 的 `/v1/*` 等 |
| `x-api-key` | Anthropic 兼容 | `POST /v1/messages` |
| `?key=` / `x-goog-api-key` | Gemini 兼容 | `POST /v1beta/models/...` |

## API 按权限分类

### [公开接口](./public.md)（Proxy）

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 服务名与版本 |
| `/health` | GET | 健康检查 |
| `/catalog/models` | GET | 运行时模型目录（协议 / route group；**无需** API Key） |

### [管理接口](./admin.md)（Admin：`/api/admin/*`）

文档正文以 **内部路径 `/admin/*`** 描述（与 Hono 挂载一致）；对外调用时替换为 **`/api/admin/*`**。完整矩阵见 [Admin API 矩阵](./admin.md#admin-api-matrix)。

### [用户接口](./user.md)（Proxy）

| 端点 | 方法 | 描述 |
|------|------|------|
| `/v1/chat/completions` | POST | OpenAI 兼容聊天 |
| `/v1/responses` | POST | OpenAI Responses 透传（流式 / 非流式） |
| `/v1/images/generations` | POST | OpenAI 兼容图片生成（见 [image-models](../reference/image-models.md)） |
| `/v1/images/edits` | POST | OpenAI 兼容图片编辑（multipart；Seedream 不适用） |
| `/v1/audio/transcriptions` | POST | OpenAI 兼容语音转写（multipart；`per_second` / `token` 双模式计费，见 [user.md](./user.md#语音转写audio-transcriptions)） |
| `/v1/audio/speech` | POST | OpenAI 兼容语音合成（完整音频 / 流式；按字符计费） |
| `/v1/dashscope/realtime` | GET / WebSocket | DashScope 原生实时 ASR / TTS（见 [dashscope-audio](../architecture/dashscope-audio.md)） |
| `/v1/tools/web-search` | POST | Agent Tools：联网搜索（按次计费；Admin Tools 配置 Active 引擎） |
| `/v1/tools/web-fetch` | POST | Agent Tools：网页抓取（按次计费） |
| `/v1/tools/web-deep-search` | POST | Agent Tools：深度检索（搜+读；按次计费） |
| `/v1/tools/ai-detection` | POST | Agent Tools：AI 率检测（按计费字符单元计费） |
| `/v1/tools/pricing` | GET | Agent Tools：只读定价（不含密钥与 Active 引擎名） |
| `/v1/messages` | POST | Anthropic Messages |
| `/v1beta/models/:modelAction` | POST | Gemini `generateContent` / `streamGenerateContent` |
| `/v1/models` | GET | 模型列表（需用户 Key；OpenAI 兼容形态；默认仅 LLM，可用 `kind=image` / `kind=audio` / `kind=all`） |
| `/catalog/models` | GET | 公开模型目录 discovery（无需 Key；含 `protocols_by_group`，见 [详细说明](./user.md#公开模型目录catalog-discovery)） |
| `/v1/me` | GET | 预算与元数据 |

## 错误响应

| 场景 | 响应体 |
|------|--------|
| **`/v1/*` 网关自造** | `{ "error": "...", "code": "gateway.*" }`（`error` **保持字符串**；另加响应头 `X-OctaFuse-Error-Code`） |
| Provider 全部熔断（429） | `{ "error": { "code": "circuit.upstream_capacity_exhausted", "type": "upstream_capacity_exhausted", "message": "...", "retry_after_seconds": 30 } }`，并带 `Retry-After` |
| 敏感内容熔断（429） | `{ "error": { "code": "circuit.sensitive_content", ... } }` + `Retry-After`（LLM / images / audio 均可能） |
| 上游 400 客户端错误熔断（400） | `{ "error": { "code": "circuit.client_error", "type": "upstream_client_error_circuit_open", "message": "<回放原文>", ... } }`（**仅** chat / messages / gemini；images / audio **不会**出现此短路） |
| 上游透传非 2xx | **body 不改**；响应头 `X-OctaFuse-Error-Code: upstream.*` |
| **管理接口**：未授权 | 多为 `{ "error": "Unauthorized" }`（401） |
| **管理接口**：业务失败 | 多为 `{ "success": false, "message": "..." }` |

### 固定错误 code（Agent 对接契约）

响应头 **`X-OctaFuse-Error-Code`** 覆盖所有非 2xx。网关自造错误另在 body 顶层（或嵌套 `error.code`）带同一值。

| 前缀 | 含义 | 示例 |
|------|------|------|
| `gateway.*` | 请求未出网关 | `gateway.budget_exceeded`、`gateway.invalid_json`、`gateway.model_not_found`、`gateway.auth_failed`、`gateway.no_route`、`gateway.route_resolution_failed`、`gateway.invalid_request`、`gateway.upstream_request_failed` |
| `circuit.*` | 熔断短路（未打上游） | `circuit.sensitive_content`、`circuit.client_error`、`circuit.upstream_capacity_exhausted` |
| `upstream.*` | 已打上游，网关分类 | `upstream.content_filter`（敏感 400）、`upstream.invalid_request`（其他 400）、`upstream.rate_limited`、`upstream.auth_failed`、`upstream.not_found`、`upstream.server_error`、`upstream.timeout` |

常见 HTTP 状态码：400 参数错误 / 上游客户端错误熔断（chat 等）；401 认证失败；403 预算/配额；404 资源不存在；429 敏感内容熔断或全部 provider 熔断；500 服务器错误；502 路由/上游错误。熔断策略细节见 [proxy-request-lifecycle.md](../architecture/proxy-request-lifecycle.md) §2.2 / §3.2。
