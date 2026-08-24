# DashScope 原生生图接入方案

本文定义 Octafuse Gateway 接入阿里云百炼 DashScope 图像生成的协议边界、路由拓扑和验收要点。客户端入口与计费见 [文生图模型](../reference/image-models.md)。

## 设计原则

1. 供应商（Provider）的 `OpenAI` 与 `DashScope` 表示上游协议族，不表示供应商名称。一个阿里云供应商可以同时配置 OpenAI 兼容 Chat 与 DashScope 原生生图。
2. 请求入口（Request Surface）表示客户端调用方式，上游目标（Upstream Target）表示实际上游协议。跨协议调用必须选择显式适配器，不能由 `passthrough` 隐式猜测。
3. 千问图像 3.0 与万相 2.7 **都不支持** OpenAI 兼容（compatible-mode）Images。客户端仍打 `POST /v1/images/generations`，由转换适配器改写成 DashScope 同步多模态生成。
4. `images.generations.multimodal` 与 OpenAI 的 `images.generations` 不是同一 capability。后者走 OpenAI 兼容路径派生，不能用来保存 DashScope 原生 URL。
5. 异步 `image-generation/generation` 不在本范围；该 capability 名留给未来异步任务。

## 路由能力

### 客户端请求入口

| request protocol | operation | 入口 | 说明 |
| ---------------- | --------- | ---- | ---- |
| `openai` | `images.generations` | `POST /v1/images/generations` | 文生图与 JSON `image` 图生图；与 Seedream 约定一致 |

本阶段不做 `POST /v1/images/edits`。

### DashScope 上游目标

| upstream operation | transport | 适用模型 |
| ------------------ | --------- | -------- |
| `images.generations.multimodal` | HTTP | `qwen-image-3.0`、`qwen-image-3.0-pro`、`wan2.7-image`、`wan2.7-image-pro` |

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

万相官方默认 `n=4`。驱动永远显式写入 `parameters.n`，缺省为 1，避免一次出 4 张并按 4 张扣费。

## 供应商端点

`providers.endpoints.dashscope` 保存 DashScope HTTP / WSS 端点。只配置 `dashscope.base` 时，网关会派生 `images.generations.multimodal`。

| 预设 | 是否改动 |
| ---- | -------- |
| 百炼标准版 / 国际版 | 已有 `dashscope.base`，自动派生，无需改 |
| 千问 Token Plan | 没有 base，须显式覆盖 `images.generations.multimodal` |
| Coding Plan | chat-only，不加生图 |

业务空间专属域名（`{WorkspaceId}.cn-beijing.maas.aliyuncs.com`）不做成预设。文档写明现有域名仍可用；运维可自行把 `dashscope.base` 换成专属主机。

## 配置顺序

1. 新建或编辑供应商账号，启用 DashScope 协议并填写 API Key。按量百炼填写 `dashscope.base`；Token Plan 使用导入预设中的逐项覆盖。
2. 在模型（Models）中导入 `aliyun-image.json` 四个型号。
3. 在路由（Routes）中选择图像模型。请求协议保持 `openai` / `images.generations`。适配器选千问或万相转换项。
4. `Provider model` 必须填写百炼真实模型名，它与网关 `Model ID` 是两个独立字段。
5. 调试台（Playground）选该 DashScope 转换路由，编辑 OpenAI Images JSON 后 Send；调试台会改写成 multimodal-generation。不支持 edits。

## 计费

四个模型都是 `per_image`。成功张数取返回的有效图片数；千问参考图沿用 JSON `image` 计数。

千问 Pro 的 `by_size`（1K ¥0.25 / 2K ¥0.50）无法从请求 `size` 推断。驱动从响应 `usage.output_image_type` 反推 `1k` / `2k`，回退用 `output_width × output_height > 2_250_000`。路由层用该档覆盖 `recordImageUsage` 的 `billing.size`。万相一口价，不覆盖 size。

默认返回 `data[].url`。客户端显式传 `response_format=b64_json` 时，代理服务下载 OSS 链接并转 base64；单图与总量设上限，失败降级回 `url` 并记日志。

## 验收

1. 导入百炼供应商 + `aliyun-image.json` 四个模型。
2. 建路由：请求 `openai/images.generations`，上游 `dashscope/images.generations.multimodal`，适配器选对应族。
3. 模拟器（Simulator）选该模型 → `POST /v1/images/generations` 出图（走 Proxy）。调试台只验证上游，不能代替这条路径。
4. `curl /v1/images/generations` 出图，确认返回 `data[].url`。
5. 请求日志（Request Logs）核对 `pricing_audit.kind=image_per_image`、`output_image_count` 与实际张数一致。
6. `qwen-image-3.0-pro` 传 `size=2048*2048`，确认 `pricing_audit.size=2k` 且 `output_unit_price=0.5`（CNY）。
7. `wan2.7-image` 不传 `n`，确认上游只出 1 张、只扣 1 张。
8. 传 `response_format=b64_json`，确认返回 `data[].b64_json`。
