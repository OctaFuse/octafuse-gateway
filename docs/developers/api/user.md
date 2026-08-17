# 用户接口

需要用户 API Key 认证的 OpenAI / Anthropic / Gemini 兼容 API。以下路径均部署在 **Proxy Worker**（`GATEWAY_URL`），与 Admin 的 `/api/admin/*` 无关。

## 认证

默认使用 `Authorization: Bearer <USER_API_KEY>`。

```bash
Authorization: Bearer sk-xxx...
```

针对不同协议兼容入口，也支持以下认证位置：

- `POST /v1/messages`：支持 `x-api-key: <USER_API_KEY>`（Anthropic SDK 常用）
- `POST /v1beta/models/...`：支持 `?key=<USER_API_KEY>` 或 `x-goog-api-key: <USER_API_KEY>`（Gemini SDK 常用）

---

## 模型 ID 与路由组（route group）

网关按 `models` 表中的 **模型 ID** 解析路由；客户端通过请求里的 **`model` 字符串**（或 Gemini 路径中的模型段）选择 **计费/供应商通道**（`model_routes.route_group`，如 `default`、`free`）。

### 1. `baseId` 或 `baseId:group`

与 OpenAI 一样传入 `model` 字段（或 Gemini 路径中的模型段），解析规则由 `resolveModelRouting` 实现：

1. **整串命中** `models.id`：视为基础模型 ID；**无显式路由组**，选路时使用 **`default`** 路由组（等价于未写后缀时请求 `baseId:default`）。
2. **整串未命中**：按 **最后一个 `:`** 拆成 `prefix` + `suffix`。若 `prefix` 命中 `models.id`，则 **基础模型** = `prefix`，**显式路由组** = `suffix`（trim 后非空）。

示例：

| 传入 `model` | 基础模型 ID | 显式路由组 / 有效组 |
|--------------|-------------|---------------------|
| `deepseek-v3.2` | `deepseek-v3.2` | 无后缀 → 有效组 **`default`** |
| `deepseek-v3.2:free` | `deepseek-v3.2` | `free` |
| `deepseek-v3.2:default` | `deepseek-v3.2` | `default` |

**注意**：若数据库里存在 **本身含 `:`** 的 `models.id` 且与整串完全一致，会优先按 **整条** 当作模型 ID 匹配，不再拆分。生产环境应避免模型 ID 与 `base:group` 语法冲突。

### 2. 有效路由组与选路

请求使用的 **有效路由组** 为：

- 客户端传入 **`baseId:group`** 且 `group` 非空 → 有效组 = 该 `group`（trim，比较时 **忽略大小写**）。
- 仅传入 **`baseId`**（整串命中 `models.id`）→ 有效组 = **`default`**。

2.0 会根据 `model_id + route_group + request_protocol + request_operation` 解析 Request Surface：先查精确 operation，再回退迁移生成的 `*` Surface。Surface 指向一个 Route Pool，Proxy 仅在该 Pool 内选择 active Target，并跳过 **disabled / 无 api_key** 的 Provider。Pool 内按 **priority（DESC）分层** + **有效策略 + weight** 做 failover；Pool 策略优先于模型与全局策略。当前版本只支持 `adapter=passthrough`，因此 Target 的上游协议必须与请求协议一致。

没有匹配 Surface / active Target 或没有当前协议可用上游时，按入口返回 **400** 或 **502**。完整拓扑、operation 列表与迁移兼容路径见 [route-topology.md](../architecture/route-topology.md)。

模型 **`tags` 不参与**选组或计费。需要限定某一组时，请使用 **`baseId:your_group`**。

**免费 / 零扣费**：`charged_cost` = 模型目录价 × 有效倍率。无 `schedule.mode` 时有效倍率 = `charged_factor` × 命中窗 `factor`（未命中为 1）；`mode: "override"` 时命中窗用窗口 `factor`，未命中用 `charged_factor`。若要用户侧不扣费，将 **Charged factor** 或对应窗口 `factor` 设为 `0`。

### 3. 预算校验

`POST /v1/chat/completions`、`POST /v1/responses`、`POST /v1/messages` 与 Gemini `POST /v1beta/models/...` 在转发上游前，对 **用户 API Key** 统一执行 **`budget_max` / `budget_spent`** 校验：当 `budget_max` 非空且 `budget_spent >= budget_max` 时返回 **403** `Budget exceeded`。

路由组（`default`、`free` 等）仅影响 **选路与计费快照**（见下文用量日志），**不再**单独绕过预算或走按日免费次数表。一次性试用额度等场景请通过 **`budget_period = 'none'`** 与 `budget_max` / `budget_base` 在 **User** 上表达（经管理 API / 门户侧更新 `users`；API Key 仅用于鉴权与归集）。

### 4. 用量日志 `api_key_request_logs`

写入的 **`model_id` 为库内基础模型 ID**（不带 `:group` 后缀）；实际选用的 **`route_group`**、`request_protocol` / `request_operation`、`model_surface_id`、`route_pool_id`、`route_target_id`、`upstream_protocol` / `upstream_operation`、`adapter` 与 `route_trace` 会随请求落库。`provider_key_id` / `provider_key_label` / `provider_key_fingerprint` 为历史兼容列名，现对应 **`providers.id` / `providers.name` / fingerprint(`providers.api_key`)**。相对目录标准价的倍率请见 Target 的 **`price_override`** 中的 **`charged_factor`** / **`metered_factor`**（及兼容字段 **`provider_factor`**）。

### 5. 输出长度（`max_tokens` / `maxOutputTokens`）

- Gateway **不会**根据 D1 **`models.max_tokens`** 改写或截断用户请求；该字段在 `GET /v1/models` 等处仅作**目录/展示参考**。
- 实际上游请求体由 **`model_routes.custom_params`** 与客户端 JSON **深度合并**得到（实现见 `buildRouteRequestBody`）：**客户端显式提供的字段优先**于路由默认值。
- 若客户端不传 `max_tokens`（OpenAI Chat、Anthropic Messages）或不传 `generationConfig.maxOutputTokens`（Gemini），则由路由 JSON 中的默认值或**上游服务商的 API 默认**决定。
- 运维若希望为某条路由提供默认最大输出，可在该路由的 **`custom_params`** 中配置，例如 OpenAI/Anthropic 顶层 `"max_tokens": 4096`，Gemini 使用嵌套 `"generationConfig": { "maxOutputTokens": 8192 }`。
- **注意**：因合并规则为客户端优先，仅靠 `custom_params` **无法**在客户端已显式传入更大值时实现「硬封顶」；若需要运营侧强制上限，需另行设计（不在当前文档范围）。

---

## 聊天补全

OpenAI 兼容的聊天补全接口，支持流式输出。

### 请求

```
POST /v1/chat/completions
```

### 请求体

```json
{
  "model": "glm-4",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 2048
}
```

