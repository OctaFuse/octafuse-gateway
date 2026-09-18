# 代理服务错误码

用户侧 `/v1/*`、`/v1beta/*` 的分类权威是响应头 **`X-OctaFuse-Error-Code`**。调用方应先按该值分支，再看 HTTP 状态与 `error` 文案。HTTP 状态**不唯一**（例如 404 可能是模型不存在、没有可用路由，或上游 `upstream.not_found`）。

源码清单：[`packages/proxy/src/services/gateway-error-codes.ts`](../../../packages/proxy/src/services/gateway-error-codes.ts)。增删 code 时必须同步本文。

生命周期与熔断细节见 [proxy-request-lifecycle.md](../architecture/proxy-request-lifecycle.md)。本文只列对接契约。

## 怎么读

1. 读 **`X-OctaFuse-Error-Code`**（所有已走统一错误封装的非 2xx）。
2. 若无该头，再读 body 顶层 `code` 或嵌套 `error.code`。
3. `error` / `error.message` 给人看或打日志，不要当作稳定分支键（上游原文会变）。
4. 需要退避时看 `Retry-After` 或嵌套 `retry_after_seconds`。

## Body 形状

| 类型 | 形状 | 何时出现 |
|------|------|----------|
| 扁平 | `{ "error": "<字符串>", "code": "gateway.*" }` | 网关自造（鉴权、缺模型、没有可用路由、额度、RPM、选路失败等） |
| 嵌套 | `{ "error": { "code": "circuit.*", "message": "...", "type": "...", ... } }` | 熔断短路 |
| 上游透传 | **不改供应商原文** | 已打上游的非 2xx；只在响应头打 `upstream.*` |

管理后台（Admin）`/api/admin/*` **不使用**本清单：未授权多为 `{ "error": "Unauthorized" }`，业务失败多为 `{ "success": false, "message": "..." }`。

智能体工具（Agent Tools）`/v1/tools/*` 在鉴权 / RPM / 中间件额度上会带本清单的 code；工具本身的 400 / 502 / 503 目前多为 `{ "error": "<字符串>" }`，**不一定**有 `X-OctaFuse-Error-Code`。

## 前缀

| 前缀 | 含义 | 建议 |
|------|------|------|
| `gateway.*` | 请求未出网关，或网关在出站前失败 | 按具体 code 决定：改请求、补路由、充值、换 Key，或对瞬时 502 重试 |
| `circuit.*` | 熔断短路，这次没打上游 | 尊重 `Retry-After`；敏感内容不要原样重放 |
| `upstream.*` | 已经打过上游，网关按状态 / 正文分类 | 可重试限流、超时、5xx；不要对内容安全 / 参数错误盲目重试 |
| `responses.*` | OpenAI Responses 会话约束 | 去掉 `previous_response_id` 或改用单上游目标路由池 |

---

## `gateway.*`

| code | HTTP | 典型 `error` | 调用方建议 |
|------|------|----------------|------------|
| `gateway.auth_failed` | 401 | `Missing or invalid API key` / `Invalid API key` | 检查 Key 与放法（Bearer / `x-api-key` / Gemini `key`） |
| `gateway.invalid_json` | 400 | `Invalid JSON body` | 修请求体 |
| `gateway.missing_model` | 400 | `Missing model` | 补 `model`（实时入口是 query） |
| `gateway.invalid_request` | 400 或 **426** | 入参校验失败；实时入口非 WebSocket 升级时为 426 | 按文案改请求；426 改为 WebSocket |
| `gateway.model_not_found` | 404 | `Model not found` | 模型 ID 不在目录；对一下 `GET /v1/models` / `GET /catalog/models` |
| `gateway.no_route` | 404 | `No available route` | 模型在，但当前协议 / operation / 路由组没有可用上游目标。去路由工作台补请求入口或上游目标，不要当成「模型拼写错误」 |
| `gateway.budget_exceeded` | 403 | `Budget exceeded` | 周期额度或永久额度用尽；充值或等重置。不要立刻重试同一请求 |
| `gateway.rate_limited` | 429 | `Rate limit exceeded` | Key 或用户 RPM 窗口满。等 `Retry-After` 后再发 |
| `gateway.route_resolution_failed` | 502 | 选路查询抛错原文 | 网关读库 / 解析路由失败。可有限次重试；持续出现查运维 |
| `gateway.upstream_request_failed` | 502 | `Upstream request failed: …` | 出站 fetch 失败（DNS / TLS / 网络）。可换供应商故障转移已发生时，这是最后一次失败；可短退避重试 |

