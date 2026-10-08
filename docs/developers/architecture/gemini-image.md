# Gemini 原生生图

Gemini 官方图片模型与大语言模型共用 `POST /v1beta/models/{model}:{generateContent|streamGenerateContent}`。图片模型走专用透传驱动，按 `usageMetadata` 的 TEXT / IMAGE 分项计费。OpenAI SDK 也可以经 `gemini-image` 适配器调用同一上游，见 [OpenAI 入口](#openai-入口gemini-image)。目录价见 [文生图模型](../reference/image-models.md)。

不做 Interactions API（`/v1beta/interactions`）。调用方可以直接用 Google SDK 打现有 Gemini 入口。

## 入口

| 客户端路径 | 请求协议 / 能力 | 上游 | 适配器 | 说明 |
| ---------- | --------------- | ---- | ------ | ---- |
| `POST /v1beta/models/{model}:generateContent` | `gemini` / `models.generate` | 同左 | `passthrough`（图片描述符 `passthrough:gemini:models.generate:image`） | 非流式 JSON |
| `POST /v1beta/models/{model}:streamGenerateContent` | 同上 | 同左 | 同上 | SSE；`alt=sse` 由网关按 wire action 补上 |
| `POST /v1/images/generations` | `openai` / `images.generations` | `gemini` / `models.generate`（`generateContent`） | `gemini-image` | OpenAI JSON 进出，只做非流式 |

原生路径里的模型段仍交给 `resolveModelRouting`。目录模型的输出模态含 `image` 时，这条路径改走生图驱动，不再进入文本 Gemini 管线。文本模型行为不变。

上游 URL 仍由供应商的 `endpoints.gemini` 解析（Developer API 的 `?key=`，或 Vertex 的 Bearer），只合并路由 `custom_params`。超时为生图的 300 秒，不套用文本流的首事件超时。

适用供应商模型名：`gemini-*image*`、`gemini-nano-banana*`。目录预设为 `gemini-nano-banana-2.1`、`gemini-3.1-flash-image`、`gemini-3-pro-image-preview`（`google-image.json`）。

## 参数规则

请求体按 Gemini generateContent 原样转发。出图至少需要：

```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "a red apple on a white background" }] }],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": { "aspectRatio": "1:1", "imageSize": "1K" }
  }
}
```

- `imageConfig.imageSize` 用于预检：`512` / `0.5K`、`1K`、`2K`、`4K`。缺省或 `auto` 按 4K 上界估算。
- `generationConfig.candidateCount` 是预检张数，缺省 1，上限 8。
- 参考图放在 `contents[].parts[]` 的 `inlineData` 或 `fileData`。`thought: true` 的图片不计入参考图，也不计入成功出图。
- 成功图片在 `candidates[].content.parts[].inlineData`。

## OpenAI 入口（gemini-image）

路由的对外协议选 `openai` / `images.generations`，适配器选 `gemini-image`，上游用供应商的 `endpoints.gemini`（Gemini API 或 Vertex AI 均可）。网关把 OpenAI 请求转成 generateContent，再把响应转回 OpenAI `data[]`。

| OpenAI 字段 | 处理 |
| ----------- | ---- |
| `prompt` | 必填，成为 `contents[0].parts` 的第一个 text part |
| `n` | 只能为 1。Gemini 一次只出一张，`candidateCount` 由网关固定 |
| `size` | `宽x高`（也接受 `*`、`×`）换算成最接近的 `imageConfig.aspectRatio`；长边 ≤1600 取 `1K`，≤3200 取 `2K`，更大取 `4K`。只传 `512` / `1K` / `2K` / `4K` 时仅设 `imageSize`。`auto` 或不传则两者都不设。其它写法返回 400 |
| `response_format` | 只接受 `b64_json`（或不传），`url` 返回 400 |
| `image` | 参考图，单个或数组，必须是 base64 data URL，转成 `inlineData` |
| `quality`、`background` | 不转发 |

`responseModalities` 固定为 `TEXT` 与 `IMAGE`。其它原生参数按 Gemini 结构写成额外字段，网关深度合并后发往上游，例如：

```json
{
  "model": "gemini-3.1-flash-image",
  "prompt": "a red apple on a white background",
  "size": "1536x1024",
  "response_format": "b64_json",
  "generationConfig": { "imageConfig": { "imageSize": "2K" } }
}
```

额外字段里的 `imageConfig` 优先于 `size` 换算出的值。`contents` 与 `generationConfig.candidateCount` 由网关保留，客户端和路由 `custom_params` 都改不了。

响应：

- `data[]` 只含非 thought 图片的 `b64_json`，`output_format` 取自图片 MIME。Gemini 返回的文本 part 不出现在 OpenAI 响应里。
- `usage` 按 OpenAI Images 的结构给出：`input_tokens_details` 分 `text_tokens` / `image_tokens` / `cached_tokens`，`output_tokens_details` 分 `text_tokens`（含 thinking）与 `image_tokens`。
- 上游 200 但没有图片时返回 502，消息写明 `promptFeedback.blockReason` 或 `finishReason`。上游错误按原状态码返回。

不做 `/v1/images/edits` 和流式。要流式或拿到 Gemini 原始响应，请改走原生入口。

## 计费

`image_billing_mode=token`。`usageMetadata` 映射为：

| 上游字段 | 计费字段 | 单价 |
| -------- | -------- | ---- |
| `promptTokensDetails` 的 TEXT | `text_tokens` | `input_price` |
| `promptTokensDetails` 的 IMAGE | `image_input_tokens` | `image_input_price` |
| `cacheTokensDetails` 的 TEXT / IMAGE | 对应 cached 字段 | `cache_read_price` / `image_input_cache_price` |
| `candidatesTokensDetails` 的 IMAGE | `image_output_tokens` | `image_output_price` |
| `candidatesTokensDetails` 的 TEXT，加上 `thoughtsTokenCount` | `text_output_tokens` | `output_price` |

缺少 details 时，prompt 合计计入文本输入，candidates 合计计入图片输出，cache 合计计入文本缓存。Google 把 thinking 记在 `thoughtsTokenCount`，不在 candidates 分项里，因此按文本输出价计。

预检按 `imageSize` 取现有型号的图片输出 token 上界（核对于 2026-10-08 [Gemini 价目](https://ai.google.dev/gemini-api/docs/pricing)）：512 为 747，1K 为 1290，2K 为 1680，4K 为 3780，另加 2000 文本输出余量。最终按响应 usage 实扣。OpenAI 入口用同一套估算，档位取额外字段的 `imageConfig.imageSize`，没有时取 `size` 换算的结果；路由池里混有其它适配器时，沿用 OpenAI 入口的通用估算。

两种入口的计费相同：没有非 thought 图片、客户端取消、网关超时都是零费用。请求日志的 `pricing_audit.kind` 为 `image_tokens`，分项含图片输出与文本输出。

Google 未公布人民币刊例，CNY 目录价按 USD × 7 占位。

## 调试台与模拟器

调试台直连上游，只用 `generateContent`，不计费、不写请求日志。编辑器模板已带 `responseModalities` 与 `imageConfig`（`1:1` / `1K`）。成功后把非 thought 的 `inlineData` 转成 data URL 预览，并带出文本 part。

模拟器打代理服务的 `POST /v1beta/models/{model}:generateContent`，会写请求日志。图片模型下 Gemini 入口固定非流式。

`gemini-image` 路由在调试台填 OpenAI 生图 JSON（模板为 `1024x1024`），调试台按同样规则转成 generateContent 发出，显示 Gemini 原始响应并预览图片。模拟器选 OpenAI 生图入口，经代理服务转换，返回 OpenAI `data[]`。

`size` 换算只在 `1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9` 中选。`gemini-nano-banana-2.1` 另有 `1:4`、`4:1`、`1:8`、`8:1`、`9:21`，需要时在额外字段里写 `generationConfig.imageConfig.aspectRatio`。

## Gemini 自带的 OpenAI 兼容层

这是另一种接法，与 `gemini-image` 适配器无关。导入模板 **Google Gemini (Generative Language API)** 的 `openai.base` 为 `https://generativelanguage.googleapis.com/v1beta/openai`。OpenAI 透传路由可以直接打 Google 的兼容层，由 Google 转换，网关只替换 `model`。

兼容层只认 `prompt`、`model`、`n`、`size`、`response_format`，其它字段会被静默忽略。Gemini 特有能力按兼容层文档的 `extra_body` 传：`aspect_ratio`、`generation_config`、`safety_settings`，以及仅 `gemini-3-pro-image-preview` 支持的 `tools`（Google 搜索接地）。`gemini-nano-banana-2.1` 的官方宽高比比同族多 `1:4`、`4:1`、`1:8`、`8:1`、`9:21`。建议显式传 `response_format=b64_json`。兼容层没有 edits。

兼容层文档的示例型号是 `gemini-2.5-flash-image` 与 `gemini-3-pro-image-preview`。新型号若被兼容层拒识，按 Google 文档调整路由的供应商模型名。计费同样是 `token` 模式。

## 官方来源

核对于 2026-10-08：

- [Gemini API · Image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini API · Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API · OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