`model` 可使用 **`baseId`** 或 **`baseId:route_group`**（见上文）。网关会将上游请求的 `model` 替换为路由上的 `provider_model_name`。

### 响应

**非流式响应：**

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1705800000,
  "model": "glm-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

**流式响应（SSE）：**

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1705800000,"model":"glm-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1705800000,"model":"glm-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1705800000,"model":"glm-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### 错误响应

| 场景 | HTTP | 示例 `error` |
|------|------|----------------|
| 请求体非法 JSON | 400 | `Invalid JSON body` |
| 缺少 `model` | 400 | `Missing model` |
| `/v1/images/edits` Content-Type 非 `multipart/form-data` | 400 | `Unsupported Content-Type for /v1/images/edits: expected multipart/form-data, got "…"` |
| `/v1/images/edits` multipart 解析失败 | 400 | `Invalid multipart body` |
| 有效路由组下无活跃路由（含未写后缀时的 **`default`**） | 400 | `No active routes for route group "default" for this model` |
| 预算超限 | 403 | `Budget exceeded` |
| 模型不存在 | 404 | `Model not found` |
| 路由解析失败等 | 502 | 具体错误信息 |
| 无 OpenAI 协议路由（有效组内无可用上游） | 502 | `No OpenAI route in route group "default" for this model`（组名随有效组变化） |

Images 入参校验失败会打结构化 `console.warn('[Gateway Images] request rejected', …)`（含 `contentType` / `bodyKeys` / `hasModel` 等，**不含** prompt / 图片字节）。Proxy 另有通用 4xx 短错误体日志 `[Gateway] client error response`。

### 示例

**非流式请求：**

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4",
    "messages": [
      {"role": "user", "content": "Say hello in 3 languages"}
    ]
  }'
```

**指定 free 路由组：**

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx..." \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v3.2:free","messages":[{"role":"user","content":"hi"}]}'
```

---

## Responses

OpenAI Responses 兼容入口，支持非流式 JSON 与 `stream=true` 的 typed SSE。上游必须配置 `openai.responses` 请求入口，并使用同协议 `passthrough`。

### 请求

```
POST /v1/responses
```

### 请求体

```json
{
  "model": "gpt-4.1",
  "input": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true,
  "store": false
}
```

`model` 可使用 **`baseId`** 或 **`baseId:route_group`**（见上文）。网关会将上游请求的 `model` 替换为路由上的 `provider_model_name`，其余字段默认原样透传。

`previous_response_id` 仅在单一上游目标（或不会切换目标的路由池）下透传。多目标且无法保证回到同一上游时返回 **409** `responses.state_route_unavailable`。当前不提供 Conversations、background retrieve/cancel 或 Chat ↔ Responses 转换。

### 示例

```bash
curl http://localhost:8787/v1/responses \
  -H "Authorization: Bearer sk-xxx..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1",
    "input": [{"role": "user", "content": "Hello"}],
    "store": false
  }'
```

---

## Anthropic Messages 兼容接口

Anthropic 兼容入口，支持 `messages` 与流式。

### 请求

```
POST /v1/messages
```

### 请求体示例

```json
{
  "model": "claude-3-7-sonnet",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Write a haiku about coding." }
  ],
  "stream": true
}
```

`model` 同样支持 `baseId:route_group`；仅 **Anthropic**（`upstream_protocol = anthropic`）路由会参与转发。

### 认证示例

```bash
curl http://localhost:8787/v1/messages \
  -H "x-api-key: sk-xxx..." \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-7-sonnet",
    "max_tokens": 512,
    "messages": [{"role":"user","content":"hello"}]
  }'
```

> 网关会按 `request_protocol = anthropic` 记录用量与计费。

---

## Gemini 兼容接口

Gemini 兼容入口，支持 `generateContent` 与 `streamGenerateContent`。

### 请求

```
POST /v1beta/models/:modelAction
```

其中 `:modelAction` 格式为 **`{modelSegment}:{generateContent|streamGenerateContent}`**，`modelSegment` 为传给 `resolveModelRouting` 的原始字符串（可为 **`baseId`** 或 **`baseId:routeGroup`**）。解析时以 **最后一个 `:`** 为界，后缀必须是 `generateContent` 或 `streamGenerateContent`。

示例：

- `gemini-2.5-pro:generateContent`
- `deepseek-v3.2:free:streamGenerateContent` → 模型段 `deepseek-v3.2:free` → 基础 `deepseek-v3.2`、显式组 `free`

### 请求体示例

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Explain recursion in one paragraph." }]
    }
  ],
  "generationConfig": {
    "maxOutputTokens": 1024
  }
}
```

### 认证示例

```bash
curl "http://localhost:8787/v1beta/models/gemini-2.5-pro:generateContent?key=sk-xxx..." \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"role":"user","parts":[{"text":"hello"}]}]
  }'
```

**流式：**

```bash
curl "http://localhost:8787/v1beta/models/gemini-2.5-pro:streamGenerateContent?key=sk-xxx..." \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Write a short poem"}]}]}'
```

> 网关会按 `request_protocol = gemini` 记录用量与计费；仅 **Gemini** 协议路由参与转发。

### 上游 Provider `endpoints`（Gemini 多入口：Developer / Vertex Express）

Admin 中 Provider 的权威配置为 **`providers.endpoints`** JSON（迁移 `0011_provider_endpoints`）。Gemini 协议优先写：

```json
{ "gemini": { "base": "https://generativelanguage.googleapis.com/v1beta/models" } }
```

`base` 须配置到 **`{model}` 之前**的完整路径前缀（网关不再自动补 `/v1beta/models`）；出站由 `resolveUpstreamEndpoint` 派生为 `{base}/{upstreamModel}:{action}`。非标准厂商优先配置统一模板：

```json
{
  "gemini": {
    "endpoints": {
      "models.generate": "https://example.com/v1beta/models/{model}:{action}"
    }
  }
}
```

`models.generate` 模板必须同时包含 **`{model}`** 与 **`{action}`**，一次配置覆盖 `generateContent` 和 `streamGenerateContent`。旧的 `generateContent` / `streamGenerateContent` 独立模板仍可读写以兼容历史数据；运行时优先级为 `models.generate` → 对应旧 action 模板 → `base` 派生。新配置不应继续拆成两个旧键。

**客户端入口**始终为 `POST /v1beta/models/...`（与 `@google/genai` SDK 兼容）。

| 接入风格 | 示例 `endpoints.gemini.base` | 网关出站 URL 形态 |
|----------|------------------------------|-------------------|
| Developer API | `https://generativelanguage.googleapis.com/v1beta/models` | `{base}/{upstreamModel}:{action}?key=` |
| Vertex AI Express（API Key） | `https://aiplatform.googleapis.com/v1/publishers/google/models` | `{base}/{upstreamModel}:{action}?key=` |
| Vertex 兼容聚合（Bearer） | 写到 `{model}` 前，并设 `auth: "bearer"` | `{base}/{upstreamModel}:{action}` + `Authorization: Bearer` |
| 自定义反代 / 其他前缀 | 按上游文档写到 `{model}` 前 | 由 `auth` 决定，省略则为 `?key=` |

