# OpenAI 兼容生图透传

本文说明以 OpenAI Images 协议透传的生图上游：OpenAI GPT Image、智谱 GLM Image、xAI Grok Imagine 与 Google Gemini（Nano Banana）。目录价与通用计费见 [文生图模型](../reference/image-models.md)。

## 共同规则

路由的请求与上游都是 `openai`，适配器 `passthrough`。驱动是 `packages/proxy/src/services/egress/openai-images-driver.ts`：

| 客户端路径 | 上游路径 | 格式 |
| ---------- | -------- | ---- |
| `POST /v1/images/generations` | `{openai.base}/images/generations` | JSON |
| `POST /v1/images/edits` | `{openai.base}/images/edits` | multipart：1 张用 `image`，多张用 `image[]`，最多 5 张 |

网关构建上游请求体时：

- `prompt` 必填，最长 4000 字符。`n` 只能为 1；要多张请多次请求。
- `size`、`quality`、`background`、`output_format`、`style` 原样转发；`response_format` 只在客户端显式传入时转发，因为 GPT Image 不接受这个字段。
- 其它顶层字段作为额外字段深度合并后发往上游（OpenAI SDK 的 `extra_body` 发到线上就是平铺字段），总量超过 32KB 返回 400。路由 `custom_params` 可注入默认值，用户显式传入的值优先，见 [Route 默认参数合并](../api/user.md#route-默认参数合并)。
- 网关不按模型校验 `size`、`quality` 的取值，越界由上游报错。

按张计费的模型用 `quality` 和 `size` 查分档价。客户端没传 `size` 时，网关用扩展字段 `resolution` 作为尺寸档；都没有时按 `auto` 查价。

## OpenAI GPT Image

型号：`gpt-image-2`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`（`openai-image.json`）。

**端点**：导入模板 **OpenAI** 的 `openai.base` 为 `https://api.openai.com/v1`，派生 generations 与 edits。

**参数规则**：

| 字段 | 官方规则 |
| ---- | -------- |
| `size` | `auto`（默认）或 `宽x高`。两边都是 16 的倍数，长短边比不超过 3:1，最长边不超过 3840，总像素 655,360–8,294,400。超过 `2560x1440` 官方标为实验。常用 `1024x1024`、`1536x1024`、`1024x1536`、`2048x2048`、`2048x1152`、`3840x2160` |
| `quality` | `gpt-image-2`：`low` / `medium` / `high` / `auto`。2.5 系列另有 `xhigh`、`max` |
| `background` | `transparent` / `opaque` / `auto`；透明背景需 `output_format` 为 `png` 或 `webp` |
| `output_format` | `png` / `jpeg` / `webp` |
| 参考图 | 走 `/v1/images/edits` multipart |

**计费**：`token` 模式，按响应 `usage` 分项计价。预检按 `quality` × `size` 估算输出 token，见 `packages/core/src/db/image-token-usage.ts`。三个型号单价相同，但 2.5 的 token 消耗量不能套用 GPT Image 2 的计算器估算。

## 智谱 GLM Image

型号：`glm-image`（`zhipu-image.json`）。

**端点**：国内模板 **Zhipu GLM** 的 `openai.base` 为 `https://open.bigmodel.cn/api/paas/v4`；国际模板 **Z.AI GLM (International)** 为 `https://api.z.ai/api/paas/v4`。Coding Plan 模板只有对话，不要用来跑生图。

**参数规则**：

| 字段 | 官方规则 |
| ---- | -------- |
| `size` | `宽x高`，默认 `1280x1280`。推荐 `1568x1056`、`1056x1568`、`1472x1088`、`1088x1472`、`1728x960`、`960x1728`。自定义时两边在 1024–2048 之间、为 32 的倍数，总像素不超过 2^22 |
| `quality` | 只支持 `hd`（默认） |
| 参考图 | 不支持；只有 generations |

**计费**：`per_image` 一口价。

## xAI Grok Imagine

型号：`grok-imagine-image-2.0`、`grok-imagine-image-quality`（`xai-image.json`）。

**端点**：导入模板 **xAI (Grok)** 的 `openai.base` 为 `https://api.x.ai/v1`。

**参数规则**：xAI 不用 OpenAI 的 `size`，比例和分辨率是两个扩展字段，直接写在请求体顶层（OpenAI SDK 用 `extra_body`）。

| 字段 | 官方规则 |
| ---- | -------- |
| `aspect_ratio` | `1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`、`2:1`、`1:2`、`19.5:9`、`9:19.5`、`20:9`、`9:20`、`21:9`、`5:2`、`auto`（默认，由模型决定） |
| `resolution` | `1k`（默认）、`2k` |
| `quality` | 仅 2.0 支持：`low`、`medium`、`auto`（默认）。`auto` 在生成时按 `low` 出图 |
| `n` | 官方 1–10，经网关只能为 1 |
| 参考图 | xAI 的 `/images/edits` 只接受 JSON（`image.url`）。网关的 `/v1/images/edits` 发 multipart，因此暂不能经网关编辑 Grok 图片 |

```python
client.images.generate(
    model="grok-imagine-image-2.0",
    prompt="An astronaut performing EVA in LEO.",
    quality="medium",
    extra_body={"resolution": "2k", "aspect_ratio": "16:9"},
)
```

**计费**：`per_image`。2.0 按分辨率 × quality 分档，网关用 `quality` 与 `resolution` 查 `by_quality_size`；`quality` 缺省或为 `auto` 时按 low 档，`resolution` 缺省时按 1K。价目页的 1.5K 档无法通过 `resolution` 选到，只在上游按该档出图时才适用，网关不会自动识别。

**退役**：`grok-imagine-image-quality`（及别名 `grok-imagine-image-pro`）于 2026-11-02 退役，此后请求由 2.0 以 `low` 档出图，按 2.0 的 low 价收费。目录价不支持按日期切换，届时需要把该模型的单价改成 2.0 的 low 档，或让客户端直接改用 `grok-imagine-image-2.0`。

## Google Gemini Nano Banana

型号：`gemini-nano-banana-2.1`、`gemini-3.1-flash-image`、`gemini-3-pro-image-preview`（`google-image.json`）。

**端点**：导入模板 **Google Gemini (Generative Language API)** 的 `openai.base` 为 `https://generativelanguage.googleapis.com/v1beta/openai`。

**参数规则**：兼容层只认 `prompt`、`model`、`n`、`size`、`response_format`，其它字段会被静默忽略。Gemini 特有能力按兼容层文档的 `extra_body` 传：`aspect_ratio`（如 `16:9`）、`generation_config`、`safety_settings`，以及仅 `gemini-3-pro-image-preview` 支持的 `tools`（Google 搜索接地）。建议显式传 `response_format=b64_json`。兼容层没有 edits。

兼容层文档的示例型号是 `gemini-2.5-flash-image` 与 `gemini-3-pro-image-preview`。新型号若被兼容层拒识，按 Google 文档调整路由的供应商模型名。

**计费**：`token` 模式。Google 未公布人民币刊例，CNY 目录价按 USD × 7 占位。

## 官方来源

核对于 2026-10-07：

- [OpenAI · Image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [智谱 · 图像生成 API](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%9B%BE%E5%83%8F%E7%94%9F%E6%88%90)
- [xAI · Image Generation](https://docs.x.ai/developers/model-capabilities/images/generation)、[Image Editing](https://docs.x.ai/developers/model-capabilities/images/editing)、[grok-imagine-image-2.0](https://docs.x.ai/developers/models/grok-imagine-image-2.0)、[grok-imagine-image-quality 退役说明](https://docs.x.ai/developers/migration/imagine-image-quality-nov-2)
- [Gemini API · OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
