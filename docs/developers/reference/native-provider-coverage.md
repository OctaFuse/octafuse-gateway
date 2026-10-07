# DashScope、MiniMax 与火山方舟能力覆盖

本文对照阿里云百炼 DashScope、MiniMax，以及火山方舟 / BytePlus ModelArk 官方开放的接口，记录网关当前的透传与协议转换支持情况，以及已知缺口。已支持能力的行为细节见各自的架构文档，本文只回答「有没有、缺什么」。

**核对日期**：2026-10-07。官方接口或网关能力变化后，更新对应行并刷新日期。

**相关文档**：

- [适配器与驱动](../architecture/adapters-and-drivers.md)
- [DashScope 音频](../architecture/dashscope-audio.md)、[DashScope 生图](../architecture/dashscope-image.md)
- [MiniMax 音频](../architecture/minimax-audio.md)、[MiniMax 生图](../architecture/minimax-image.md)
- [火山方舟 Seedream 生图](../architecture/volcengine-image.md)
- [文生图模型](./image-models.md)（入口、目录与计费）
- [供应商导入预设](./provider-import-presets.md)

## 判定口径

- **透传**：请求协议与上游协议相同、operation 相同，适配器为 `passthrough`。以 `packages/core/src/adapters/registry.ts` 的 `PASSTHROUGH_ADAPTERS` 和 `packages/proxy/src/app.ts` 的公开路径为准。
- **协议转换**：客户端调用 OpenAI 入口，由转换适配器改写成上游原生请求。以注册表的 `CONVERSION_ADAPTERS` 和 `packages/proxy/src/services/egress/dispatch-table.ts` 为准。
- **预设**：`packages/admin/lib/provider-import-presets.json`（供应商端点）与 `packages/admin/lib/model-presets/*.json`（模型目录价）。代码支持但预设缺失时，导入后需要手工补端点或模型。

| 标记 | 含义 |
|------|------|
| ✅ | 已支持 |
| ⚠️ | 代码可用，但预设、模型名规则或实现有缺口，见备注 |
| ❌ | 未实现 |
| — | 不适用 |

对话类接口没有跨协议转换适配器。DashScope 与 MiniMax 同时提供 OpenAI 与 Anthropic 协议，直接透传即可，因此对话行的「协议转换」记为 —。火山方舟的对话和 Responses 继续放在供应商的 `openai` 端点里，不在 `volcengine` 协议中重复。

## DashScope

DashScope 原生路径相对 `providers.endpoints.dashscope.base`（如 `https://dashscope.aliyuncs.com/api/v1`）。兼容模式路径相对主机根。