- **`upstreamModel`** 来自路由的 `provider_model_name`（裸模型名，如 `gemini-2.5-flash`），与客户端路径中的 `modelSegment`（可含 `:route_group`）独立。
- 仅配置裸 host（如 `https://generativelanguage.googleapis.com`）会在出站时报错。
- Vertex Express 与 Developer API 的请求体、响应体、SSE、`usageMetadata` 一致。
- 出站鉴权只认 `endpoints.gemini.auth`：`query-key`（`?key=`）或 `bearer`（`Authorization`）；省略则为 `query-key`。任意 Vertex 兼容上游在 Provider 上选 Bearer 即可，不必改核心代码。

权威配置为 **`providers.endpoints`**（迁移 **`0012`** 已删除 `base_url_*` 三列）。Gemini 须在 Admin 或 API 中把 `endpoints.gemini.base` 配到 `{model}` 之前的完整路径前缀（见上表）。

---

## 获取模型列表

OpenAI 兼容的模型列表接口。返回网关中 **至少有一条活跃路由** 的模型（全量可见，不按 API Key 区分）。

面向 Chat Completions / Agent 的默认行为：**仅返回 LLM**（排除文生图与 ASR；多模态「看图」LLM 仍会返回）。文生图模型（如 `gpt-image-2`）请使用 `POST /v1/images/*` 或 `kind=image`；语音转写（如 `whisper-1`）请使用 `POST /v1/audio/transcriptions` 或 `kind=audio`；`kind=all` 不过滤。

### 请求

```
GET /v1/models
```

可选查询参数：

| 参数 | 说明 |
|------|------|
| `route_groups` | CSV，大小写不敏感。未传 → 默认 `default,free`；传入后仅保留匹配的 group（无匹配则该模型不出现） |
| `kind` | `llm`（**默认**）仅文本/多模态 LLM；`image` 仅文生图；`audio` 仅语音转写 ASR；`all` 不过滤 kind。非法值回退为 `llm` |

### 响应

```json
{
  "data": [
    {
      "id": "glm-4",
      "object": "model",
      "owned_by": "octafuse",
      "model_info": {
        "display_name": "GLM-4",
        "vendor": "zhipu",
        "tags": ["pro", "general"],
        "route_groups": ["default", "free"],
        "context_window": 128000,
        "max_tokens": 4096,
        "pricing_profile": "{\"tiers\":[{\"upto\":null,\"label\":null,\"input_price\":0.01,\"output_price\":0.01,\"cache_read_price\":null,\"cache_write_price\":null}]}",
        "input_price": 0.01,
        "output_price": 0.01,
        "description": "智谱 GLM-4 通用模型",
        "input_modalities": ["text", "image", "file"],
        "output_modalities": ["text"],
        "released_at": "2024-06-05",
        "metadata": {}
      }
    }
  ],
  "object": "list"
}
```

### model_info 字段说明

| 字段 | 类型 | 描述 |
|------|------|------|
| `display_name` | string \| null | 模型显示名称 |
| `vendor` | string | 模型供应商标识，如 `openai`、`anthropic`、`google` |
| `tags` | string[] | 模型标签数组，如 `["free", "general"]`（**仅展示/目录元数据**，不参与自动选组或计费公式） |
| `route_groups` | string[] | 当前模型下 **活跃路由** 的去重 `route_group` 列表，供客户端构造请求中的 `baseId:group` |
| `context_window` | number \| null | 上下文窗口大小（token 数） |
| `max_tokens` | number \| null | 目录/展示用参考（常见最大输出能力）；**转发时不用于截断**，实际输出上限见上文「输出长度」 |
| `pricing_profile` | string \| null | 模型主定价 JSON（canonical：`{ "tiers": [ { "upto", "label", "input_price", "output_price", … } ] }`）；**末档 `upto` 为 `null` 表示开放上界**；完整阶梯与 cache 价以此为准 |
| `input_price` | number \| null | **兼容展示**：由 `pricing_profile` 派生（取各档中 **最低** `input_price` 所在档的输入价）；无合法 profile 时为 `null` |
| `output_price` | number \| null | **兼容展示**：与上档同行的输出价（$/1M） |
| `description` | string \| null | 模型描述 |
| `input_modalities` | string[] \| null | 支持的输入模态（OpenRouter 风格）：`text`、`image`、`audio`、`video`、`file`；客户端可据此限制附件类型 |
| `output_modalities` | string[] \| null | 支持的输出模态：`text`、`image`、`audio` |
| `released_at` | string \| null | 模型发布日期（`YYYY-MM-DD`） |
| `metadata` | object \| undefined | 扩展元数据 |

### 示例

```bash
# Agent / Chat：默认仅 LLM
curl http://localhost:8787/v1/models \
  -H "Authorization: Bearer sk-xxx..."

# 仅文生图
curl "http://localhost:8787/v1/models?kind=image" \
  -H "Authorization: Bearer sk-xxx..."

# 全部 kind
curl "http://localhost:8787/v1/models?kind=all" \
  -H "Authorization: Bearer sk-xxx..."
```

---

## 公开模型目录（Catalog Discovery）

面向门户、文档站等 **无需用户 API Key** 的运行时能力发现接口。基于 **active `model_routes`** 聚合各 `route_group` 支持的 **`upstream_protocol`**，不返回 provider id、API key、`provider_model_name` 等运维字段。

### 请求

```
GET /catalog/models
```

可选查询参数：

| 参数 | 说明 |
|------|------|
| `route_groups` | CSV，大小写不敏感。未传 → 包含模型下 **全部** active route group；传入后仅保留匹配的 group（无匹配则该模型不出现在列表中） |

### 响应

```json
{
  "object": "list",
  "generated_at": "2026-05-26T13:00:00.000Z",
  "data": [
    {
      "id": "glm-4",
      "display_name": "GLM-4",
      "vendor": "zhipu",
      "context_window": 128000,
      "max_tokens": 4096,
      "pricing_profile": {
        "tiers": [
          {
            "upto": null,
            "label": null,
            "input_price": 0.01,
            "output_price": 0.01,
            "cache_read_price": null,
            "cache_write_price": null
          }
        ]
      },
      "tags": ["general"],
      "route_groups": ["default", "free"],
      "protocols": ["openai"],
      "protocols_by_group": {
        "default": ["openai"],
        "free": ["openai"]
      },
      "recommended_protocol": "openai",
      "description": "智谱 GLM-4 通用模型",
      "input_modalities": ["text", "image", "file"],
      "output_modalities": ["text"],
      "released_at": "2024-06-05",
      "metadata": {}
    }
  ]
}
```

