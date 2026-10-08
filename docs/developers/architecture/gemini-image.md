# Gemini 原生生图

Gemini 官方图片模型与大语言模型共用 `POST /v1beta/models/{model}:{generateContent|streamGenerateContent}`。图片模型走专用透传驱动，按 `usageMetadata` 的 TEXT / IMAGE 分项计费。目录价见 [文生图模型](../reference/image-models.md)。OpenAI Images 兼容层仍可指向 Gemini 的 OpenAI base，见文末。

不做 Interactions API（`/v1beta/interactions`）。调用方可以直接用 Google SDK 打现有 Gemini 入口。

## 两种入口

| 客户端路径 | 请求协议 / 能力 | 上游 | 适配器 | 说明 |
| ---------- | --------------- | ---- | ------ | ---- |
| `POST /v1beta/models/{model}:generateContent` | `gemini` / `models.generate` | 同左 | `passthrough`（图片描述符 `passthrough:gemini:models.generate:image`） | 非流式 JSON |
| `POST /v1beta/models/{model}:streamGenerateContent` | 同上 | 同左 | 同上 | SSE；`alt=sse` 由网关按 wire action 补上 |

路径里的模型段仍交给 `resolveModelRouting`。目录模型的输出模态含 `image` 时，这条路径改走生图驱动，不再进入文本 Gemini 管线。文本模型行为不变。

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

预检按 `imageSize` 取现有型号的图片输出 token 上界（核对于 2026-10-08 [Gemini 价目](https://ai.google.dev/gemini-api/docs/pricing)）：512 为 747，1K 为 1290，2K 为 1680，4K 为 3780，另加 2000 文本输出余量。最终按响应 usage 实扣。

没有非 thought 图片、客户端取消、网关超时都是零费用。请求日志的 `pricing_audit.kind` 为 `image_tokens`，分项含图片输出与文本输出。

Google 未公布人民币刊例，CNY 目录价按 USD × 7 占位。

## 调试台与模拟器

调试台直连上游，只用 `generateContent`，不计费、不写请求日志。编辑器模板已带 `responseModalities` 与 `imageConfig`（`1:1` / `1K`）。成功后把非 thought 的 `inlineData` 转成 data URL 预览，并带出文本 part。

模拟器打代理服务的 `POST /v1beta/models/{model}:generateContent`，会写请求日志。图片模型下 Gemini 入口固定非流式。

## OpenAI 兼容层

导入模板 **Google Gemini (Generative Language API)** 的 `openai.base` 为 `https://generativelanguage.googleapis.com/v1beta/openai`。客户端仍可走 `POST /v1/images/generations`，上游是 Gemini 的 OpenAI 兼容层，不是本文的原生入口。

兼容层只认 `prompt`、`model`、`n`、`size`、`response_format`，其它字段会被静默忽略。Gemini 特有能力按兼容层文档的 `extra_body` 传：`aspect_ratio`、`generation_config`、`safety_settings`，以及仅 `gemini-3-pro-image-preview` 支持的 `tools`（Google 搜索接地）。`gemini-nano-banana-2.1` 的官方宽高比比同族多 `1:4`、`4:1`、`1:8`、`8:1`、`9:21`。建议显式传 `response_format=b64_json`。兼容层没有 edits。

兼容层文档的示例型号是 `gemini-2.5-flash-image` 与 `gemini-3-pro-image-preview`。新型号若被兼容层拒识，按 Google 文档调整路由的供应商模型名。计费同样是 `token` 模式。

## 官方来源

核对于 2026-10-08：

- [Gemini API · Image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini API · Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API · OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