| 能力 | 官方端点 | 透传 | 协议转换 | 备注 |
|------|----------|------|----------|------|
| 对话 | `/compatible-mode/v1/chat/completions` | ✅ | — | |
| Anthropic Messages | `/apps/anthropic/v1/messages` | ✅ | — | |
| Responses | `/compatible-mode/v1/responses` | ⚠️ | — | 百炼国内 / 国际预设只配了 `chat`，需手工补 `responses`；千问 AI 平台预设已有 |
| 原生文本生成 | `services/aigc/text-generation/generation` | ❌ | ❌ | 兼容模式已覆盖，优先级低 |
| 同步 ASR | `services/aigc/multimodal-generation/generation` | ✅ | ✅ | Qwen3 / Qwen-Audio-3.0 / Fun-ASR 三个适配器 |
| 异步文件转写 | `services/audio/asr/transcription` + `tasks/{task_id}` | ✅ | ✅ | 转换只接受公网 `file_url` |
| 实时 ASR | `/api-ws/v1/inference`、`/api-ws/v1/realtime` | ⚠️ | ❌ | 无 OpenAI Realtime 映射；`qwen-audio-3.1-asr-flash-streaming` 不在模型名规则内 |
| 语音合成 SpeechSynthesizer | `services/audio/tts/SpeechSynthesizer` | ✅ | ✅ | 含 SSE |
| 多模态语音合成 | `services/aigc/multimodal-generation/generation` | ✅ | ✅ | Qwen-TTS 与百炼 MiniMax 语音；缺模型预设 |
| 实时语音合成 | `/api-ws/v1/inference`、`/api-ws/v1/realtime` | ⚠️ | ❌ | inference 规则只认 `cosyvoice-*`，Qwen-Audio-3.0-TTS 实时与 Sambert 会被标为未识别 |
| 全模态实时对话 | `/api-ws/v1/realtime` | ❌ | ❌ | `qwen3.8-omni-flash-realtime`、`qwen-audio-3.1-realtime-plus` 没有语音对语音 operation，也没有音频 token 计费 |
| 热词 / 音色复刻与设计 | `services/audio/asr/customization`、`services/audio/tts/customization` | 仅管理后台 | — | `/api/admin/providers/:id/dashscope/*`，不对外 |
| 同步生图 | `services/aigc/multimodal-generation/generation` | ✅ | ✅ | 千问 / 万相两个适配器 |
| 图像编辑入口 | OpenAI `POST /v1/images/edits` | — | ❌ | 图生图只能走 generations + JSON `image` |
| 异步生图 | `image-generation/generation` 等异步任务 | ❌ | ❌ | capability 名已预留 |
| 视频生成 | `video-generation/video-synthesis` + `tasks` | ❌ | ❌ | `wan3.0-video`、`happyhorse-1.1-*`；网关没有视频模态 |
| 向量 | `/compatible-mode/v1/embeddings` 等 | ❌ | ❌ | 网关没有 `/v1/embeddings` |
| 重排序 | text-rerank | ❌ | ❌ | |
| 音乐、3D、世界模型、决策模型 | — | ❌ | ❌ | `fun-music-v1`、Tripo、`happyoyster-*`、`decision-model-preview` |

## MiniMax

MiniMax 原生路径相对 `providers.endpoints.minimax.base`（国内 `https://api.minimaxi.com/v1`，国际 `https://api.minimax.io/v1`）。

| 能力 | 官方端点 | 透传 | 协议转换 | 备注 |
|------|----------|------|----------|------|
| 对话 | `/v1/chat/completions` | ✅ | — | |
| Anthropic Messages | `/anthropic/v1/messages` | ✅ | — | |
| Responses | `/v1/responses` | ⚠️ | — | 预设只配了 `chat`，需手工补 `responses` |
| Token 估算 | `/v1/responses/input_tokens` | ❌ | — | 网关只注册了 `POST /v1/responses` |
| 原生对话 | `/v1/text/chatcompletion_v2` | ❌ | ❌ | M2-her 等，优先级低 |
| 文件转写 | `/v1/speech_to_text` | ⚠️ | ✅ | 见下文「已知缺陷」；网关单文件上限 25MB，上游 50MB；转换不支持流式 |
| 同步语音合成（HTTP） | `/v1/t2a_v2` | ✅ | ✅ | 含 SSE |
| 同步语音合成（WebSocket） | `wss://…/ws/v1/t2a_v2`，含双向流式 | ❌ | ❌ | |
| 异步长文本语音合成 | `/v1/t2a_async_v2` + 查询 | ❌ | ❌ | 依赖文件下载 |
| 音色复刻 / 设计 / 查询 / 删除 | `voice_clone`、`voice_design`、`get_voice`、`delete_voice` | ❌ | — | DashScope 有管理后台资源接口，MiniMax 没有 |
| 生图 | `/v1/image_generation` | ✅ | ✅ | OpenAI edits 入口不转换；`subject_reference` 可作为额外字段传 |
| 视频 V2 | 创建、查询、列表、取消或删除、H3-Context-IR、再生成 | ❌ | ❌ | MiniMax-H3、MiniMax-H3-Max |
| 旧版视频与视频 Agent | 文生 / 图生 / 首尾帧 / 主体参考、查询、下载、模板 | ❌ | ❌ | Hailuo 2.3 / 02 |
| 音乐、歌词、翻唱 | `music_generation` 等 | ❌ | ❌ | 官方自 2026-08-20 起不再面向新用户开放，可暂不做 |
| 文件管理 | 上传、列出、检索、下载、删除 | ❌ | — | 异步语音、音色复刻、视频下载的前置能力 |

