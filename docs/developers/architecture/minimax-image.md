# MiniMax 生图

本文说明 MiniMax 原生 `POST /v1/image_generation`，以及 OpenAI Images 入口如何转到这个端点。协议族、Base 和鉴权与 [MiniMax 音频](./minimax-audio.md) 相同。

## 路由能力

| request protocol | operation | 入口 | 说明 |
| ---------------- | --------- | ---- | ---- |
| `openai` | `images.generations` | `POST /v1/images/generations` | 适配器 `minimax-image`。不转发 `size`；`aspect_ratio`、`width`、`height` 有值才原样转发。响应改写成 OpenAI `{ data: [{ url }] }` 或 `{ b64_json }` |
| `minimax` | `images.generations` | `POST /minimax/v1/image_generation` | 文生图和带 `subject_reference` 的图生图共用这一端点。返回 MiniMax JSON，不改写成 OpenAI `{data:[{url}]}` |

上游路径：

```text
POST {minimax.base}/image_generation
```

只配置 `minimax.base` 时派生为 `{base}/image_generation`。网关只替换 `model`，加上 Bearer，并应用路由额外请求头。超时 120 秒。请求日志里 `subject_reference[].image_file` 的 data URL 会先脱敏。

适用供应商模型名：`image-01`、`image-01-live`（目录预设 `minimax-image-01`、`minimax-image-01-live`）。目录价见 [文生图模型 · 目录总览](../reference/image-models.md#目录总览)；`image-01-live` 的国际站刊例未单列，与 `image-01` 使用同一美元单价。转换路由的对外协议是 OpenAI `images.generations`，适配器 `minimax-image`；透传路由两边都是 `minimax` / `images.generations`。`size`、`quality` 和 `background` 不转发。`n` 为 1–9。

请求字段沿用官方：`prompt`、`aspect_ratio`、`width` / `height`、`response_format`（`url` 或 `base64`）、`n`（1–9）、`seed`、`prompt_optimizer`、`aigc_watermark`，以及 `image-01-live` 的 `style`、图生图的 `subject_reference`。透传返回 `data.image_urls` 或 `data.image_base64`，`metadata.success_count` 可能是字符串。转换入口把它们改成 OpenAI `data[]`。URL 约 24 小时有效。

转换入口未单独映射的官方字段，按 MiniMax 结构写在请求体顶层（OpenAI SDK 用 `extra_body`）。网关深度合并后发往上游。`model`、`n` 和映射后的 `response_format` 由网关保留。

```python
client.images.generate(
    model="image-01",
    prompt="A red paper lantern over a quiet canal at dusk",
    extra_body={"aspect_ratio": "1:1", "prompt_optimizer": True, "aigc_watermark": False, "seed": 42},
)
```

## 参数规则

| 字段 | 官方规则 | `minimax-image` |
| ---- | -------- | --------------- |
| `aspect_ratio` | `1:1`（默认，1024×1024）、`16:9`、`4:3`、`3:2`、`2:3`、`3:4`、`9:16`，`21:9` 仅 `image-01` | 有值才原样转发，不校验、不填默认值 |
| `size` | 官方没有此字段 | 不转发 |
| `width` / `height` | 仅 `image-01`，需同时设置，512–2048 且为 8 的倍数；与 `aspect_ratio` 同时出现时官方优先用比例 | 有值才原样转发 |
| `n` | 1–9 | 1–9 |
| `response_format` | `url`（默认）/ `base64` | OpenAI 的 `b64_json` 映射为 `base64` |
| `quality`、`background` | 无 | 不转发 |

## 状态码与计费

上游 HTTP 已是 2xx，但 `base_resp.status_code` 非 0 时，body 原样返回，HTTP 状态按 [MiniMax 音频](./minimax-audio.md#同步语音合成透传) 的同一张表改写。上游本身已是非 2xx 时不改写。

成功张数优先读 `metadata.success_count`，否则数 `data.image_urls` 或 `data.image_base64` 里的非空字符串。`pricing_profile.image_billing_mode` 为 `per_image`。改写后的非 2xx 不计费。

## 调试台与模拟器

调试台直连上游，不计费、不写请求日志。转换路由的编辑器使用 OpenAI 字段，发出去的是 MiniMax 请求；透传路由直接编辑 MiniMax JSON。成功后预览 `data.image_urls` 与 `data.image_base64`（base64 会补上 `data:image/jpeg;base64,`），转换路由的 OpenAI `data[]` 也能预览。模拟器按所选协议打 `POST /v1/images/generations` 或 `POST /minimax/v1/image_generation`。

## H3 Image 目录预设

`minimax-h3-image` 与 `minimax-h3-image-highspeed`（2026-11-10）只供管理后台（Admin）导入。导入不会创建路由，也不会改已经上线的模型或计费。它们不使用上面的原生 `POST /v1/image_generation`，也不走适配器 `minimax-image`。

客户端入口是 OpenAI Images：文生图 `POST /v1/images/generations`，编辑 `POST /v1/images/edits`。上游是 MiniMax 的 OpenAI 兼容 Images API。国际区 Base URL 为 `https://api.minimax.io/v1`，中国区为 `https://api.minimax.cn/v1`。路由里的上游模型名称分别填写 `MiniMax-H3-Image` 与 `MiniMax-H3-Image-Highspeed`。

`area`、`aspect_ratio`、`disable_prompt_enhanced` 和 `size` 由客户端额外字段传入，不要写成路由默认值。`aspect_ratio` 或 `area` 与 `size=WIDTHxHEIGHT` 同时出现时，上游返回 400。`disable_prompt_enhanced` 为 true，但没有宽高或固定 `aspect_ratio` 时，上游也返回 400。文生图默认开启提示词增强，编辑始终增强。不支持预览图、蒙版编辑和透明背景。输出面积最高 20M 像素，宽高比 1:3–3:1；面积为 1K、2K、4K（默认 4K）或 `WIDTHxHEIGHT`。提示词最长 32K 字符；关闭增强时大约只有前 4K token 生效。

计费是 `token`。国际区刊例（每 1M token）：标准版文本输入 $2.3、图像输入 $1.5、图像输出 $3.8；高速版文本输入 $2.3、图像输入 $3、图像输出 $7.6。中国区官方人民币刊例：标准版 ¥15 / ¥10 / ¥25，高速版 ¥15 / ¥20 / ¥50。这不是美元 ×7。4K 五折是限时活动，没有写入价格字段。

现有 OpenAI Images 透传仍把 `prompt` 限制在 4000 个字符，且 `n` 只能为 1。这低于 MiniMax 官方的 32K 字符上限。本目录更新没有放宽该限制。

## 官方来源

核对于 2026-10-07（image-01）与 2026-11-11（H3 Image 刊例）：

- [MiniMax · 文生图](https://platform.minimaxi.com/docs/api-reference/image-generation-t2i.md)
- [MiniMax · 图生图](https://platform.minimaxi.com/docs/api-reference/image-generation-i2i.md)
- [MiniMax 国际区定价](https://platform.minimax.io/docs/guides/pricing.md)
- [MiniMax 中国区定价](https://platform.minimaxi.com/docs/guides/pricing.md)
