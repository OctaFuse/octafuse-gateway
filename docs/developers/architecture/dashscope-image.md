# DashScope 原生生图接入方案

本文定义 Octafuse Gateway 接入阿里云百炼 DashScope 图像生成的协议边界、路由拓扑和验收要点。客户端入口与计费见 [文生图模型](../reference/image-models.md)。

## 设计原则

1. 供应商（Provider）的 `OpenAI` 与 `DashScope` 表示上游协议族，不表示供应商名称。一个阿里云供应商可以同时配置 OpenAI 兼容 Chat 与 DashScope 原生生图。
2. 请求入口（Request Surface）表示客户端调用方式，上游目标（Upstream Target）表示实际上游协议。跨协议调用必须选择显式适配器，不能由 `passthrough` 隐式猜测。
3. 万相 2.7 没有 OpenAI 兼容（compatible-mode）Images。千问图像 3.0 与 2.1 Pro 的 OpenAI 兼容生图只开在业务空间专属域名（`https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`），共享域名 `dashscope.aliyuncs.com` 上没有。网关默认让 OpenAI 客户端打 `POST /v1/images/generations`，由转换适配器改写成 DashScope 同步多模态生成；原生客户端走 `dashscope` + `images.generations.multimodal` 透传。
4. `images.generations.multimodal` 与 OpenAI 的 `images.generations` 不是同一 capability。后者走 OpenAI 兼容路径派生，不能用来保存 DashScope 原生 URL。
5. 异步 `image-generation/generation` 不在本范围；该 capability 名留给未来异步任务。

## 路由能力

### 客户端请求入口

| request protocol | operation | 入口 | 说明 |
| ---------------- | --------- | ---- | ---- |
| `openai` | `images.generations` | `POST /v1/images/generations` | 文生图与 JSON `image` 图生图；与 Seedream 约定一致 |
| `dashscope` | `images.generations.multimodal` | `POST /v1/dashscope/services/aigc/multimodal-generation/generation` | 原生生图透传。返回 DashScope JSON，不下载图片、不改写成 OpenAI `{data:[{url}]}` |

本阶段不做 `POST /v1/images/edits`。生图透传按返回里的图片张数计费，不从模型名猜测尺寸档。

### DashScope 上游目标

| upstream operation | transport | 适用模型 |
| ------------------ | --------- | -------- |
| `images.generations.multimodal` | HTTP | `qwen-image-3.0`、`qwen-image-3.0-pro`、`qwen-image-2.1-pro`、`wan2.7-image`、`wan2.7-image-pro` |

上游路径：

```text
POST {dashscope.base}/services/aigc/multimodal-generation/generation
```

请求体：`input.messages[0].content[]` 中 `{ text }` 为提示词，可选前置 `{ image }`（URL 或 data URL）。响应只返回 OSS 链接（约 24 小时过期），没有原生 base64。

## 适配器

| adapter | request → upstream | `n` 上限 | 备注 |
| ------- | ------------------ | -------- | ---- |
| `dashscope-image-qwen` | OpenAI Images → DashScope multimodal | 1–6 | `size` 只接受像素串；`1024x1024` 会改写成 `1024*1024`；拒收 `1K`/`2K`/`4K` |
| `dashscope-image-wan` | 同上 | 1–4 | 同样改写 `WxH`；另允许 `1K`/`2K`/`4K` |

驱动永远显式写入 `parameters.n`，缺省为 1，不依赖上游默认值，避免按意外的张数扣费。

转换入口未单独映射的官方参数，按 DashScope 结构放在 `parameters` 里（OpenAI SDK 用 `extra_body`）。网关深度合并后发往上游。`model` 和 `parameters.n` 由网关保留。路由 `custom_params` 里的扁平参数名（如 `seed`、`negative_prompt`）仍会先写入 `parameters`，便于旧配置继续生效；新配置优先写嵌套的 `parameters`。

```python
client.images.generate(
    model="wan2.7-image",
    prompt="a red apple on a white background",
    size="1024x1024",
    extra_body={"parameters": {"negative_prompt": "blurry", "seed": 42, "prompt_extend": False}},
)
```

## 参数规则

| 型号 | `size` | `n` | 参考图 |
| ---- | ------ | --- | ------ |
| `qwen-image-3.0`、`qwen-image-3.0-pro` | `宽*高` 或 `auto`，总像素 512×512 到 2048×2048，宽高比 1:8 到 8:1。没有档位写法 | 1–6 | 1–3 张 |
| `qwen-image-2.1-pro` | 同上 | 1–6 | 1–10 张 |
| `wan2.7-image-pro` | `1K` / `2K`（默认）/ `4K`，或 `宽*高`。4K 与 4096×4096 以内的像素串只用于文生图且不开组图；其它场景最高 2K | 不开组图 1–4；开组图（`enable_sequential`）时为最多张数 1–12 | 支持 |
| `wan2.7-image` | `1K` / `2K`（默认），或 `宽*高`，总像素 768×768 到 2048×2048，宽高比 1:8 到 8:1 | 同上 | 支持 |

