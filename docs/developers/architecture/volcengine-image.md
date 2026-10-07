# 火山方舟 Seedream 生图

本文说明火山方舟（BytePlus ModelArk 结构相同）Seedream 生图的两条客户端入口、供应商端点、参数规则和计费。目录价与通用计费见 [文生图模型](../reference/image-models.md)。

## 型号

目录预设在 `packages/admin/lib/model-presets/bytedance-image.json`：

| 目录 ID | 官方型号 | 说明 |
| ------- | -------- | ---- |
| `doubao-seedream-5-0` | Seedream 5.0 lite | 支持组图 |
| `doubao-seedream-5-0-pro` | Seedream 5.0 pro | 不支持组图，按像素档计价 |
| `doubao-seedream-5-0-flash` | Seedream 5.0 flash | 不支持组图 |

目录 ID 与方舟的供应商模型名一致。控制台用推理接入点时，路由的供应商模型名填 `ep-…`。

## 入口与适配器

| 客户端路径 | 路由 | 行为 |
| ---------- | ---- | ---- |
| `POST /v1/images/generations` | 请求 `openai` / `images.generations`，上游 `volcengine` / `images.generations`，适配器 `volcengine-image` | OpenAI SDK 入口，只返回 JSON。`n=1` 不带组图字段；`n` 为 2–15 时打开组图并把 `max_images` 设为 `n`。5.0 pro / flash 的 `n>1` 直接返回 400 |
| `POST /v1/volcengine/images/generations` | 请求与上游都是 `volcengine` / `images.generations`，适配器 `passthrough` | 原生透传，只替换 `model`。非流式 JSON 与 `stream: true` 的 SSE 原样返回，组图字段和单张失败（`data[].error`）都保留 |

Seedream 没有 OpenAI 形态的 `/images/edits`。图生图和多图融合都走 generations，在 JSON 里传 `image`（URL、data URL 或数组），不要用 multipart `/v1/images/edits`。

已经用 `openai` 透传跑 Seedream 的路由可以继续用。切到新适配器时，给供应商补上 `volcengine.base`，把路由上游协议改成 `volcengine`、上游能力改成 `images.generations`，适配器选 `volcengine-image`。

## 供应商端点

导入模板是 **Volcengine Ark** 与 **BytePlus ModelArk**（`packages/admin/lib/provider-import-presets.json`）。对话继续走 OpenAI 兼容端点；生图只配一个 `volcengine.base`：

```text
openai.chat:       https://ark.cn-beijing.volces.com/api/v3/chat/completions
volcengine.base:   https://ark.cn-beijing.volces.com/api/v3
```

`volcengine.base` 派生 `{base}/images/generations`，也可以显式覆盖 `images.generations`。不要设 `openai.base`：它会派生不存在的 `/images/edits`。BytePlus 的主机是 `https://ark.ap-southeast.bytepluses.com/api/v3`。Coding Plan / Agent Plan 的路径不同，不要与标准 `/api/v3` 混用，否则额度不生效。

## 参数规则

### `size`

官方允许两种写法，不能混用：

- **档位**：只决定分辨率，宽高比由提示词描述（如“16:9 横版海报”）决定。
- **`宽x高`**：直接定死尺寸与比例，总像素和宽高比都有范围限制。

| 型号 | 档位 | `宽x高` 总像素 | 备注 |
| ---- | ---- | -------------- | ---- |
| 5.0 pro / flash | `1K`、`1.5K`、`2K` | 921,600–4,624,220 | 默认 2K |
| 5.0 lite | `2K`、`3K`、`4K` | 3,686,400–16,777,216 | `1024x1024` 会被拒 |
| 4.5 | `2K`、`4K` | 3,686,400–16,777,216 | 不在目录预设里 |
| 4.0 | `1K`、`2K`、`4K` | 921,600–16,777,216 | 不在目录预设里 |

所有型号的宽高比都在 1/16 到 16 之间。两条入口都把 `size` 原样发给方舟；`volcengine-image` 只在 `size=auto` 时省略该字段，交给方舟默认值。所有 Seedream 型号都接受 `2K`，调试台与模拟器的 OpenAI 示例因此使用 `size: 2K`。