---

## `circuit.*`

| code | HTTP | Body | 调用方建议 |
|------|------|------|------------|
| `circuit.sensitive_content` | 429 | 嵌套；`Retry-After` | 用户+模型因上游敏感内容熔断。改提示词后再试；到期前不要原样重放 |
| `circuit.client_error` | 400 | 嵌套；`message` 为上次上游 400 回放 | **仅** chat / messages / Gemini。改参数后再发。Images / Audio **不会**走这条短路 |
| `circuit.upstream_capacity_exhausted` | 429 | 嵌套；`Retry-After` | 候选供应商全部熔断，零上游调用。等冷却后重试 |

---

## `upstream.*`

只出现在**已经打过上游**的非 2xx。Body 保持供应商形状；分类只在响应头。

| code | 典型 HTTP | 判定要点 | 调用方建议 |
|------|-----------|----------|------------|
| `upstream.content_filter` | 400 | 正文命中敏感内容检测 | 改内容；不要原样重试 |
| `upstream.invalid_request` | 400 或其他未单列的 4xx | 其余客户端错误 | 按上游原文改参 |
| `upstream.not_found` | 404 | 上游资源 / 模型不存在 | 核对路由上的 `provider_model_name`，不是网关模型 ID |
| `upstream.auth_failed` | 401 / 403 | 上游拒认供应商 Key | 运维查供应商密钥；客户端一般无法自愈 |
| `upstream.rate_limited` | 429 | 上游限流 | 网关可能已换供应商；仍失败则退避重试 |
| `upstream.timeout` | 524 等 | 边缘 / 网关超时类 | 可退避重试；长请求检查超时配置 |
| `upstream.server_error` | 5xx（非 524） | 上游服务错误 | 可退避重试 |

---

## `responses.*`

| code | HTTP | 典型 `error` | 调用方建议 |
|------|------|----------------|------------|
| `responses.state_route_unavailable` | 409 | `previous_response_id cannot be routed: …` | 多上游目标时无法保证回到同一上游。去掉 `previous_response_id`，或把该模型放到单一上游目标的路由池 |
| `responses.unsupported_state_operation` | — | （枚举已占位，当前路由未返回） | 不要依赖；若出现视为协议能力未开通 |

---

## 同一 HTTP、不同 code

| HTTP | 可能的 code |
|------|-------------|
| 400 | `gateway.invalid_json`、`gateway.missing_model`、`gateway.invalid_request`、`circuit.client_error`、`upstream.invalid_request`、`upstream.content_filter` |
| 401 | `gateway.auth_failed`、`upstream.auth_failed` |
| 403 | `gateway.budget_exceeded`、`upstream.auth_failed` |
| 404 | `gateway.model_not_found`、`gateway.no_route`、`upstream.not_found` |
| 409 | `responses.state_route_unavailable` |
| 426 | `gateway.invalid_request`（实时入口需要 WebSocket） |
| 429 | `gateway.rate_limited`、`circuit.sensitive_content`、`circuit.upstream_capacity_exhausted`、`upstream.rate_limited` |
| 502 | `gateway.route_resolution_failed`、`gateway.upstream_request_failed`、以及上游 502 透传时的 `upstream.server_error` |

## 维护

- 新增 / 重命名 code：先改 `GatewayErrorCode`，再改本文与 [api/README.md](./README.md) 的摘要。
- 不要把上游供应商私有 `error.code` 写进本清单；上游值只存在透传 body 里。
- 管理后台与智能体工具本地 4xx/5xx 若尚未走 `gatewayErrorJson`，不要假装它们已有本表 code。
