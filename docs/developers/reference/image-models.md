# 文生图模型（Image Models）

本文整理 Gateway 当前支持的 **OpenAI Images** 文生图模型：预设 catalog、Provider 配置、参数差异、计费与预检、运营验收。

API 字段细节见 [用户接口 · Images](../api/user.md#images图片生成--编辑)；逐步验收清单见 [Admin API · 运维验收](../api/admin.md#运维验收文生图模型-gpt-image-2)。

## 架构要点

| 项 | 说明 |
|----|------|
| 入口 | **`POST /v1/images/generations`**；OpenAI 另有 **`POST /v1/images/edits`**（multipart） |
| 不走 Chat | 文生图 **不** 走 `/v1/chat/completions` |
| 驱动 | `packages/proxy` OpenAI Images driver；failover 复用 `failoverDispatch` |
| 路由协议 | `model_routes.upstream_protocol` **锁定 `openai`**（anthropic/gemini 保存应 400） |
| Kind 判定 | `output_modalities` 含 **`image`**（勿用 input 含 image——多模态 LLM 也会有） |
| Catalog 列表 | 默认 `/v1/models` **不含** 纯 image 模型；需 `kind=image` / `kind=all`，或直接打 Images API |
| 计费权威 | **双模式**：`pricing_profile.image_billing_mode` = `token`（usage 分项 × `image_*`）或 `per_image`（确认输出张数 × `image.default`，可选参考图 `image.input`） |

## 目录中的 Image 预设

静态预设按 **`<vendor>-image.json`** 单独维护（LLM 仍在 `<vendor>.json`）：

- OpenAI：`packages/admin/lib/model-presets/openai-image.json`
- 字节 / 豆包：`packages/admin/lib/model-presets/bytedance-image.json`
- 智谱：`packages/admin/lib/model-presets/zhipu-image.json`
- xAI：`packages/admin/lib/model-presets/xai-image.json`
- Google：`packages/admin/lib/model-presets/google-image.json`
- 阿里云百炼：`packages/admin/lib/model-presets/aliyun-image.json`

Admin → Models → Import 勾选导入；**同 id 已存在不会覆盖**——改价需删后 re-import 或 PATCH。

| Catalog id | 展示名 | Vendor | 典型区域 | 图生图 / 编辑 | 计费模式 |
|------------|--------|--------|----------|---------------|----------|
| `gpt-image-2` | GPT Image 2 | openai | 海外 | **`/v1/images/edits`**（multipart，最多 5 张） | **`token`**（官方 $/1M） |
| `doubao-seedream-5-0` | Doubao Seedream 5.0 | bytedance | 国内（火山方舟） | generations + JSON **`image`** | **`per_image`**（¥0.22/张一口价） |
| `doubao-seedream-5-0-pro` | Doubao Seedream 5.0 Pro | bytedance | 国内（火山方舟） | 同上 | **`per_image`**（¥0.30/¥0.60 按像素档 + 参考图） |
| `glm-image` | GLM Image | zhipu | 国内 / Z.AI 国际 | generations（按上游） | **`per_image`**（¥0.1/次） |
| `grok-imagine-image-2.0` | Grok Imagine Image 2.0 | xai | 海外 | generations（及上游 edits） | **`per_image`**（$0.04/张一口价） |
| `grok-imagine-image-quality` | Grok Imagine Image Quality | xai | 海外 | generations（及上游 edits） | **`per_image`**（1K $0.05 / 2K $0.07；input $0.01） |
| `gemini-3.1-flash-image` | Gemini 3.1 Flash Image | google | 海外 | generations（OpenAI 兼容层） | **`token`**（Nano Banana 2） |
| `gemini-3-pro-image-preview` | Gemini 3 Pro Image Preview | google | 海外 | 同上 | **`token`**（Nano Banana Pro） |
| `qwen-image-3.0-pro` | Qwen Image 3.0 Pro | aliyun | 国内（百炼） | DashScope 原生（非 OpenAI Images） | **`per_image`**（¥0.25/¥0.50 按 1K/2K + 参考图） |
| `qwen-image-3.0` | Qwen Image 3.0 | aliyun | 国内（百炼） | 同上 | **`per_image`**（¥0.18/张 + 参考图） |
| `wan2.7-image-pro` | Wan 2.7 Image Pro | aliyun | 国内（百炼） | 同上 | **`per_image`**（¥0.50/张一口价） |
| `wan2.7-image` | Wan 2.7 Image | aliyun | 国内（百炼） | 同上 | **`per_image`**（¥0.20/张一口价） |

约定：

- Catalog id **=** 上游 `provider_model_name`（与 `gpt-image-2` 一致）；若控制台用推理接入点，Route 可填 `ep-…`。
- 模型预设 **不** 写 `suggested_provider_model_name` / `suggested_custom_params`；默认参数由客户端或 Route `custom_params` 注入。
- 旧 id（如 `doubao-seedream-4-5-*`、`cogview-*`、`gemini-2.5-flash-image`、`grok-imagine-image-pro`、`qwen-image` / `qwen-image-plus` / `qwen-image-2.0-*` / `wan2.6-*` / `wanx*`）不进静态预设；库里若仍有旧行需手工清理。
- 新增厂商：补 `<vendor>-image.json` + Provider 模板（须有 OpenAI Images `images.generations`）+ 本文表格。阿里云百炼目录已收录当前代 `qwen-image-3.0*` / `wan2.7-image*`（按张计费）；上游仍是 DashScope 原生接口，**尚未**接入 Gateway OpenAI Images 驱动，导入后不能直接打 `/v1/images/generations`。

## Provider 配置

### OpenAI（`gpt-image-2`）

- Import / 手建 Provider：`endpoints.openai.base` = `https://api.openai.com/v1`（或显式写 `images.generations` / `images.edits` 完整 URL）。
- `base` 会派生标准路径：`…/images/generations`、`…/images/edits`。
- Key 写入 `providers.api_key`（单键；`status=active`）。

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

### xAI（`grok-imagine-image-2.0` / `grok-imagine-image-quality`）

- 模板 **xAI (Grok)**：`endpoints.openai.base` = `https://api.x.ai/v1`（派生 `images/generations`）。
- `grok-imagine-image-2.0` 为 2026-08-07 正式 API 型号；官网输出一口价 **$0.04/张**（支持 `quality=low|medium` 与 `resolution=1k|2k`，价目页未再按分辨率拆档）。

### Google Gemini（Nano Banana）

- 模板 **Google Gemini (Generative Language API)**：`endpoints.openai.base` = `https://generativelanguage.googleapis.com/v1beta/openai`
- 官方 OpenAI 兼容层文档常见示例含 `gemini-3-pro-image-preview`；`gemini-3.1-flash-image` 为当前稳定型号，若兼容层拒识再按 Google 文档改 Route `provider_model_name`。
- 建议请求显式 `response_format=b64_json`（与 Google 兼容文档一致）。

### 阿里云百炼（`qwen-image-3.0*` / `wan2.7-image*`）

- 模板 **Alibaba Cloud Bailian** 仍只配 OpenAI 兼容 Chat + DashScope 音频 Base；**不要**把 DashScope 原生生图 URL 写进 `images.generations`（OpenAI Images 驱动无法直打该路径）。
- 官方：千问 3.0 走 `…/services/aigc/multimodal-generation/generation`；万相 2.7 走 `…/services/aigc/image-generation/generation`。二者均 **不** 支持 `compatible-mode` Images。
- 目录用途：Admin → Models → Import 的价目与型号；真正经 Gateway `/v1/images/generations` 出图需等 DashScope 生图驱动，或上游另提供 OpenAI Images 兼容层。

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
  -d '{"model":"doubao-seedream-5-0","prompt":"海边灯塔水彩封面","size":"2K","n":1,"watermark":false}'
```

Seedream 图生图（勿打 `/edits`）：

```json
{
  "model": "doubao-seedream-5-0",
  "prompt": "把背景换成黄昏海边",
  "size": "2K",
  "image": "https://example.com/ref.png"
}
```

## 计费（双模式）

`models.pricing_profile` 用显式 **`image_billing_mode`** 区分（禁止混配）：

| 模式 | 适用 | 扣费权威 | `pricing_audit.kind` |
|------|------|----------|----------------------|
| **`token`** | gpt-image-2、Gemini Nano Banana | 上游 `usage` 分项 × tier `image_*` / text 单价 | `image_tokens` |
| **`per_image`** | Seedream / GLM / Grok / 阿里云百炼 | 确认输出张数 × `image.default`（+ 可选参考图 `image.input`）；**无需 / 不计价 `tiers`** | `image_per_image` |

再乘路由 `charged_factor` / `metered_factor`。Request log 另有结构化列 `billing_kind`、`input_image_count`、`output_image_count`。

### token 模式

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
| 成功出图 | 按响应 `usage` 真实分项扣费 |
| 客户端取消 / Gateway 超时（合成 504，已发出） | **零费用**（与上游 4xx/5xx 对齐；入口预检只拦额度，不落成实扣） |
| 明确上游错误 / 网络 502 / 空结果 | 零费用 |
| 无 mode 且无正 `image_*` | **不计费** |

### per_image 模式

```text
charged ≈
  output_unit × confirmed_output_count
+ input_unit × reference_count
（再 × charged_factor）
```

| 规则 | 行为 |
|------|------|
| 成功出图 | 按有效返回图片数 + 请求参考图数结算；**忽略** usage tokens |
| 客户端取消 / Gateway 超时 / 结果不明（已发出） | **零费用**（与 token / 上游 4xx/5xx 对齐；`uncertain_result_policy` 不再作为 abort 扣费开关） |
| 明确失败且未发出 / 空结果 | 零费用 |
| 无显式 `image_billing_mode: per_image` 的 legacy `image` 块 | **不计费**（避免旧数据突然扣款） |

已部署库可用：`node scripts/db/migrate-image-billing-modes.mjs --dry-run`（再 `--apply`）。

### 预设单价（摘要）

**`gpt-image-2`**（`token`；USD / 1M；CNY = ×7）：

| 分项 | USD | CNY |
|------|-----|-----|
| text `input_price` | 5 | 35 |
| cached text `cache_read_price` | 1.25 | 8.75 |
| `image_input_price` | 8 | 56 |
| `image_input_cache_price` | 2 | 14 |
| `image_output_price` | 30 | 210 |

**按张类**（`per_image`；`image.default` 为权威单价 / 张；官方来源见备注）：

| Catalog id | CNY / 张 | USD / 张 | 备注 |
|------------|----------|----------|------|
| `doubao-seedream-5-0` | **0.22** | **0.035** | 火山方舟一口价；BytePlus $0.035；**不按 4K 翻倍** |
| `doubao-seedream-5-0-pro` | **0.30**（≤2.36MP）/ **0.60**（>2.36MP） | **0.045** / **0.09** | `by_size`：`2k`→低档，`3k`/`4k`→高档；`image.input` CNY **0.02** / USD **0.003**（官方首张免费网关暂按全量计） |
| `glm-image` | **0.1** | **0.014** | 智谱官方 ¥0.1/次；USD ≈ ×7.14（国内权威 CNY） |
| `qwen-image-3.0-pro` | **0.25**（1K）/ **0.50**（2K） | **0.036** / **0.071** | 百炼华北2 原价；`image.input` CNY **0.02** / USD **0.003**；USD = CNY ÷ 7 |
| `qwen-image-3.0` | **0.18** | **0.026** | 1K/2K 同价；`image.input` 同上 |
| `wan2.7-image-pro` | **0.50** | **0.071** | 一口价（含 4K 文生图）；官方输入不计费 |
| `wan2.7-image` | **0.20** | **0.029** | 一口价，最高 2K；官方输入不计费 |
| `grok-imagine-image-2.0` | **0.28** | **0.04** | xAI 官方一口价；CNY = USD ×7；价目页未单列参考图单价 |
| `grok-imagine-image-quality` | **0.35**（1K）/ **0.49**（2K） | **0.05** / **0.07** | xAI 官方；CNY = USD ×7；`image.input.default` USD **0.01**（CNY **0.07**） |

**Google Nano Banana**（`token`；官方 $/1M；CNY = ×7）：

| Catalog id | text/image `input_price` | text `output_price` | `image_output_price` | input CNY | text-out CNY | img-out CNY |
|------------|--------------------------|---------------------|----------------------|-----------|--------------|-------------|
| `gemini-3.1-flash-image` | 0.5 | **3** | **60** | 3.5 | **21** | **420** |
| `gemini-3-pro-image-preview` | 2 | **12** | **120** | 14 | **84** | **840** |

## 预检与估算

| 模式 | 预检 | 最终扣费 |
|------|------|----------|
| **token** | quality×size **估算** output tokens（偏保守）× 单价 × 最高 `charged_factor` | 成功响应 **usage** |
| **per_image** | `unit × 请求输出张数 + input_unit × 参考图数` × 最高 factor | 成功响应 **有效图片数** |

Admin Routes / Models 只展示目录权威价：token 模式为 `/1M` 分项；per_image 为 `/image` 单价。不再展示 quality×size 估算矩阵。

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
2. 建 openai 路由；Billing：token 模型显示 `/M`，per_image 显示 `/image`  
3. Playground 出图（不计费）  
4. Simulator / curl 打 Proxy，核对：
   - GPT：`pricing_audit.kind=image_tokens`，`charged_cost` 随 usage 分项变化  
   - Seedream：`pricing_audit.kind=image_per_image`，`output_image_count=1`，`charged_cost≈官方单价×charged_factor`  
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
