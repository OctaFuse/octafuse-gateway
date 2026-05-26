# Octafuse API 文档

OpenAI 兼容的 AI Gateway：用户推理、API Key 与目录管理、用量与日志。实现分布在 **`packages/proxy`**（用户协议）、**`packages/admin`**（管理协议）与共享库 **`packages/core`**。

## 部署形态与 Base URL

生产默认：**Cloudflare**（Proxy Worker + Admin Pages）+ **D1**。同一套 API 也可跑在 **Node + Postgres / MySQL**（或 Hybrid）；总表见 **[architecture/runtime-data.md](../architecture/runtime-data.md)**。

| 用途 | 运行时（典型） | Base URL（示例） | 路径前缀 |
|------|----------------|------------------|----------|
| 健康检查与用户 API | Proxy（CF Worker 或 Node） | `https://<proxy>/` | `/`、`/health`、`/catalog/*`、`/v1/*`、`/v1beta/*` |
| 管理 API | Admin（OpenNext 或 Node） | `https://<admin>/` | **`/api/admin/*`**（服务端重写为内部 `/admin/*`） |

**与实现对齐**：Proxy 路由以 **`packages/proxy/src/app.ts`** 及各 **`packages/proxy/src/routes/**`**（含 **`routes/catalog.ts`**）为准；根路径 JSON 见该文件（`name: octafuse-proxy`）。管理路由以 **`packages/admin/lib/admin-app.ts`** 及 **`packages/admin/lib/routes/admin/**`** 为准。

## 扩展文档

- [运行时与数据存储架构](../architecture/runtime-data.md)（Cloudflare / Node，D1 / Postgres / MySQL）
- [渠道模型思考参数配置说明](../reference/provider-thinking-configs.md)
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
| Bearer Token (MASTER_KEY) | 管理接口 | 与 D1 `system_config.MASTER_KEY` 一致；请求打在 **`{GATEWAY_MASTER_URL}/api/admin/...`**（Admin Pages 根 URL） |
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
| `/v1/messages` | POST | Anthropic Messages |
| `/v1beta/models/:modelAction` | POST | Gemini `generateContent` / `streamGenerateContent` |
| `/v1/models` | GET | 模型列表（需用户 Key；OpenAI 兼容形态） |
| `/catalog/models` | GET | 公开模型目录 discovery（无需 Key；含 `protocols_by_group`，见 [详细说明](./user.md#公开模型目录catalog-discovery)） |
| `/v1/me` | GET | 预算与元数据 |

## 错误响应

| 场景 | 响应体 |
|------|--------|
| **`/v1/*`** | 多为 `{ "error": "..." }` |
| **管理接口**：未授权 | 多为 `{ "error": "Unauthorized" }`（401） |
| **管理接口**：业务失败 | 多为 `{ "success": false, "message": "..." }` |

常见 HTTP 状态码：400 参数错误；401 认证失败；403 预算/配额；404 资源不存在；500 服务器错误；502 路由/上游错误。