Catalog 条目同样包含 `input_modalities`、`output_modalities`、`released_at`（语义与 `model_info` 一致；`pricing_profile` 为解析后的对象）。

### 与 `GET /v1/models` / Admin 的差异

| 维度 | `GET /v1/models` | `GET /catalog/models` | `GET /admin/models` |
|------|------------------|------------------------|---------------------|
| 部署 | Proxy | Proxy | Admin |
| 认证 | 用户 API Key | **无** | Console Session 或具名 Admin API Key |
| 默认 `route_groups` | `default,free` | 未传 → **全部** active group | — |
| 默认 `kind` | `llm`（排除文生图） | 不过滤 kind | — |
| 协议能力 | 不返回 | `protocols` / `protocols_by_group` | 不返回 |
| 主要用途 | Agent 兼容列表 | 门户 / 公开 discovery | 运维 CRUD |

Admin 静态导入目录见 **`GET /admin/models/import/catalog`**（与上表无关，见 [管理接口](./admin.md#admin-vs-proxy-catalog)）。

### 示例

```bash
curl http://localhost:8787/catalog/models
curl "http://localhost:8787/catalog/models?route_groups=default,web"
```

---

## Web Search（Agent 工具）

协议无关的产品 API（与 `/v1/me` 同类），供桌面 agent 在模型发起 `web_search` tool call 后调用。**不是** OpenAI / Anthropic / Gemini 推理协议的一部分。Agent Tools 按 Active 引擎的**三账本绝对单价**计费（联网类按次；AI 检测按计费字符单元 × 单价）：catalog 存 `metered` / `standard` / `charged`（旧键 `cost` 为 `charged` 别名；仅有 `cost` 时三列相等）。成功写入日志三列；**仅 `charged_cost` 累加 `budget_spent`**。`pricing_audit` 为 v4 `fixed_tool_cost`（含 `unit_prices` / `totals`）；不应用模型 Route 的价格倍率或时段 schedule。失败请求三列均为 0。

### 请求

```
POST /v1/tools/web-search
Authorization: Bearer <USER_API_KEY>
```

### 请求体

```json
{
  "query": "latest TypeScript release notes",
  "allowed_domains": ["typescriptlang.org"],
  "blocked_domains": [],
  "count": 8
}
```

| 字段 | 说明 |
|------|------|
| `query` | 必填；至少 2 个字符 |
| `allowed_domains` / `blocked_domains` | 可选；**不可同时**提供 |
| `count` | 可选；1–10，默认 8 |

### 行为

1. 校验用户 API Key；`budget_max` 非空且额度不足 → **403** `{ "error": "Budget exceeded" }`
2. 从 Admin `system_config` 读取搜索配置（无环境变量回退）：
   - `WEB_SEARCH_ACTIVE`（白名单：`bocha` | `tavily` | `cleversee` | `tencent_wsa`；非法值 → **503**）
   - `WEB_SEARCH_CATALOG`（JSON：按引擎存 `{ "apiKey", "metered", "standard", "charged" }`；可带兼容键 `cost`（= charged）；Active 引擎必须有非空 `apiKey`，否则 **503**）
   - 默认单价（catalog 未写价格时）三列均为 **0.001**，单位随 `BILLING_CURRENCY`
   - 兼容：若尚无 `WEB_SEARCH_CATALOG`，仍可读旧三键 `WEB_SEARCH_PROVIDER` / `WEB_SEARCH_API_KEY` / `WEB_SEARCH_COST`（仅读取，Admin 不再写入）
3. 调用 Active 引擎；**仅成功**后按该引擎 **charged** 单价计入 `users.budget_spent`
4. 上游失败不扣费

运营侧在 Admin → **Tools → Configuration** 按引擎维护 catalog 并选择 Active；调用记录见 **Tools → Invocations**（与 Request Logs 同源，`provider_id=octafuse-tools`）。

### 响应

```json
{
  "data": {
    "results": [
      {
        "title": "…",
        "url": "https://…",
        "snippet": "…",
        "summary": "…"
      }
    ],
    "cost": 0.001
  }
}
```

用量日志 `api_key_request_logs` 中 `model_id` 记为 `tool:web-search`，`provider_id` 为 `octafuse-tools`。

---

## Web Fetch（Agent 工具）

协议无关的产品 API（与 `/v1/me` 同类），供桌面 agent 在模型发起 `web_fetch` tool call 后调用。**不是** OpenAI / Anthropic / Gemini 推理协议的一部分。

### 请求

```
POST /v1/tools/web-fetch
Authorization: Bearer <USER_API_KEY>
```

### 请求体

```json
{
  "url": "https://example.com/page"
}
```

| 字段 | 说明 |
|------|------|
| `url` | 必填；仅 `http` / `https`。Gateway 拒绝 localhost、私网字面量与元数据 host（不做 DNS 反查） |

未知字段可忽略。

### 行为

1. 校验用户 API Key；`budget_max` 非空且额度不足 → **403** `{ "error": "Budget exceeded" }`
2. 从 Admin `system_config` 读取抓取配置（无环境变量回退）：
   - `WEB_FETCH_ACTIVE`（白名单：`firecrawl` | `tavily` | `jina`；默认 `firecrawl`；非法值 → **503**）
   - `WEB_FETCH_CATALOG`（JSON：按引擎存 `{ "apiKey", "metered", "standard", "charged" }`；可带兼容键 `cost`；Active 引擎必须有非空 `apiKey`，否则 **503**）
   - 默认单价（catalog 未写价格时）三列均为 **0.002**，单位随 `BILLING_CURRENCY`
   - 兼容：若尚无 `WEB_FETCH_CATALOG`，仍可读旧三键 `WEB_FETCH_PROVIDER` / `WEB_FETCH_API_KEY` / `WEB_FETCH_COST`（仅读取，Admin 不再写入）
3. URL 校验失败 → **400**
4. 调用 Active 引擎；**仅成功**后按该引擎单价计入 `users.budget_spent`
5. 上游失败不扣费；上游 **401/403** 映射为 **502**（勿透出成用户 Key 无效）

运营侧在 Admin → **Tools → Configuration** 按引擎维护 catalog 并选择 Active；调用记录见 **Tools → Invocations**（与 Request Logs 同源，`provider_id=octafuse-tools`）。

### 响应

```json
{
  "data": {
    "url": "https://example.com/page",
    "title": "…",
    "content": "# markdown…",
    "cost": 0.002
  }
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终页面 URL（引擎回写时可能与请求不同） |
| `title` | 可选；页面标题 |
| `content` | Markdown 正文 |
| `cost` | 本次扣费；单位随 `BILLING_CURRENCY` |

用量日志 `api_key_request_logs` 中 `model_id` 记为 `tool:web-fetch`，`provider_id` 为 `octafuse-tools`。

---

## Web Deep Search（Agent 工具）

协议无关的产品 API，供「搜 + 读」一体的深度检索（Firecrawl Search / Jina Search）。相对普通 Web Search，结果常含页面正文，延迟与单价更高。**不是** OpenAI / Anthropic / Gemini 推理协议的一部分。

### 请求

```
POST /v1/tools/web-deep-search
Authorization: Bearer <USER_API_KEY>
```

### 请求体

```json
{
  "query": "latest TypeScript release notes",
  "count": 5
}
```

| 字段 | 说明 |
|------|------|
| `query` | 必填；至少 2 个字符 |
| `count` | 可选；1–10，默认 5 |

### 行为

1. 校验用户 API Key；额度不足 → **403** `{ "error": "Budget exceeded" }`
2. 从 Admin `system_config` 读取配置（无环境变量回退）：
   - `WEB_DEEP_SEARCH_ACTIVE`（白名单：`firecrawl` \| `jina`；非法值 → **503**）
   - `WEB_DEEP_SEARCH_CATALOG`（JSON：按引擎 `{ "apiKey", "metered", "standard", "charged" }`；可带兼容键 `cost`；Active 必须有非空 `apiKey`，否则 **503**）
   - 默认单价三列均为 **0.01**（catalog 未写价格时），单位随 `BILLING_CURRENCY`
3. 调用 Active 引擎；**仅成功**后按该引擎单价计入 `users.budget_spent`
4. 上游失败不扣费；上游 **401/403** 映射为 **502**

运营侧在 Admin → **Tools → Configuration** 配置；调用记录见 **Tools → Invocations**（`model_id=tool:web-deep-search`）。

### 响应

```json
{
  "data": {
    "results": [
      {
        "title": "…",
        "url": "https://…",
        "snippet": "…",
        "content": "# markdown…"
      }
    ],
    "cost": 0.01
  }
}
```

| 字段 | 说明 |
|------|------|
| `results[].content` | 可选；页面正文（deep search 核心字段） |
| `cost` | 本次扣费；单位随 `BILLING_CURRENCY` |

用量日志 `api_key_request_logs` 中 `model_id` 记为 `tool:web-deep-search`，`provider_id` 为 `octafuse-tools`。

---

## AI Detection（Agent 工具）

协议无关的产品 API，供门户或 Agent 检测文本 AI 生成概率。**不是** OpenAI / Anthropic / Gemini 推理协议的一部分。

计费与上游调用次数解耦：

| 概念 | 计算 |
|------|------|
| 上游调用次数 | `ceil(总字数 / driver.segmentMaxChars)`（技术分段，随 Active 引擎变化） |
| 计费单元数 | `ceil(总字数 / billingUnitChars)`（默认 2000；与引擎无关） |
| 扣费（用户） | `计费单元数 × charged`（`budget_spent` 仅累加此项） |
| 供应 / 目录 | 同理分别写 `metered_cost` / `standard_cost` |

换引擎时调整三账本单价即可，价格量纲保持一致。响应**不暴露** Active 引擎名，避免客户端产生引擎耦合；响应体 `cost` 字段仍为本次 **charged** 总额。

### 引擎支持矩阵

多 provider 架构（`AI_DETECTION_CATALOG` + `AI_DETECTION_ACTIVE` + proxy driver 注册表）。当前白名单仅一项：

| Provider | 状态 | 凭证 | 技术分段上限 | 分数 |
|----------|------|------|--------------|------|
| `tencent_tms` | 已实现 | `secretId` + `secretKey`（可选 `region` / `bizType`） | 2000 字 | TMS `Score` 0–100 |

新增引擎时扩展白名单、`requiredCredentials` 与 driver 即可；未实现引擎不可设为 Active。

### 请求

```
POST /v1/tools/ai-detection
Authorization: Bearer <USER_API_KEY>
```

### 请求体

```json
{
  "text": "待检测正文…"
}
```

| 字段 | 说明 |
|------|------|
| `text` | 必填；trim 后非空 |

### 行为

1. 校验用户 API Key；额度不足支付预计费用 → **403** `{ "error": "Budget exceeded" }`
2. 从 Admin `system_config` 读取配置：
   - `AI_DETECTION_ACTIVE`（白名单当前：`tencent_tms`；须为已实现引擎）
   - `AI_DETECTION_CATALOG`（JSON：按引擎存可选凭证字段并集 + `metered` / `standard` / `charged`（或兼容 `cost`）+ 可选 `billingUnitChars`）
   - 默认单价三列均为 **0.01**、默认计费粒度 **2000** 字符，单位随 `BILLING_CURRENCY`
3. 按 Active 引擎切段并并发检测（并发 10）；字符加权得 `overall_score`（0–100）
4. **仅成功**后按计费单元数 × 三账本单价写入日志，并仅用 **charged** 扣费；上游失败写 error 日志、**不扣费**
5. 请求日志不含原文 / excerpt：`requestBody` 仅 `{ total_chars, billing_units }`；`pricing_audit`（v4 `fixed_tool_cost`）含 `unit_prices` / `totals` / `provider` / `billing_units`

运营侧在 Admin → **Tools → Configuration** 配置；调用记录见 **Tools → Invocations**（`model_id=tool:ai-detection`）。

### 响应

```json
{
  "data": {
    "overall_score": 87,
    "total_chars": 5321,
    "segments": [
      { "index": 0, "chars": 2000, "score": 91, "excerpt": "…" }
    ],
    "billing_units": 3,
    "cost": 0.03
  }
}
```

| 字段 | 说明 |
|------|------|
| `overall_score` | 0–100；字符加权 |
| `segments` | 展示分块（含短 excerpt）；日志侧不含 excerpt |
| `billing_units` | 计费单元数 |
| `cost` | 本次扣费；单位随 `BILLING_CURRENCY` |

---

## Tools Pricing（定价只读）

用户 Key 可读各工具单价，供门户费用预估。**不返回** provider 密钥与 Active 引擎名。余额仍从 `GET /v1/me` 获取。

### 请求

```
GET /v1/tools/pricing
Authorization: Bearer <USER_API_KEY>
```

### 响应

```json
{
  "data": {
    "billing_currency": "USD",
    "tools": [
      { "id": "web-search", "unit": "request", "cost": 0.001, "metered": 0.001, "standard": 0.001, "charged": 0.001 },
      { "id": "web-fetch", "unit": "request", "cost": 0.002, "metered": 0.002, "standard": 0.002, "charged": 0.002 },
      { "id": "web-deep-search", "unit": "request", "cost": 0.01, "metered": 0.01, "standard": 0.01, "charged": 0.01 },
      { "id": "ai-detection", "unit": "chars", "unit_chars": 2000, "cost": 0.01, "metered": 0.01, "standard": 0.01, "charged": 0.01 }
    ]
  }
}
```

| 字段 | 说明 |
|------|------|
| `billing_currency` | 与 `system_config.BILLING_CURRENCY` 一致 |
| `tools[].unit` | `request`（按次）或 `chars`（按字符计费单元） |
| `tools[].unit_chars` | 仅 `ai-detection`：计费粒度字符数 |
| `tools[].charged` | Active 引擎用户单价（扣费） |
| `tools[].metered` / `standard` | 供应成本 / 目录标准单价 |
| `tools[].cost` | 兼容别名，等于 `charged`；未配置时回退代码默认值 |

---

## Images（图片生成 / 编辑）

> 模型清单、Provider、参数对照、计费折算与验收清单见权威整理：[文生图模型（Image Models）](../reference/image-models.md)。

OpenAI 兼容 Images API，供桌面 Agent 的 `generate_image` 等工具调用。鉴权与 Chat 相同（用户 API Key）；模型须在目录中配置 **OpenAI 协议**路由及有效的 `image_billing_mode`：`token` 模式需在 `pricing_profile.tiers` 配置 Image token 单价，`per_image` 模式需配置 `pricing_profile.image` 按张单价（见 Admin 模型页与 [文生图模型说明](../reference/image-models.md)）。

### 生成

```
POST /v1/images/generations
Authorization: Bearer <USER_API_KEY>
Content-Type: application/json
```

```json
{
  "model": "gpt-image-2",
  "prompt": "A watercolor book cover of a coastal lighthouse at dusk",
  "n": 1,
  "size": "auto",
  "quality": "auto",
  "background": "auto"
}
```

国内 Seedream（火山方舟）示例（catalog id 与上游同名）：

```json
{
  "model": "doubao-seedream-5-0",
  "prompt": "海边灯塔水彩封面",
  "n": 1,
  "size": "2K",
  "watermark": false
}
```

| 字段 | 说明 |
|------|------|
| `model` | 必填；支持 `id:route_group` 后缀 |
| `prompt` | 必填；最长 4000 字符 |
| `n` | 仅允许 **1**（首期） |
| `size` / `quality` / `background` | 可选；GPT Image 常用 `auto` / `1024x…`；Seedream 常用 `2K` / `4K` |
| `response_format` | 可选；**仅当调用方显式传入时透传**。默认由上游决定（GPT Image 系列通常直接返回 `b64_json`，且不接受该参数） |
| `watermark` / `sequential_image_generation` / `optimize_prompt_options` | 可选；Seedream 等兼容扩展，**显式传入时透传**；也可由路由 `custom_params` 注入默认值 |
| `image` | 可选；Seedream **图生图 / 多图融合**用 JSON 字符串或字符串数组（URL / data URL），走本 generations 端点，**不是** multipart `/edits` |

### 编辑（参考图）

```
POST /v1/images/edits
Authorization: Bearer <USER_API_KEY>
Content-Type: multipart/form-data
```

表单字段：`model`、`prompt`、`n=1`、可选 `size`/`quality`/`background`，以及最多 **5** 个 `image` 文件（`image/png` \| `image/jpeg` \| `image/webp`，单文件 ≤ 20MB）。

**必须**使用 `Content-Type: multipart/form-data`（含 boundary）。若客户端误发 `application/json` 或其它类型，Gateway 在读 body 前即返回 400 `Unsupported Content-Type for /v1/images/edits…`（不会再误报成 `Missing model`）。Seedream 图生图请走 generations + JSON `image`，不要用本端点。

### 计费与审计

Image 模型支持两种 `pricing_profile.image_billing_mode`（再乘路由 `charged_factor` / `metered_factor`）：

| 模式 | 最终费用 | `pricing_audit.kind` |
|------|----------|----------------------|
| **`token`**（GPT Image / Gemini） | usage 分项 × `$/1M`（对齐 [OpenAI Image Cost](https://platform.openai.com/docs/guides/image-generation)） | `image_tokens` |
| **`per_image`**（Seedream / GLM / Grok） | `output_unit × 确认输出张数 + input_unit × 参考图数` | `image_per_image` |

1. **预检额度**：token 模式用 quality×size **估算** tokens；per_image 模式用请求张数 × 单价；均取全候选路由最高 `charged_factor`。预检只决定能不能打上游，**不**等于最终扣费
2. **成功出图**：token 按 **`usage` 真实分项**；per_image 按 **有效返回图片数**（忽略 usage tokens）
3. **客户端取消 / Gateway 超时**（请求已发出，合成 504）：token / per_image **均零费用**。合成 504 **不** failover
4. **明确上游 4xx/5xx、网络合成 502、空结果**：零费用日志
5. Request log **不**保存 prompt 原文、参考图或 Base64；列含 `billing_kind`、`input_image_count`、`output_image_count`；`raw_usage` / `pricing_audit` 供审计
6. 须配置对应模式目录价；无合法 mode/价格则不计费。详见 [image-models.md](../reference/image-models.md)

`pricing_profile` 示例（`gpt-image-2` **token**，USD/1M）：

```json
{
  "image_billing_mode": "token",
  "tiers": [{
    "upto": null,
    "input_price": 5,
    "output_price": 0,
    "cache_read_price": 1.25,
    "image_input_price": 8,
    "image_input_cache_price": 2,
    "image_output_price": 30
  }]
}
```

短 prompt generations 的费用通常由 **image_output** 主导；edits 会额外计入 **image_input**。

`pricing_profile` 示例（Seedream **per_image**，CNY/张）：

```json
{
  "image_billing_mode": "per_image",
  "image": {
    "default": 0.22
  }
}
```

`uncertain_result_policy` 仍可写入 profile，但取消 / 超时不再按它扣费。

Admin 中为图片模型配置 `output_modalities: ["image"]` 及对应 mode 价目即可。

---

## 语音合成（Audio Speech / TTS）

OpenAI 兼容语音合成入口，支持完整音频响应与流式输出。鉴权、预算、路由与日志沿用用户 API Key 链路；请求入口为 `openai` + `audio.speech`。

```text
POST /v1/audio/speech
Authorization: Bearer <USER_API_KEY>
Content-Type: application/json
```

| 字段 | 说明 |
|------|------|
| `model` | 必填；支持 `id:route_group` 后缀 |
| `input` | 必填；合成文本，最多 4096 个字符 |
| `voice` | 必填；字符串或 `{ "id": "..." }` |
| `response_format` | 可选；`mp3`（默认）/ `opus` / `aac` / `flac` / `wav` / `pcm` |
| `speed` | 可选；`0.25`–`4.0`，默认 `1` |
| `stream_format` | 可选；`audio`（默认）或 `sse` |
| `instructions` | 可选；风格指令，最多 4096 个字符 |

同协议 OpenAI 上游使用 `passthrough`；转到 DashScope SpeechSynthesizer、Qwen-TTS 或 MiniMax 时，必须选择对应的显式 adapter。TTS 目录价使用 `audio_billing_mode=per_character`，最终费用只采用上游返回的真实 `usage.characters`；缺失时不会用输入长度补算。

```bash
curl -sS "$GATEWAY_URL/v1/audio/speech" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-tts-model","input":"你好，Octafuse。","voice":"your-voice"}' \
  --output speech.mp3
```

### DashScope 原生实时音频

实时 ASR / TTS 使用 WebSocket 入口：

```text
wss://<gateway>/v1/dashscope/realtime?model=<gateway-model>&operation=<operation>
Authorization: Bearer <USER_API_KEY>
```

请求与上游都使用 `dashscope` 协议及同名 operation，事件和二进制音频帧保持原生语义。可用 operation、浏览器子协议鉴权、计费与部署边界见 [DashScope 音频架构](../architecture/dashscope-audio.md)。

---

## 语音转写（Audio Transcriptions）

OpenAI 兼容 Audio Transcriptions API，供桌面 Agent 语音输入等场景调用。鉴权与 Chat 相同（用户 API Key）；模型须配置 **OpenAI 协议**路由，且 `pricing_profile` 含有效的 Audio 计费配置（见下方双模式）。

```
POST /v1/audio/transcriptions
Authorization: Bearer <USER_API_KEY>
Content-Type: multipart/form-data
```

表单字段：

| 字段 | 说明 |
|------|------|
| `model` | 必填；支持 `id:route_group` 后缀 |
| `file` | 必填；音频文件（如 `webm` / `mp3` / `wav` / `ogg` / `m4a`）；Gateway 硬上限约 **25MB** |
| `language` | 可选；ISO-639-1（如 `zh`、`en`） |
| `response_format` | 可选；`json`（默认）/ `text` / `srt` / `verbose_json` / `vtt` / `diarized_json`（说话人分离模型） |
| `prompt` / `temperature` | 可选；透传上游 |

### 计费与审计（双模式）

由 `pricing_profile.audio_billing_mode` 决定；Admin 保存时禁止与 Image 计费字段混配。请求日志**不**落音频二进制。

| 模式 | `audio_billing_mode` | 扣费权威 | 费用口径 | 日志 |
|------|----------------------|----------|----------|------|
| **按秒** | `"per_second"` | 音频时长 | `billable_seconds × price_per_second × charged_factor`（`minimum_seconds` 可选下限） | `billing_kind=audio_per_second`；列 `audio_duration_seconds`；`pricing_audit.kind=audio_per_second` |
| **按 token** | `"token"` | 上游 `usage`（`type=tokens`） | `(input_tokens × input_price + output_tokens × output_price) / 1M × charged_factor`；单价取 `tiers`（$/1M） | `billing_kind=audio_tokens`；token 数列写入日志；`pricing_audit.kind=audio_tokens`（含 `tokens.input/output/audio/text`） |

**时长**：两种模式都会解析时长（上游 `verbose_json` 的 `duration`，缺失时按文件字节估算），并在 `pricing_audit.duration_source` 标注来源；按秒模式用其计费，token 模式主要用于预检与审计。

Admin 静态预设（`packages/admin/lib/model-presets/openai-audio.json`，与 [Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text) 当前别名一致）：

| model id | 计费模式 | 上游官方价（参考） | Gateway 目录价（USD） |
|----------|----------|-------------------|----------------------|
| `whisper-1` | `per_second` | **$0.006 / minute** | `audio.price_per_second = 0.0001`（即 $0.006/min） |
| `gpt-4o-mini-transcribe` | `token` | **$1.25 / $5** per 1M audio tokens（in/out） | `tiers`: `input_price=1.25`, `output_price=5` |
| `gpt-4o-transcribe` | `token` | **$2.50 / $10** per 1M | `tiers`: `2.5` / `10` |
| `gpt-4o-transcribe-diarize` | `token` | 同 `gpt-4o-transcribe` | 同左；支持 `diarized_json` |

不收录日期快照（如 `gpt-4o-mini-transcribe-2025-12-15`）与 Realtime-only 模型（如 `gpt-realtime-whisper`）。

`pricing_profile` 示例——按秒（`whisper-1`）：

```json
{
  "audio_billing_mode": "per_second",
  "audio": {
    "price_per_second": 0.0001,
    "minimum_seconds": 1
  }
}
```

`pricing_profile` 示例——按 token（`gpt-4o-mini-transcribe`）：

```json
{
  "audio_billing_mode": "token",
  "tiers": [
    {
      "upto": null,
      "input_price": 1.25,
      "output_price": 5
    }
  ]
}
```

示例：

```bash
curl -sS "$GATEWAY_URL/v1/audio/transcriptions" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -F model=whisper-1 \
  -F file=@recording.webm \
  -F language=zh \
  -F response_format=json
```

默认 `GET /v1/models` **不含** ASR 模型；列表可用 `kind=audio` / `kind=all`。Admin 侧 Kind 判定依据为有效的 `audio_billing_mode`（`per_second` + `audio` 块，或 `token` + `tiers`），见 [admin.md「pricing_profile」](./admin.md#pricing_profile--price_override-契约adminmodelsadminroutes)。
---

## 获取当前用户预算状态

获取当前认证用户的预算使用情况。

### 请求

```
GET /v1/me
```

### 响应

```json
{
  "budget_max": 100.00,
  "budget_spent": 15.50,
  "budget_period": "monthly",
  "budget_reset_at": "2024-02-01T00:00:00.000Z",
  "billing_currency": "USD",
  "metadata": {
    "plan": "pro",
    "source": "account-service"
  }
}
```

### 字段说明

| 字段 | 类型 | 描述 |
|------|------|------|
| `budget_max` | number \| null | 预算上限；`null` 表示无限制 |
| `budget_spent` | number | 当前周期已消费金额 |
| `budget_period` | string | 预算周期: `"none"` \| `"daily"` \| `"weekly"` \| `"monthly"` |
| `budget_reset_at` | string \| null | 下次预算重置时间 (ISO 8601) |
| `billing_currency` | string | 计费币种：来自 `system_config.BILLING_CURRENCY` 的 **ISO 4217** 三字码（如 `USD`、`CNY`）；与 `pricing_profile` 单价及本接口预算数值同币；未配置或非法时回退 `USD` |
| `metadata` | object \| null | 优先返回 User metadata，并以 Key metadata 回退或补全（由管理端写入） |

### 示例

```bash
curl http://localhost:8787/v1/me \
  -H "Authorization: Bearer sk-xxx..."
```

> 即使预算已超限，此端点仍然可以访问。客户端可使用此端点显示用户的预算状态。

---

## 注意事项

### 预算控制

如果用户 Key 设置了预算限制（`budget_max`），当累计消费达到或超过预算时，请求将被拒绝并返回 **403** `Budget exceeded`。周期性套餐使用 `budget_period` 为 `daily` / `weekly` / `monthly` 等并由 `budget_reset_at` 驱动重置；**一次性额度**使用 `budget_period = 'none'`，不会在网关内按日历自动“补发”，由上游门户/管理 API 更新 `budget_max` / `budget_base`。

### 定价模型

币种由 **`system_config.BILLING_CURRENCY`** 声明（管理后台 **Gateway Config** 或迁移种子默认 `USD`）。`pricing_profile` 中的单价与 `users` 的预算字段均按该币种计量。

LLM 及 token 模式的价格以每百万 token 为单位（per-million-token pricing）：

```
费用 = (常规输入 * input_price
     + 缓存读取 * cache_read_price
     + 缓存写入 * cache_write_price
     + 输出 * output_price) / 1,000,000
```

- `cache_read_price` 和 `cache_write_price` 默认等于 `input_price`
- Images 还支持 `per_image` 按张计价，Audio 支持 `per_second` 按时长或 `token` 计价，Agent Tools 使用固定按次单价；分别见上文对应章节。
- 路由 **`price_override`** 以 **`charged_factor` / `metered_factor`**（及可选每日 **`schedule`**）相对目录价计费；嵌套 `metered`/`charged` tiers 忽略。
- 路由级 **`route_group`** 会写入 `api_key_request_logs` 快照。
  - **`standard_cost`（目录标准价）**：按当前计费模式从 `models.pricing_profile` 计算，不乘路由倍率
  - **`metered_cost`（供应成本）** / **`charged_cost`（用户扣费）**：目录价 × 有效倍率（无 `schedule.mode` 时叠乘；`override` 时窗内用窗口 factor）。详见 `docs/developers/reference/streaming-billing.md`
- `users.budget_spent` 仅按 `charged_cost` 累加

### 使用量追踪

每次请求会记录到 `api_key_request_logs`，主要包括：

- Token 使用量（输入/输出/缓存读取/缓存写入/推理等）
- `metered_cost` / `standard_cost` / `charged_cost`（目录选档 × 路由倍率；见上）
- `route_group`（请求时选用的路由快照）
- `request_protocol` / `request_operation` 与 `upstream_protocol` / `upstream_operation`
- `model_surface_id`、`route_pool_id`、`route_target_id`、`adapter`、`route_trace`
- 延迟、状态（success/error/incomplete/cancelled 等）
- 原始 usage（`raw_usage`）

### 提供商故障转移

同一 Request Surface 指向一个 Route Pool，Pool 内支持多条 **model_routes** Target（每条指向一个 Provider；**一个 Provider = 一把 `api_key`**）。调度由 `failoverDispatch` + `buildRouteAttemptPlan` 完成；拓扑见 [route-topology.md](../architecture/route-topology.md)，完整分支与场景表见 [proxy-request-lifecycle.md](../architecture/proxy-request-lifecycle.md)。

**排序与 failover**：

- **层**：按 `model_routes.priority` **降序**（数字越大越先试）。
- **同层**：按生效策略排序（默认 **`hash_affinity`**：加权 Rendezvous，利于 prompt cache；另有 `weighted_random` / `weight_priority` / `weighted_round_robin`），权重为 `model_routes.weight`。
- **跳过**：`providers.status = disabled`、无 `api_key`，或处于 **provider 熔断** 的候选不参与本次 attempt。
- **全部不可用**（均熔断）：网关直接返回 **429**，响应体为 `{ "error": { "code": "upstream_capacity_exhausted", ... } }`，并带 `Retry-After`；**不调用上游**。
- **有可试路由时**：按序打上游；可重试失败则换下一 Provider；全部 attempt 失败则返回**最后一次**上游响应。

**可重试并换 Provider**：上游 `429`、`5xx`、`401`、`403`、网络/`fetch` 失败（524 / fetch 仅同次 failover，不跨请求熔断）。熔断按 **`providers.id`**：429 优先读 `Retry-After` 或递增退避；401/403 约 **5min**；普通 5xx 连续 3 次后约 10s。

**User+model 熔断**（与 provider 熔断独立，按 `userId + modelId`，退避 **20s → 1min → 3min → 5min → 10min**；见 [proxy-request-lifecycle.md](../architecture/proxy-request-lifecycle.md) §2.2）：

- **敏感内容**（上游错误文案命中内容安全关键词）：chat / messages / gemini / images / audio **均**触发；短路 **429** `circuit.sensitive_content`。
- **普通上游 400**：chat / messages / gemini 触发；短路 **400** `circuit.client_error`（回放原文）。**`/v1/images/*`、`/v1/audio/transcriptions` 不记、不短路**普通 400，便于客户端修正尺寸/格式等后立即重试。

**不重试**（立即返回）：`400`、`404` 等请求本身错误；Images 客户端取消 / Gateway 超时合成的 504。

**策略配置**（运维侧，对客户端透明）：Route Pool 可用 `route_pools.strategy` 精确覆盖；其后依次解析 `models.route_policy` 与全局 `system_config.ROUTE_STRATEGY`。解析顺序见 [route-strategies.md](../reference/route-strategies.md)。

用量日志会写入最终选用（或最后失败）的 Surface / Pool / Target，以及 **`provider_key_id`**（= provider id）、**`provider_key_label`**（= provider name）、**`provider_key_fingerprint`**（密钥指纹，不含明文）。

### Route 默认参数合并

<a id="route-默认参数合并"></a>

`model_routes` 支持 route 级默认参数字段 **`custom_params`**（JSON 对象字符串）：可包含协议常规字段（如 `temperature`）与厂商/渠道专有字段（如 `provider_options`、`eca_thinking_config`）。

网关在转发到上游前会进行两层合并（优先级从低到高）：

1. `custom_params`
2. 用户请求体

合并规则：

- 对象：递归深度合并
- 数组：用户传入数组时整体替换默认数组
- 标量：用户值优先
- `model` 始终由 route 的 `provider_model_name` 强制覆盖

示例（`model_routes.custom_params` 列中存放的 JSON 对象；OpenAI 风格）：

```json
{
  "temperature": 0.7,
  "response_format": { "type": "json_object" },
  "provider_options": { "foo": "bar" }
}
```

如果用户请求：

```json
{
  "model": "gpt-4.1",
  "messages": [{ "role": "user", "content": "hi" }],
  "temperature": 0.2
}
```

则最终上游请求中的 `temperature` 为 `0.2`（用户覆盖默认），`provider_options` 会保留。

各厂商 `thinking` / `reasoning` / `reasoning_effort` 等字段的 JSON 形态见 **[渠道模型思考参数配置说明](../reference/provider-thinking-configs.md)**。在 Route 的 `custom_params` 中写入默认值后，客户端未传该字段时会合并进上游请求；客户端显式传入时以客户端为准。
