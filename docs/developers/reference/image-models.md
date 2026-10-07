# 文生图模型（Image Models）

本文是网关生图能力的总入口：客户端入口与路由、目录模型与单价、计费与预检、验收与维护流程。各厂商的端点、参数规则和官方来源写在厂商文档里：

| 厂商文档 | 覆盖型号 |
| -------- | -------- |
| [OpenAI 兼容生图透传](../architecture/openai-compatible-image.md) | OpenAI GPT Image、智谱 GLM Image、xAI Grok Imagine、Google Gemini |
| [火山方舟 Seedream 生图](../architecture/volcengine-image.md) | Seedream 5.0 lite / pro / flash |
| [DashScope 原生生图](../architecture/dashscope-image.md) | 千问图像、万相 |
| [MiniMax 生图](../architecture/minimax-image.md) | `image-01`、`image-01-live` |

字段细节见 [用户接口 · Images](../api/user.md#images图片生成--编辑)。

## 入口与路由

文生图不走 `/v1/chat/completions`。OpenAI Images 是默认入口，各厂商另有原生透传入口：

| 客户端路径 | 请求协议 / 能力 | 上游协议 / 能力 | 适配器 | 厂商文档 |
| ---------- | --------------- | --------------- | ------ | -------- |
| `POST /v1/images/generations` | `openai` / `images.generations` | `openai` / `images.generations` | `passthrough` | [OpenAI 兼容](../architecture/openai-compatible-image.md) |
| 同上 | 同上 | `volcengine` / `images.generations` | `volcengine-image` | [火山方舟](../architecture/volcengine-image.md) |
| 同上 | 同上 | `dashscope` / `images.generations.multimodal` | `dashscope-image-qwen`、`dashscope-image-wan` | [DashScope](../architecture/dashscope-image.md) |
| 同上 | 同上 | `minimax` / `images.generations` | `minimax-image` | [MiniMax](../architecture/minimax-image.md) |
| `POST /v1/images/edits`（multipart） | `openai` / `images.edits` | `openai` / `images.edits` | `passthrough` | 只有 OpenAI GPT Image 可用 |
| `POST /v1/volcengine/images/generations` | `volcengine` / `images.generations` | 同左 | `passthrough` | [火山方舟](../architecture/volcengine-image.md) |
| `POST /v1/dashscope/services/aigc/multimodal-generation/generation` | `dashscope` / `images.generations.multimodal` | 同左 | `passthrough` | [DashScope](../architecture/dashscope-image.md) |
| `POST /v1/minimax/image_generation` | `minimax` / `images.generations` | 同左 | `passthrough` | [MiniMax](../architecture/minimax-image.md) |

失败转移复用 `failoverDispatch`。混合协议的路由池会把同一份请求交给每条路由的适配器各自转换。

模型的种类按输出模态判定：`output_modalities` 含 `image` 即为生图模型，不能看输入模态（多模态 LLM 也接受图片）。默认的 `/v1/models` 不含纯生图模型，需要 `kind=image` 或 `kind=all`。

### OpenAI 入口的参数速查

下表只列网关自己的处理。各型号的官方取值范围以厂商文档为准。

| 路由 | 尺寸字段 | `n` | 参考图 |
| ---- | -------- | --- | ------ |
| OpenAI 兼容透传 | 顶层字段原样转发，不校验、不改名 | 只能为 1 | GPT Image 走 `/v1/images/edits`；其它厂商经网关只能文生图 |
| `volcengine-image` | `size` 原样转发，包括 `auto` | 1–15，映射成组图；5.0 pro / flash 只能为 1 | generations 的 JSON `image` |
| `dashscope-image-qwen` | 顶层 `size` 原样写入 `parameters.size`。千问用 `宽*高` 或 `auto` | 1–6 | generations 的 JSON `image` |
| `dashscope-image-wan` | 同上。万相用 `1K` / `2K` / `4K` 或 `宽*高` | 1–4 | generations 的 JSON `image` |
| `minimax-image` | 不转发 `size`。`aspect_ratio`、`width`、`height` 有值才原样转发，不填默认比例 | 1–9 | 走原生透传的 `subject_reference` |

## 模型目录

静态预设放在 `packages/admin/lib/model-presets/`，生图模型一般在 `<vendor>-image.json`（MiniMax 在 `minimax.json`）。在管理后台的模型（Models）页导入预设；同 ID 已存在时不会覆盖，改价需要编辑模型，或对已知型号运行 `node scripts/db/migrate-image-billing-modes.mjs --apply`。

目录 ID 一般与上游的供应商模型名一致。例外是 MiniMax：目录 ID 带 `minimax-` 前缀，路由的供应商模型名填 `image-01` / `image-01-live`。火山方舟用推理接入点时，路由填 `ep-…`。预设不写 `suggested_provider_model_name` 或 `suggested_custom_params`，默认参数由客户端或路由 `custom_params` 注入。退役型号不进预设，库里的旧行需要手工清理。

下面三张表由 `npm run docs:image-models` 从预设生成，请勿手改。CNY 一般按 USD × 7 换算，以预设为准。

<!-- BEGIN GENERATED: image-models (npm run docs:image-models) -->

### 目录总览

| 模型 ID | 展示名 | 厂商文档 | 计费模式 | CNY | USD | 分档 | 预设文件 |
|---|---|---|---|---|---|---|---|
| `qwen-image-2.1-pro` | Qwen Image 2.1 Pro | [百炼 DashScope](../architecture/dashscope-image.md) | `per_image` | ¥0.25/张 | $0.04/张 | 一口价 | `aliyun-image.json` |
| `qwen-image-3.0` | Qwen Image 3.0 | [百炼 DashScope](../architecture/dashscope-image.md) | `per_image` | ¥0.18/张 | $0.03/张 | 参考图 | `aliyun-image.json` |
| `qwen-image-3.0-pro` | Qwen Image 3.0 Pro | [百炼 DashScope](../architecture/dashscope-image.md) | `per_image` | ¥0.25/张 | $0.04/张 | `by_size`、参考图 | `aliyun-image.json` |
| `wan2.7-image` | Wan 2.7 Image | [百炼 DashScope](../architecture/dashscope-image.md) | `per_image` | ¥0.2/张 | $0.03/张 | 一口价 | `aliyun-image.json` |
| `wan2.7-image-pro` | Wan 2.7 Image Pro | [百炼 DashScope](../architecture/dashscope-image.md) | `per_image` | ¥0.5/张 | $0.075/张 | 一口价 | `aliyun-image.json` |
| `doubao-seedream-5-0` | Doubao Seedream 5.0 | [火山方舟 Seedream](../architecture/volcengine-image.md) | `per_image` | ¥0.22/张 | $0.035/张 | 一口价 | `bytedance-image.json` |
| `doubao-seedream-5-0-flash` | Doubao Seedream 5.0 Flash | [火山方舟 Seedream](../architecture/volcengine-image.md) | `per_image` | ¥0.12/张 | $0.018/张 | 一口价 | `bytedance-image.json` |
| `doubao-seedream-5-0-pro` | Doubao Seedream 5.0 Pro | [火山方舟 Seedream](../architecture/volcengine-image.md) | `per_image` | ¥0.6/张 | $0.09/张 | `by_size`、参考图 | `bytedance-image.json` |
| `gemini-3-pro-image-preview` | Gemini 3 Pro Image Preview | [Google Gemini](../architecture/openai-compatible-image.md#google-gemini-nano-banana) | `token` | 图出 ¥840/1M | 图出 $120/1M | 按 usage | `google-image.json` |
| `gemini-3.1-flash-image` | Gemini 3.1 Flash Image | [Google Gemini](../architecture/openai-compatible-image.md#google-gemini-nano-banana) | `token` | 图出 ¥420/1M | 图出 $60/1M | 按 usage | `google-image.json` |
| `gemini-nano-banana-2.1` | Gemini Nano Banana 2.1 | [Google Gemini](../architecture/openai-compatible-image.md#google-gemini-nano-banana) | `token` | — | 图出 $30/1M | 按 usage | `google-image.json` |
| `minimax-image-01` | MiniMax Image 01 | [MiniMax](../architecture/minimax-image.md) | `per_image` | ¥0.025/张 | $0.0035/张 | 一口价 | `minimax.json` |
| `minimax-image-01-live` | MiniMax Image 01 Live | [MiniMax](../architecture/minimax-image.md) | `per_image` | ¥0.025/张 | $0.0035/张 | 一口价 | `minimax.json` |
| `gpt-image-2` | GPT Image 2 | [OpenAI GPT Image](../architecture/openai-compatible-image.md#openai-gpt-image) | `token` | 图出 ¥210/1M | 图出 $30/1M | 按 usage | `openai-image.json` |
| `gpt-image-2.5-flare` | GPT Image 2.5 Flare | [OpenAI GPT Image](../architecture/openai-compatible-image.md#openai-gpt-image) | `token` | 图出 ¥210/1M | 图出 $30/1M | 按 usage | `openai-image.json` |
| `gpt-image-2.5-sunburst` | GPT Image 2.5 Sunburst | [OpenAI GPT Image](../architecture/openai-compatible-image.md#openai-gpt-image) | `token` | 图出 ¥210/1M | 图出 $30/1M | 按 usage | `openai-image.json` |
| `grok-imagine-image-2.0` | Grok Imagine Image 2.0 | [xAI Grok Imagine](../architecture/openai-compatible-image.md#xai-grok-imagine) | `per_image` | ¥0.28/张 | $0.04/张 | `by_quality_size`、`by_quality`、`by_size`、参考图 | `xai-image.json` |
| `grok-imagine-image-quality` | Grok Imagine Image Quality | [xAI Grok Imagine](../architecture/openai-compatible-image.md#xai-grok-imagine) | `per_image` | ¥0.35/张 | $0.05/张 | `by_size`、参考图 | `xai-image.json` |
| `glm-image` | GLM Image | [智谱 GLM Image](../architecture/openai-compatible-image.md#智谱-glm-image) | `per_image` | ¥0.1/张 | $0.014/张 | 一口价 | `zhipu-image.json` |

### 按张分档

查价顺序是 `by_quality_size`（键为 `quality:size`）→ `by_quality` → `by_size` → `default`。没有列出的模型按目录总览里的一口价计费。

| 模型 ID | 档位 | CNY / 张 | USD / 张 |
|---|---|---|---|
| `qwen-image-3.0` | 参考图 `input.default` | ¥0.02 | $0.003 |
| `qwen-image-3.0-pro` | `by_size` · `1k` | ¥0.25 | $0.04 |
| `qwen-image-3.0-pro` | `by_size` · `2k` | ¥0.5 | $0.075 |
| `qwen-image-3.0-pro` | 参考图 `input.default` | ¥0.02 | $0.003 |
| `doubao-seedream-5-0-pro` | `by_size` · `1k` | ¥0.3 | $0.045 |
| `doubao-seedream-5-0-pro` | `by_size` · `1.5k` | ¥0.3 | $0.045 |
| `doubao-seedream-5-0-pro` | `by_size` · `2k` | ¥0.6 | $0.09 |
| `doubao-seedream-5-0-pro` | 参考图 `input.default` | ¥0.02 | $0.003 |
| `grok-imagine-image-2.0` | `by_quality_size` · `low:1k` | ¥0.28 | $0.04 |
| `grok-imagine-image-2.0` | `by_quality_size` · `low:1.5k` | ¥0.35 | $0.05 |
| `grok-imagine-image-2.0` | `by_quality_size` · `low:2k` | ¥0.42 | $0.06 |
| `grok-imagine-image-2.0` | `by_quality_size` · `medium:1k` | ¥0.42 | $0.06 |
| `grok-imagine-image-2.0` | `by_quality_size` · `medium:1.5k` | ¥0.49 | $0.07 |
| `grok-imagine-image-2.0` | `by_quality_size` · `medium:2k` | ¥0.56 | $0.08 |
| `grok-imagine-image-2.0` | `by_quality` · `low` | ¥0.28 | $0.04 |
| `grok-imagine-image-2.0` | `by_quality` · `medium` | ¥0.42 | $0.06 |
| `grok-imagine-image-2.0` | `by_size` · `1k` | ¥0.28 | $0.04 |
| `grok-imagine-image-2.0` | `by_size` · `1.5k` | ¥0.35 | $0.05 |
| `grok-imagine-image-2.0` | `by_size` · `2k` | ¥0.42 | $0.06 |
| `grok-imagine-image-2.0` | 参考图 `input.default` | ¥0.07 | $0.01 |
| `grok-imagine-image-quality` | `by_size` · `1k` | ¥0.35 | $0.05 |
| `grok-imagine-image-quality` | `by_size` · `2k` | ¥0.49 | $0.07 |
| `grok-imagine-image-quality` | 参考图 `input.default` | ¥0.07 | $0.01 |

### Token 单价

单位是每百万 token。`—` 表示该币种没有预设，导入后需要手工补价。

| 模型 ID | 币种 | 文本输入 | 文本缓存 | 文本输出 | 图片输入 | 图片输入缓存 | 图片输出 |
|---|---|---|---|---|---|---|---|
| `gemini-3-pro-image-preview` | CNY | ¥14 | — | ¥84 | ¥14 | — | ¥840 |
| `gemini-3-pro-image-preview` | USD | $2 | — | $12 | $2 | — | $120 |
| `gemini-3.1-flash-image` | CNY | ¥3.5 | — | ¥21 | ¥3.5 | — | ¥420 |
| `gemini-3.1-flash-image` | USD | $0.5 | — | $3 | $0.5 | — | $60 |
| `gemini-nano-banana-2.1` | USD | $1.5 | — | $7.5 | $1.5 | — | $30 |
| `gpt-image-2` | CNY | ¥35 | ¥8.75 | ¥0 | ¥56 | ¥14 | ¥210 |
| `gpt-image-2` | USD | $5 | $1.25 | $0 | $8 | $2 | $30 |
| `gpt-image-2.5-flare` | CNY | ¥35 | ¥8.75 | ¥0 | ¥56 | ¥14 | ¥210 |
| `gpt-image-2.5-flare` | USD | $5 | $1.25 | $0 | $8 | $2 | $30 |
| `gpt-image-2.5-sunburst` | CNY | ¥35 | ¥8.75 | ¥0 | ¥56 | ¥14 | ¥210 |
| `gpt-image-2.5-sunburst` | USD | $5 | $1.25 | $0 | $8 | $2 | $30 |

<!-- END GENERATED: image-models -->

## 计费

`models.pricing_profile.image_billing_mode` 决定计费方式，两种模式不能混用。金额最后再乘路由的 `charged_factor` / `metered_factor`。请求日志另有结构化列 `billing_kind`、`input_image_count`、`output_image_count`。

| 模式 | 扣费依据 | `pricing_audit.kind` |
| ---- | -------- | -------------------- |
| `token` | 上游 `usage` 分项 × tier 的 `image_*` 与文本单价 | `image_tokens` |
| `per_image` | 确认输出张数 × 出图单价，加参考图张数 × `image.input` 单价；不需要 `tiers` | `image_per_image` |

### token 模式

```text
charged ≈
  text_input × input_price
+ cached_text × cache_read_price
+ image_input × image_input_price
+ cached_image_input × image_input_cache_price
+ image_output × image_output_price
（单价均为每百万 token；再 × charged_factor）
```

### per_image 模式

```text
charged ≈
  output_unit × confirmed_output_count
+ input_unit × reference_count
（再 × charged_factor）
```

单价按 `by_quality_size`（键为 `quality:size`）→ `by_quality` → `by_size` → `default` 的顺序查找，键不区分大小写。查价用的 `quality` 与 `size` 来源：

- `quality` 取请求值，缺省为 `auto`。
- `size` 取请求的 `size`；没有时取扩展字段 `resolution`（xAI 用它选 1k / 2k）；都没有时为 `auto`。
- 火山方舟两条入口把 `宽x高` 按像素换算成档位；千问 3.0 Pro 从响应 `usage.output_image_type` 反推 `1k` / `2k`。换算结果会覆盖请求里的 `size`。

### 零费用规则

| 情况 | 行为 |
| ---- | ---- |
| 成功出图 | token 按响应 `usage` 分项；per_image 按有效图片数与参考图数，忽略 usage |
| 客户端取消、网关超时（合成 504，请求已发出）、结果不明 | 零费用。`uncertain_result_policy` 不再作为取消扣费的开关 |
| 明确的上游错误、网络 502、空结果 | 零费用 |
| 没有 `image_billing_mode`，且 tier 里没有正的 `image_*` | 不计费 |
| 只有旧的 `image` 块、没有显式 `per_image` | 不计费，避免旧数据突然扣款 |

### 预检

| 模式 | 预检 | 最终扣费 |
| ---- | ---- | -------- |
| `token` | 按 `quality` × `size` 估算输出 token（偏保守）× 单价 × 最高 `charged_factor` | 成功响应的 `usage` |
| `per_image` | 出图单价 × 请求张数 + 参考图单价 × 参考图数，再 × 最高 factor | 成功响应的有效图片数 |

预检只拦额度，不落成实扣。管理后台的路由与模型页只展示目录价：token 模式显示 `/1M` 分项，per_image 显示 `/image` 单价。

## 路由配置清单

1. 模型 ID 选目录里的生图模型。
2. 按上方“入口与路由”表选请求协议、上游协议与适配器。
3. 供应商模型名一般与目录 ID 相同；MiniMax 去掉 `minimax-` 前缀，火山方舟可填 `ep-…`。
4. 供应商配好 Key 与对应协议的端点，见各厂商文档。
5. 可选 `custom_params`，如默认 `watermark: false`；用户显式传入的值优先。
6. 按业务设置 `charged_factor` / `metered_factor`。

## 运营验收

管理后台没有独立的生图页，闭环是路由（Routes）→ 调试台（Playground）→ 模拟器（Simulator）→ 请求日志（Request Logs）。

1. 导入供应商与生图模型预设。
2. 建路由。路由页的计费栏应显示 `/1M`（token）或 `/image`（per_image）。
3. 在调试台出图。调试台直连上游，不计费、不写请求日志。
4. 用模拟器或 curl 打代理服务，在请求日志核对：
   - token 模型：`pricing_audit.kind=image_tokens`，`charged_cost` 随 usage 分项变化。
   - per_image 模型：`pricing_audit.kind=image_per_image`，`output_image_count` 与实际张数一致，`output_unit_price` 与目录档位一致。
5. 各厂商的特有检查见厂商文档的“验收”一节。

逐步细节见 [Admin API · gpt-image-2 验收](../api/admin.md#运维验收文生图模型-gpt-image-2) 与 [Seedream 验收](../api/admin.md#运维验收国内文生图-seedream-火山方舟)。

## 新增或更新模型

1. 在 `packages/admin/lib/model-presets/` 改价或加型号，`modalities.output` 写 `image`，两种币种都写 `image_billing_mode`。
2. 运行 `npm run docs:image-models` 重新生成本文的目录表。`npm run test:docs` 会在预设与文档不一致时失败。
3. 新厂商要先写厂商文档，并在 `scripts/docs/gen-image-models.mjs` 的 `VENDOR_DOCS` 登记，否则生成脚本会报错。
4. 在厂商文档里更新参数规则，以及“官方来源”的核对日期。
5. 已部署实例的模型不会自动更新。改价时在 `scripts/db/migrate-image-billing-modes.mjs` 同步单价，并在 `CHANGELOG.md` 的 Unreleased 说明需要手工改价或运行迁移脚本。

## 相关代码与文档

| 主题 | 路径 |
| ---- | ---- |
| Images 用户接口 | [api/user.md · Images](../api/user.md#images图片生成--编辑) |
| 运维验收 | [api/admin.md](../api/admin.md) |
| 供应商导入预设 | [provider-import-presets.md](./provider-import-presets.md) |
| 流式计费与取消（Chat；生图的取消语义并列） | [streaming-billing.md](./streaming-billing.md) |
| OpenAI 入口与扩展字段 | `packages/proxy/src/routes/v1/images.ts`、`packages/proxy/src/services/image-generation-extras.ts` |
| 按张查价与计费 | `packages/core/src/db/pricing-profile.ts`、`packages/proxy/src/services/image-usage-charge.ts` |
| token 预检估算 | `packages/core/src/db/image-token-usage.ts` |
| 目录表生成 | `scripts/docs/gen-image-models.mjs` |