## 火山方舟

`volcengine` 是火山方舟与 BytePlus ModelArk 共用的上游协议，只承载方舟原生能力。原生路径相对 `providers.endpoints.volcengine.base`：国内 `https://ark.cn-beijing.volces.com/api/v3`，国际 `https://ark.ap-southeast.bytepluses.com/api/v3`。也可以显式填写 capability URL 覆盖派生结果。

| 能力 | 官方端点 | 透传 | 协议转换 | 备注 |
|------|----------|------|----------|------|
| 对话 | `/chat/completions` | — | — | 用供应商的 `openai` 端点，不进 `volcengine` |
| Responses | `/responses` | — | — | 同上；预设未配 `responses`，需要时手工补 OpenAI capability URL |
| 生图 | `/images/generations` | ✅ | ✅ | 原生透传 `POST /v1/volcengine/images/generations`（含 SSE）。OpenAI 入口用 `volcengine-image`，只出 JSON，`n` 为 1–15 |
| 视频任务 | `/contents/generations/tasks` | ❌ | ❌ | Seedance 等；网关没有视频模态 |
| 豆包语音 | 语音合成 / 识别 | ❌ | ❌ | |

两条生图入口的差别见 [火山方舟 Seedream 生图](../architecture/volcengine-image.md)。

## 已知缺陷

- **MiniMax 文件转写透传会整段缓冲**。官方已支持 `stream=true`（SSE）与原生 `srt` / `vtt`，但 `dispatchMiniMaxAsrPassthrough` 用 `response.text()` 读完再返回。流式结果不会实时下发，也解析不到 `duration`，计费回退为按文件估算。
- **模型名规则没跟上新模型**。规则在 `registry.ts` 顶部的 `*_MODELS` 常量。命中失败时管理后台的路由编辑器会提示「未识别」并列出全部可用适配器，不会阻止保存，但容易选错。

## 缺少的预设

代码已经支持，但导入目录里没有对应条目：

| 类型 | 缺失项 |
|------|--------|
| 供应商端点 | 百炼国内 / 国际与 MiniMax 的 `openai.responses`；MiniMax 国际站（`api.minimax.io`） |
| DashScope 模型 | `qwen3-tts-*` / `qwen-tts*`、`qwen-tts-realtime*`、`MiniMax/speech-2.8-hd`、`paraformer-*`、`qwen-audio-3.1-asr-flash-*`、`qwen-image-edit*` |
| MiniMax 模型 | `MiniMax-M2.5-highspeed`、`MiniMax-M2.1`、`MiniMax-M2.1-highspeed`、`MiniMax-M2`、`MiniMax-M3.1-Flash-Preview`（仅 M Plan）、`speech-2.6-hd` / `speech-2.6-turbo`、`speech-02-hd` / `speech-02-turbo` |

## 官方来源

- MiniMax：[接口概览](https://platform.minimaxi.com/docs/api-reference/api-overview.md)、[文档索引](https://platform.minimaxi.com/docs/llms.txt)
- 百炼：[模型列表](https://help.aliyun.com/zh/model-studio/getting-started/models)、[Responses 兼容](https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api)
- 火山方舟：[图片生成 API](https://docs.volcengine.com/docs/ark/image-generation-api)

## 更新方式

- 新增或修改适配器、供应商预设、模型预设时，同一 PR 更新本文对应行。
- 官方发布新端点或新模型家族时，先在本文登记为 ❌ 或 ⚠️，实现后再改为 ✅。
- 每次整表复核后刷新文首核对日期。
