# MiniMax 生图

本文说明 MiniMax 原生 `POST /v1/image_generation`，以及 OpenAI Images 入口如何转到这个端点。协议族、Base 和鉴权与 [MiniMax 音频](./minimax-audio.md) 相同。

## 路由能力

| request protocol | operation | 入口 | 说明 |
| ---------------- | --------- | ---- | ---- |
| `openai` | `images.generations` | `POST /v1/images/generations` | 适配器 `minimax-image`。`size`（如 `1024x1024`）映射到最接近的 `aspect_ratio`，响应改写成 OpenAI `{ data: [{ url }] }` 或 `{ b64_json }` |
| `minimax` | `images.generations` | `POST /v1/minimax/image_generation` | 文生图和带 `subject_reference` 的图生图共用这一端点。返回 MiniMax JSON，不改写成 OpenAI `{data:[{url}]}` |

上游路径：

```text
POST {minimax.base}/image_generation
```

只配置 `minimax.base` 时派生为 `{base}/image_generation`。网关只替换 `model`，加上 Bearer，并应用路由额外请求头。超时 120 秒。请求日志里 `subject_reference[].image_file` 的 data URL 会先脱敏。

适用供应商模型名：`image-01`、`image-01-live`（目录预设 `minimax-image-01`、`minimax-image-01-live`）。目录价人民币 ¥0.025/张，美元 $0.0035/张。`image-01-live` 的国际站刊例未单列，与 `image-01` 使用同一美元单价。转换路由的对外协议是 OpenAI `images.generations`，适配器 `minimax-image`；透传路由两边都是 `minimax` / `images.generations`。`quality` 和 `background` 不转发。`n` 为 1–9。

请求字段沿用官方：`prompt`、`aspect_ratio`、`width` / `height`、`response_format`（`url` 或 `base64`）、`n`（1–9）、`seed`、`prompt_optimizer`、`aigc_watermark`，以及 `image-01-live` 的 `style`、图生图的 `subject_reference`。透传返回 `data.image_urls` 或 `data.image_base64`，`metadata.success_count` 可能是字符串。转换入口把它们改成 OpenAI `data[]`。URL 约 24 小时有效。

## 状态码与计费

上游 HTTP 已是 2xx，但 `base_resp.status_code` 非 0 时，body 原样返回，HTTP 状态按 [MiniMax 音频](./minimax-audio.md#同步语音合成透传) 的同一张表改写。上游本身已是非 2xx 时不改写。

成功张数优先读 `metadata.success_count`，否则数 `data.image_urls` 或 `data.image_base64` 里的非空字符串。`pricing_profile.image_billing_mode` 为 `per_image`。改写后的非 2xx 不计费。

## 调试台与模拟器

调试台直连上游，不计费、不写请求日志。转换路由的编辑器使用 OpenAI 字段，发出去的是 MiniMax 请求；透传路由直接编辑 MiniMax JSON。成功后预览 `data.image_urls` 与 `data.image_base64`（base64 会补上 `data:image/jpeg;base64,`），转换路由的 OpenAI `data[]` 也能预览。模拟器按所选协议打 `POST /v1/images/generations` 或 `POST /v1/minimax/image_generation`。
