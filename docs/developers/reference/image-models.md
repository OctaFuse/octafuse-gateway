# 文生图模型（Image Models）

本文整理 Gateway 当前支持的 **OpenAI Images** 文生图模型：预设 catalog、Provider 配置、参数差异、计费与预检、运营验收。

API 字段细节见 [用户接口 · Images](../api/user.md#images图片生成--编辑)；逐步验收清单见 [Admin API · 运维验收](../api/admin.md#运维验收文生图模型-gpt-image-2)。

## 架构要点

| 项 | 说明 |
|----|------|
| 入口 | **`POST /v1/images/generations`**；OpenAI 另有 **`POST /v1/images/edits`**（multipart） |
| 不走 Chat | 文生图 **不** 走 `/v1/chat/completions` |
| 驱动 | `packages/proxy` OpenAI Images driver；failover 复用 `failoverDispatchWithKeyPool` |
| 路由协议 | `model_routes.upstream_protocol` **锁定 `openai`**（anthropic/gemini 保存应 400） |
| Kind 判定 | `output_modalities` 含 **`image`**（勿用 input 含 image——多模态 LLM 也会有） |
| Catalog 列表 | 默认 `/v1/models` **不含** 纯 image 模型；需 `kind=image` / `kind=all`，或直接打 Images API |
| 计费权威 | 上游响应 **`usage` 分项** × tier `image_*` / text 单价；**无按张固定价**（按张套餐留给业务层） |

## 目录中的 Image 预设

静态预设按 **`<vendor>-image.json`** 单独维护（LLM 仍在 `<vendor>.json`）：

- OpenAI：`packages/admin/lib/model-presets/openai-image.json`
- 字节 / 豆包：`packages/admin/lib/model-presets/bytedance-image.json`
- 智谱：`packages/admin/lib/model-presets/zhipu-image.json`
- xAI：`packages/admin/lib/model-presets/xai-image.json`
- Google：`packages/admin/lib/model-presets/google-image.json`

Admin → Models → Import 勾选导入；**同 id 已存在不会覆盖**——改价需删后 re-import 或 PATCH。

| Catalog id | 展示名 | Vendor | 典型区域 | 图生图 / 编辑 | 说明 |
|------------|--------|--------|----------|---------------|------|
| `gpt-image-2` | GPT Image 2 | openai | 海外 | **`/v1/images/edits`**（multipart，最多 5 张） | OpenAI 官方 token 分项价 |
| `doubao-seedream-5-0-260128` | Doubao Seedream 5.0 | bytedance | 国内（火山方舟） | generations + JSON **`image`** | 官方按张；Gateway 用 `output_tokens≈16384` 折算 |
| `doubao-seedream-5-0-pro` | Doubao Seedream 5.0 Pro | bytedance | 国内（火山方舟） | 同上 | 同上；官方约价更高 |
| `glm-image` | GLM Image | zhipu | 国内 / Z.AI 国际 | generations（按上游） | 官方约 ¥0.1/张 → 同上折算 |
| `grok-imagine-image-quality` | Grok Imagine Image Quality | xai | 海外 | generations（及上游 edits） | 官方约 $0.05/张 → 同上折算 |
| `gemini-3.1-flash-image` | Gemini 3.1 Flash Image | google | 海外 | generations（OpenAI 兼容层） | Nano Banana 2；官方 $/1M token |
| `gemini-3-pro-image-preview` | Gemini 3 Pro Image Preview | google | 海外 | 同上 | Nano Banana Pro；官方 $/1M token |

约定：

- Catalog id **=** 上游 `provider_model_name`（与 `gpt-image-2` 一致）；若控制台用推理接入点，Route 可填 `ep-…`。
- 模型预设 **不** 写 `suggested_provider_model_name` / `suggested_custom_params`；默认参数由客户端或 Route `custom_params` 注入。
- 旧 id（如 `doubao-seedream-4-5-*`、`cogview-*`、`gemini-2.5-flash-image`、`grok-imagine-image-pro`）不进静态预设；库里若仍有旧行需手工清理。
- 新增厂商：补 `<vendor>-image.json` + Provider 模板（须有 OpenAI Images `images.generations`）+ 本文表格。阿里云百炼万相 / Qwen-Image 等非 OpenAI Images 路径暂不收录。

## Provider 配置

### OpenAI（`gpt-image-2`）

- Import / 手建 Provider：`endpoints.openai.base` = `https://api.openai.com/v1`（或显式写 `images.generations` / `images.edits` 完整 URL）。
- `base` 会派生标准路径：`…/images/generations`、`…/images/edits`。
- Key 写入 `provider_api_keys`。

### 火山方舟 Volcengine Ark（Seedream）

Import 模板名：**Volcengine Ark**（`packages/admin/lib/provider-import-presets.json`）。

| 必须 | 禁止 |
|------|------|
| `endpoints.chat` + **`endpoints.images.generations`** 完整 URL | **不要** 设 `openai.base` |

原因：Seedream **没有** OpenAI 形态的 `/images/edits`；若配置 `base`，Gateway 会派生死链 edits URL。图生图走 generations + JSON `image`。

```text
chat:                 https://ark.cn-beijing.volces.com/api/v3/chat/completions
images.generations:   https://ark.cn-beijing.volces.com/api/v3/images/generations
```

Coding Plan / Agent Plan 模板路径不同，**勿与标准 `/api/v3` 混用**（额度不生效）。

### 智谱 / Z.AI（`glm-image`）

- 国内模板 **Zhipu GLM**：`endpoints.openai.base` = `https://open.bigmodel.cn/api/paas/v4`
- 国际模板 **Z.AI GLM (International)**：`https://api.z.ai/api/paas/v4`
- Coding Plan 模板为 chat-only，**不要**用来跑 Images。

### xAI（`grok-imagine-image-quality`）

- 模板 **xAI (Grok)**：`endpoints.openai.base` = `https://api.x.ai/v1`（派生 `images/generations`）。

### Google Gemini（Nano Banana）

- 模板 **Google Gemini (Generative Language API)**：`endpoints.openai.base` = `https://generativelanguage.googleapis.com/v1beta/openai`
- 官方 OpenAI 兼容层文档常见示例含 `gemini-3-pro-image-preview`；`gemini-3.1-flash-image` 为当前稳定型号，若兼容层拒识再按 Google 文档改 Route `provider_model_name`。
- 建议请求显式 `response_format=b64_json`（与 Google 兼容文档一致）。

## 参数对照

| 维度 | `gpt-image-2` | Seedream 5（`doubao-seedream-5-0-*`） |
|------|---------------|--------------------------------------|
| 文生图 | `POST /v1/images/generations` | 同左 |
| 参考图 / 编辑 | **`POST /v1/images/edits`** multipart `image` 文件 | **无 edits**；`generations` + JSON `image`（URL / data URL / 数组） |
| `size` | `auto` / `1024x1024` / `1024x1536` / `1536x1024` 等 | `2K` / `3K` / `4K` 或 `WxH` 像素 |
| `quality` | `auto` / `low` / `medium` / `high` | 通常不用 |
| `background` | 支持（如 `auto`） | 无 |
| `watermark` | — | 可选 boolean，**显式传入才透传** |
| `sequential_image_generation` (+ `*_options`) | — | 可选，显式透传 |
| `optimize_prompt_options` | — | 可选，显式透传 |
| `response_format` | GPT Image 系列常直接 `b64_json` 且可能拒收该字段；**仅显式传入时透传** | 按上游 |
| `n` | Gateway 首期仅 **1** | 同左 |
| `prompt` | 必填，最长 4000 | 同左 |

透传实现：`packages/proxy/src/services/image-generation-extras.ts`（`applyOpenAiImageGenerationExtras`）。Route `custom_params` 与用户体合并规则见 [Route 默认参数合并](../api/user.md#route-默认参数合并)。

### 调用示例

海外 GPT Image：

```bash
curl -sS "$GATEWAY_URL/v1/images/generations" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"a red apple","size":"1024x1024","quality":"low","n":1}'
```

国内 Seedream：

```bash
curl -sS "$GATEWAY_URL/v1/images/generations" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"doubao-seedream-5-0-260128","prompt":"海边灯塔水彩封面","size":"2K","n":1,"watermark":false}'
```

Seedream 图生图（勿打 `/edits`）：

```json
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "把背景换成黄昏海边",
  "size": "2K",
  "image": "https://example.com/ref.png"
}
```

## 计费

对齐 OpenAI Image 分项（再乘路由 `charged_factor` / `metered_factor`）：

```text
charged ≈
  text_input × input_price
+ cached_text × cache_read_price
+ image_input × image_input_price
+ cached_image_input × image_input_cache_price
+ image_output × image_output_price
（单价均为「每百万 token」；再 × charged_factor）
```

| 规则 | 行为 |
|------|------|
| 成功出图 | 按响应 `usage` 真实分项扣费；`pricing_audit.kind=image_tokens` |
| 客户端取消（已发出） | 按预检 token 扣费；`usage_source=client_abort_precheck` |
| 超时 / 上游错误 / 空结果 | 零费用日志，不计费 |
| 无 `image_*`（及所需 text）单价 | **不计费** |
| Legacy 按张 `pricing_profile.image` | 可读入兜底 Kind，**不参与扣费**；Admin 保存会清除 |

### 预设单价（摘要）

**`gpt-image-2`**（USD / 1M；CNY ≈ ×7.25）：

| 分项 | USD | CNY |
|------|-----|-----|
| text `input_price` | 5 | 36.25 |
| cached text `cache_read_price` | 1.25 | 9.0625 |
| `image_input_price` | 8 | 58 |
| `image_input_cache_price` | 2 | 14.5 |
| `image_output_price` | 30 | 217.5 |

短 prompt generations 费用通常由 **image_output** 主导；edits 另计 **image_input**。

**按张折算类**（官方按张；上游常只回 `usage.output_tokens≈16384`；仅配置 **`image_output_price`**，`image_input_*` 为 null）：

| Catalog id | 官方约价 | 典型 tokens | `image_output_price` CNY/1M | USD/1M |
|------------|----------|-------------|-----------------------------|--------|
| `doubao-seedream-5-0-260128` | ¥0.22 / 张 | 16384 | **13.43** | **2.14** |
| `doubao-seedream-5-0-pro` | ¥0.36 / 张（≤2.36MP） | 16384 | **21.97** | **3.05** |
| `glm-image` | ¥0.1 / 张 | 16384 | **6.1** | **0.84** |
| `grok-imagine-image-quality` | $0.05 / 张 | 16384 | **22.13** | **3.05** |

折算：

```text
image_output_price = 官方单价/张 ÷ (典型_output_tokens / 1_000_000)
```

实测 `output_tokens` 偏离 16384 时，按上式重算并 PATCH。常量：`SEEDREAM_TYPICAL_OUTPUT_TOKENS`（`packages/core/src/db/image-token-usage.ts`）。上游若无 `usage`，则**不计费**（与全局规则一致）。

**Google Nano Banana**（官方 $/1M tokens；CNY ≈ ×7.25）：

| Catalog id | text/image `input_price` USD | `image_output_price` USD | input CNY | img-out CNY |
|------------|------------------------------|--------------------------|-----------|-------------|
| `gemini-3.1-flash-image` | 0.5 | **60** | 3.625 | **435** |
| `gemini-3-pro-image-preview` | 2 | **120** | 14.5 | **870** |

## 预检与估算

预检用 quality×size **估算** image output tokens（偏保守）× 目录单价 × 候选路由最高 `charged_factor`，用于预算闸门；**最终扣费仍以成功响应 usage 为准**。

| 场景 | 估算行为 |
|------|----------|
| GPT Image 已知 quality×size | 查 GPT 估算表 |
| Seedream `2K`/`3K`/`4K` | 典型 16384；`4K` 按 2× |
| 显式大像素（边 ≥2048） | ≥8MP 按 2× 典型，否则 1× |
| 完全未知 | 取 GPT 上界与 Seedream 典型的较大者，避免国内模型低估 |

Admin Routes / Models 上的估算矩阵仅供展示，**不是**扣费权威。

## Route 配置清单

1. `model_id` = 上表 catalog id  
2. `upstream_protocol` = `openai`  
3. `provider_model_name` = 与 catalog 同名（或火山 `ep-…`）  
4. Provider 指向正确 Key + Images generations（及 OpenAI 时的 edits）  
5. 可选 `custom_params`：如默认 `watermark: false`（用户显式传覆盖）  
6. `charged_factor` / `metered_factor` 按业务加价  

## 运营验收（最短路径）

Admin 闭环：**Routes → Playground → Simulator → Request Logs**（无独立 Images 管理页）。

1. Import Provider + Image 模型预设  
2. 建 openai 路由；Billing 显示 token 单价（Seedream 主要为 img-out）  
3. Playground 出图（不计费）  
4. Simulator / curl 打 Proxy，核对：
   - `pricing_audit.kind=image_tokens`
   - GPT：`charged_cost` 随 usage 分项变化  
   - Seedream：`tokens.image_output≈16384`，`charged_cost≈官方单价×charged_factor`  
5. Seedream 勿用 multipart `/edits` 做图生图  

逐步细节：[gpt-image-2 验收](../api/admin.md#运维验收文生图模型-gpt-image-2) · [Seedream 验收](../api/admin.md#运维验收国内文生图-seedream-火山方舟)。

## 相关代码与文档

| 主题 | 路径 |
|------|------|
| Images 用户 API | [api/user.md · Images](../api/user.md#images图片生成--编辑) |
| 运维验收 / 模型价目说明 | [api/admin.md](../api/admin.md) |
| Provider Import 预设说明 | [provider-import-presets.md](./provider-import-presets.md) |
| 流式计费与取消（Chat；Image 取消预检语义并列） | [streaming-billing.md](./streaming-billing.md) |
| Image extras 透传 | `packages/proxy/src/services/image-generation-extras.ts` |
| Token 预检 / Seedream 常量 | `packages/core/src/db/image-token-usage.ts` |
| OpenAI Images 驱动 | `packages/proxy/src/services/egress/openai-images-driver.ts` |