### 其它字段

| 字段 | `volcengine-image` | 原生透传 |
| ---- | ------------------ | -------- |
| `n` | 1–15，映射成组图（参考图张数 + 生成张数 ≤ 15）；5.0 pro / flash 只能为 1 | 不使用，组图写 `sequential_image_generation` 与 `sequential_image_generation_options.max_images` |
| `background` | 只转发 `transparent` / `opaque`，`auto` 不转发。官方仅 5.0 pro / flash 支持，且只用于输入 1 张带透明通道的图 | 原样 |
| `output_format` | 只接受 `png` / `jpeg`（`jpg` 视为 `jpeg`），拒收 `webp` | 原样 |
| `quality` | 不转发 | 官方无此字段 |
| `watermark` | 原样转发 boolean。方舟默认 `true`（右下角“AI 生成”） | 原样 |
| `response_format` | 只认 `url` 和 `b64_json` | 原样 |
| `optimize_prompt_options` | 显式传入才转发 | 原样 |
| `sequential_image_generation*` | 由 `n` 决定，客户端不能覆盖 | 原样 |
| `stream` | 不支持，只出 JSON | `stream: true` 原样返回 SSE |

`volcengine-image` 的响应 `data[]` 保留方舟的 `size`、`output_format` 和图层字段，`usage` 原样返回。实现见 `packages/core/src/volcengine-openai.ts` 与 `packages/proxy/src/services/egress/volcengine-openai-driver.ts`。

## 计费

三个型号都是 `per_image`。两条入口都按成功张数计费：原生入口读 `usage.generated_images`，没有 usage 时数带 `url` 或 `b64_json` 的 `data[]`；单张失败不计入。

5.0 pro 按像素分档：`1k` / `1.5k` 为低档，`2k` 为高档，缺省按高档（方舟默认 2K）。客户端传 `宽x高` 时，两条入口都按像素换算档位再查价（`volcengineImageBillingSize`，见 `packages/core/src/volcengine-native.ts`）：不超过 1,638,400 像素为 `1k`，不超过 2,611,200 为 `1.5k`，不超过 4,624,220 为 `2k`，不超过 11,000,000 为 `3k`，更大为 `4k`。官方的首张参考图免费，网关暂按全量计。

## 调用示例

OpenAI 入口（`n` 为 2–15 时按组图发送）：

```bash
curl -sS "$GATEWAY_URL/v1/images/generations" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"doubao-seedream-5-0","prompt":"海边灯塔水彩封面，16:9 横版","size":"2K","n":2,"watermark":false}'
```

图生图（不要打 `/edits`）：

```json
{
  "model": "doubao-seedream-5-0",
  "prompt": "把背景换成黄昏海边",
  "size": "2K",
  "image": "https://example.com/ref.png"
}
```

原生透传（流式和方舟原文字段走这条）：

```bash
curl -sS "$GATEWAY_URL/v1/volcengine/images/generations" \
  -H "Authorization: Bearer $USER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"doubao-seedream-5-0","prompt":"海边灯塔水彩封面","size":"2K","watermark":false,"stream":false}'
```

## 验收

1. 导入火山方舟供应商与 `bytedance-image.json` 三个型号。
2. 分别建 OpenAI 入口路由（适配器 `volcengine-image`）与原生透传路由。
3. 模拟器（Simulator）发 `n=2` 的 5.0 lite 请求，确认返回 2 张、请求日志（Request Logs）的 `output_image_count=2`。
4. 5.0 pro 传 `size=2048x1024`，确认 `pricing_audit.size=1.5k`、按低档计价；传 `n=2` 确认 400 且没有请求上游。
5. 原生入口发 `stream: true`，确认 SSE 原样返回且按 `usage.generated_images` 计费。

逐步细节见 [Admin API · Seedream 验收](../api/admin.md#运维验收国内文生图-seedream-火山方舟)。

## 官方来源

核对于 2026-10-07：

- [火山方舟 · 图片生成 API](https://www.volcengine.com/docs/82379/1541523)
- [BytePlus ModelArk · Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523)
