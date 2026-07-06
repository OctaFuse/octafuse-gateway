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

`selectActiveRouteRows` 使用的 **有效路由组** 为：

- 客户端传入 **`baseId:group`** 且 `group` 非空 → 有效组 = 该 `group`（trim，比较时 **忽略大小写**）。
- 仅传入 **`baseId`**（整串命中 `models.id`）→ 有效组 = **`default`**。

仅保留 **`model_routes.status = active`** 且 **`route_group`**（库内空值在比较时视为 `default`）与有效组（忽略大小写）一致的行，再按 **priority** 做 failover；再按入口协议过滤（如 chat 仅 OpenAI）。该有效组下 **无** 活跃路由 → **400**；有路由但当前协议无可用上游 → **502**（例如 `No OpenAI route in route group "free" for this model`，Anthropic / Gemini 同理）。

模型 **`tags` 不参与**选组或计费。需要限定某一组时，请使用 **`baseId:your_group`**。

**免费 / 零扣费**：`charged_cost` 由所选路由的 **`price_override.charged`**（及 Admin 里从目录生成的阶梯）决定；**`charged_cost` 不使用** `price_override` 里的 **`charged_factor`** 参与公式（`charged_factor` 仅作相对目录价的倍率备忘/展示）。若要用户侧不扣费，请把 **charged 侧单价设为 0**（例如在路由编辑器里将 **Charged factor** 设为 `0` 以生成全 0 阶梯，或直接编辑 tiers 为 0）。

### 3. 预算校验

`POST /v1/chat/completions`、`POST /v1/messages` 与 Gemini `POST /v1beta/models/...` 在转发上游前，对 **用户 API Key** 统一执行 **`budget_max` / `budget_spent`** 校验：当 `budget_max` 非空且 `budget_spent >= budget_max` 时返回 **403** `Budget exceeded`。

路由组（`default`、`free` 等）仅影响 **选路与计费快照**（见下文用量日志），**不再**单独绕过预算或走按日免费次数表。一次性试用额度等场景请通过 **`budget_period = 'none'`** 与 `budget_max` / `budget_base` 在密钥上表达（由管理 API / 门户侧写入）。

### 4. 用量日志 `api_key_request_logs`

写入的 **`model_id` 为库内基础模型 ID**（不带 `:group` 后缀）；实际选用的 **`route_group`**、**`upstream_protocol`**（所选路由的上游协议快照）、**`provider_key_id` / `provider_key_label` / `provider_key_fingerprint`**（最终上游 key 快照，指纹为脱敏尾号）等会随请求落库（见 D1 表 **`api_key_request_logs`**，基线定义在 `packages/core/migrations-d1/0001_baseline.sql`，key 快照列见 `0004_provider_api_keys.sql`），便于对账与展示（如 Account 用量详情中 free 通道可加 `:free` 说明）。相对目录标准价的倍率请见路由 **`price_override`** 中的 **`charged_factor`** / **`metered_factor`**（及兼容字段 **`provider_factor`**）。**`request_protocol`** 表示客户端调用的 Gateway 入口（`openai` / `anthropic` / `gemini`），与 **`upstream_protocol`** 语义不同。

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
| 有效路由组下无活跃路由（含未写后缀时的 **`default`**） | 400 | `No active routes for route group "default" for this model` |
| 预算超限 | 403 | `Budget exceeded` |
| 模型不存在 | 404 | `Model not found` |
| 路由解析失败等 | 502 | 具体错误信息 |
| 无 OpenAI 协议路由（有效组内无可用上游） | 502 | `No OpenAI route in route group "default" for this model`（组名随有效组变化） |

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

### 上游 `base_url_gemini` 与多入口（Developer / Vertex Express）

Admin 中 Provider 的 **`base_url_gemini`** 须配置到 **`{model}` 之前**的完整路径前缀（网关不再自动补 `/v1beta/models`）；**客户端入口**始终为 `POST /v1beta/models/...`（与 `@google/genai` SDK 兼容）。

| 接入风格 | 示例 `base_url_gemini` | 网关出站 URL 形态 |
|----------|------------------------|-------------------|
| Developer API | `https://generativelanguage.googleapis.com/v1beta/models` | `{base}/{upstreamModel}:{action}?key=` |
| Vertex AI Express（API Key） | `https://aiplatform.googleapis.com/v1/publishers/google/models` | `{base}/{upstreamModel}:{action}?key=` |
| 自定义反代 / 其他前缀 | 按上游文档写到 `{model}` 前 | `{base}/{upstreamModel}:{action}?key=` |

- **`upstreamModel`** 来自路由的 `provider_model_name`（裸模型名，如 `gemini-2.5-flash`），与客户端路径中的 `modelSegment`（可含 `:route_group`）独立。
- 仅配置裸 host（如 `https://generativelanguage.googleapis.com`）会在出站时报错；存量数据请执行迁移 SQL（见下）。
- Vertex Express 与 Developer API 的请求体、响应体、SSE、`usageMetadata` 一致；出站均使用 provider key 池的 `?key=`（或客户端透传的 query）。

**存量 Provider 迁移（Developer API 裸 host → 全前缀）：**

```sql
UPDATE providers
SET base_url_gemini = RTRIM(base_url_gemini, '/') || '/v1beta/models'
WHERE base_url_gemini IS NOT NULL
  AND TRIM(base_url_gemini) <> ''
  AND base_url_gemini NOT LIKE '%/v1beta/models'
  AND base_url_gemini NOT LIKE '%/publishers/google/models%';
```

---

## 获取模型列表

OpenAI 兼容的模型列表接口。返回网关中 **至少有一条活跃路由** 的模型（全量可见，不按 API Key 区分）。