网关处理：

- 两个适配器都把 OpenAI 的 `1024x1024` 改写成 `1024*1024`。千问适配器拒收 `1K` / `2K` / `4K`，万相适配器原样转发档位。
- 转换入口的 `n` 上限：千问 6，万相 4。万相开组图时 `n` 是最大张数（官方 1–12），转换入口仍限 4；要更多张请走原生透传。
- `quality`、`background` 不转发。其它官方参数的写法见上文“适配器”一节。

## 供应商端点

`providers.endpoints.dashscope` 保存 DashScope HTTP / WSS 端点。只配置 `dashscope.base` 时，网关会派生 `images.generations.multimodal`。

| 预设 | 是否改动 |
| ---- | -------- |
| 百炼标准版 / 国际版 | 已有 `dashscope.base`，自动派生，无需改 |
| 千问 Token Plan | 没有 base，须显式覆盖 `images.generations.multimodal` |
| Coding Plan | chat-only，不加生图 |

业务空间专属域名（`{WorkspaceId}.cn-beijing.maas.aliyuncs.com`）不做成预设。现有共享域名仍可用；运维可自行把 `dashscope.base` 换成专属主机。

千问也可以在专属域名上走 OpenAI 透传：供应商的 `openai.base` 填 `https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`，路由用 `openai` 透传。这条路径不推荐用于 `qwen-image-3.0-pro`：透传不会从响应反推 1K / 2K 档，`宽x高` 查不到 `by_size`，2K 会按默认价（1K 档）计费。官方还会忽略 `response_format=b64_json`，始终返回 URL。

## 配置顺序

1. 新建或编辑供应商账号，启用 DashScope 协议并填写 API Key。按量百炼填写 `dashscope.base`；Token Plan 使用导入预设中的逐项覆盖。
2. 在模型（Models）中导入 `aliyun-image.json` 的五个型号。
3. 在路由（Routes）中选择图像模型。请求协议保持 `openai` / `images.generations`。适配器选千问或万相转换项。
4. `Provider model` 必须填写百炼真实模型名，它与网关 `Model ID` 是两个独立字段。
5. 调试台（Playground）选该 DashScope 转换路由，编辑 OpenAI Images JSON 后 Send；调试台会改写成 multimodal-generation。不支持 edits。

## 计费

五个模型都是 `per_image`。成功张数取返回的有效图片数；千问参考图沿用 JSON `image` 计数。

千问 3.0 Pro 的 `by_size`（1K ¥0.25 / 2K ¥0.50）无法从请求 `size` 推断。驱动从响应 `usage.output_image_type` 反推 `1k` / `2k`，回退用 `output_width × output_height > 2_250_000`。路由层用该档覆盖 `recordImageUsage` 的 `billing.size`。万相一口价，不覆盖 size。

默认返回 `data[].url`。客户端显式传 `response_format=b64_json` 时，代理服务下载 OSS 链接并转 base64；单图与总量设上限，失败降级回 `url` 并记日志。

## 验收

1. 导入百炼供应商与 `aliyun-image.json` 的五个模型。
2. 建路由：请求 `openai/images.generations`，上游 `dashscope/images.generations.multimodal`，适配器选对应族。
3. 模拟器（Simulator）选该模型 → `POST /v1/images/generations` 出图（走 Proxy）。调试台只验证上游，不能代替这条路径。
4. `curl /v1/images/generations` 出图，确认返回 `data[].url`。
5. 请求日志（Request Logs）核对 `pricing_audit.kind=image_per_image`、`output_image_count` 与实际张数一致。
6. `qwen-image-3.0-pro` 传 `size=2048*2048`，确认 `pricing_audit.size=2k` 且 `output_unit_price=0.5`（CNY）。
7. `wan2.7-image` 不传 `n`，确认上游只出 1 张、只扣 1 张。
8. 传 `response_format=b64_json`，确认返回 `data[].b64_json`。

## 官方来源

核对于 2026-10-07：

- [千问图像生成与编辑 API 参考](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
- [qwen-image-2.1-pro 模型信息](https://help.aliyun.com/zh/model-studio/qwen-image-2-1-pro)
- [万相图像生成与编辑 2.7 API 参考](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)