### 请求

```
GET /v1/models
```

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
curl http://localhost:8787/v1/models \
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
| 认证 | 用户 API Key | **无** | MASTER_KEY |
| 默认 `route_groups` | `default,free` | 未传 → **全部** active group | — |
| 协议能力 | 不返回 | `protocols` / `protocols_by_group` | 不返回 |
| 主要用途 | Agent 兼容列表 | 门户 / 公开 discovery | 运维 CRUD |

Admin 静态导入目录见 **`GET /admin/models/import/catalog`**（与上表无关，见 [管理接口](./admin.md#admin-vs-proxy-catalog)）。

### 示例

```bash
curl http://localhost:8787/catalog/models
curl "http://localhost:8787/catalog/models?route_groups=default,web"
```

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
| `metadata` | object \| null | Key 元数据（由管理端写入） |

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

币种由 **`system_config.BILLING_CURRENCY`** 声明（管理后台 **Gateway Config** 或迁移种子默认 `USD`）。`pricing_profile` 中的单价与 `api_keys` 的预算字段均按该币种计量。

所有价格以每百万 token 为单位（per-million-token pricing）：

```
费用 = (常规输入 * input_price
     + 缓存读取 * cache_read_price
     + 缓存写入 * cache_write_price
     + 输出 * output_price) / 1,000,000
```

- `cache_read_price` 和 `cache_write_price` 默认等于 `input_price`
- 部分路由可在 `price_override` 中使用 **`metered`**（供应侧单价）与 **`charged`**（用户预算单价）阶梯覆盖；未写某键时该侧回退到该模型 `models.pricing_profile`（**`standard_cost`** 始终仅按目录 profile）。
- 路由级 **`route_group`** 会写入 `api_key_request_logs` 快照；相对目录标准价的倍率保存在路由 **`price_override`** 的 **`charged_factor`** / **`metered_factor`**（不再使用独立 `billing_factor` 列）。
  - **`metered_cost`**：优先 `price_override.metered`，否则模型目录 profile
  - **`standard_cost`**：按 `models` 标准价格计算（不受 `price_override` 影响）
  - **`charged_cost`**：优先 `price_override.charged`，否则模型目录 profile（详见 `docs/reference/streaming-billing.md`）
- `api_keys.budget_spent` 仅按 `charged_cost` 累加

### 使用量追踪

每次请求会记录到 `api_key_request_logs`，主要包括：

- Token 使用量（输入/输出/缓存读取/缓存写入/推理等）
- `metered_cost` / `standard_cost` / `charged_cost`（金额由 tiers/profile 决定；`charged_factor` / `metered_factor` 不参与乘法）
- `route_group`（请求时选用的路由快照）
- `request_protocol`（入口协议）与 `upstream_protocol`（路由级上游协议快照）
- 延迟、状态（success/error/incomplete/cancelled 等）
- 原始 usage（`raw_usage`）

### 提供商故障转移

同一 `route_group` 内支持多路由与 **key pool**（`provider_api_keys` 表）故障转移。调度由 `failoverDispatchWithKeyPool` + `buildKeyAttemptPlan` 完成；**完整分支与场景表**见 [proxy-request-lifecycle.md](../architecture/proxy-request-lifecycle.md)。

**排序与 failover**：

- **Route 层**：按 `model_routes.priority` 从高到低分层；**同 priority 层的多个 provider 的 key 合并为一个池**（同层内交叉尝试，而非严格逐 provider 串行）。
- **Key 层**：池内按 `provider_api_keys.priority` 降序分批；批内按 **限流余量（headroom）** 降序，余量接近（<10%）时按 **weight** 加权随机打散。
- **跳过**：处于 **key 熔断** 或 **网关侧限流**（`limit_config` 的 RPM/TPM/并发）的 key 不参与本次 attempt 序列。
- **全部 key 不可用**（均熔断或限流）：网关直接返回 **429**，`code: upstream_capacity_exhausted`，带 `Retry-After`；**不调用上游**。
- **有可试 key 时**：按序打上游；某 key 失败且可重试则换下一 key（可跨 provider）；全部 attempt 失败则返回**最后一次**上游响应。

**可重试并换 key**：上游 `429`、`5xx`、`401`、`403`、网络/`fetch` 失败。失败 key 进入分类熔断（429 优先读 `Retry-After` 或递增退避；401/403 约 10min；5xx/网络约 60s）。

**不重试**（立即返回，不换 key）：`400`、`404` 等请求本身错误。

**粘性 key（opt-in）**：在 `models.sticky_config` 为对应「协议 × route_group」开启后，同一用户尽量连续命中同一把 provider key（保上游 prompt cache）。绑定 key 可用时置顶；仅因网关限流且预计恢复 ≤ `short_wait_ms`（默认 3s）时网关内短等待；空闲绑定 TTL 默认 **600s**（`ttl_seconds`，成功后刷新）；上游真实 429/5xx/auth 则立即 failover 到其他 key，成功后改绑。

**网关侧限流**：`provider_api_keys.limit_config` 可选配置 RPM/TPM/并发（进程内存软限制）；建议设为供应商真实限额约 90%。

用量日志 `api_key_request_logs` 会写入最终选用（或最后失败）key 的 **`provider_key_id`**、**`provider_key_label`**、**`provider_key_fingerprint`**（脱敏尾号，不含明文）。

上游密钥统一存放在 **`provider_api_keys`** 表；迁移 **`0004`** 会从历史 `providers.api_key` 回填 `label = default` 的 pool 行，**`0005`** 在新代码部署后删除 legacy 列。

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
