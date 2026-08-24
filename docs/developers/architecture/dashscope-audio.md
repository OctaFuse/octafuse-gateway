# DashScope 原生音频接入方案

本文定义 Octafuse Gateway 接入阿里云百炼 DashScope 语音识别（ASR）与语音合成（TTS）的协议边界、路由拓扑和分阶段验收标准。

## 设计原则

1. Provider 的 `OpenAI`、`Anthropic`、`Gemini`、`DashScope` 表示上游协议族，不表示供应商名称。一个阿里云 Provider 可以同时配置 OpenAI 兼容端点与 DashScope 原生端点。
2. Request Surface 表示客户端调用方式，Upstream Target 表示实际上游协议。跨协议调用必须选择显式 adapter，不能由 `passthrough` 隐式猜测。
3. HTTP、SSE 与 WebSocket 的生命周期不同，使用不同 operation 和驱动，不通过修改 URL 假装兼容。
4. 热词、声音复刻和声音设计是 Provider 级资源，不是普通模型推理路由。
5. 上游没有返回真实用量时不估算最终费用；预算预检可以使用明确标记的保守估算。

## 路由能力

### 客户端 Request Surface

| request protocol | operation                                         | 入口                            | 说明                                             |
| ---------------- | ------------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| `openai`         | `audio.transcriptions`                            | `POST /v1/audio/transcriptions` | 文件 ASR，保留现有 OpenAI multipart 契约；异步 filetrans 另填公网 `file_url` |
| `openai`         | `audio.speech`                                    | `POST /v1/audio/speech`         | 一次性或 HTTP 流式 TTS                           |
| `dashscope`      | `audio.transcriptions.multimodal`                 | `POST /v1/dashscope/services/aigc/multimodal-generation/generation` | DashScope 同步 ASR HTTP 透传，返回原生 JSON |
| `dashscope`      | `audio.transcriptions.realtime.inference/session` | `GET /v1/dashscope/realtime`    | DashScope 原生实时 ASR；客户端事件保持原协议     |
| `dashscope`      | `audio.speech.realtime.inference`                 | `GET /v1/dashscope/realtime`    | Qwen-Audio-TTS/CosyVoice 原生实时增量 TTS；客户端事件保持原协议 |

### DashScope Upstream Target

| upstream operation                        | transport              | 适用协议                                                                  |
| ----------------------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `audio.transcriptions.multimodal`         | HTTP                   | Qwen3-ASR、Qwen-Audio-3.0 或 Fun-ASR 非实时文件 ASR（同端点、不同请求与响应契约） |
| `audio.transcriptions.async`              | HTTP submit/query      | Fun-ASR、Qwen filetrans、Paraformer 异步文件 ASR                          |
| `audio.transcriptions.realtime.inference` | WebSocket `/inference` | Fun-ASR、Paraformer 的 task 事件协议                                      |
| `audio.transcriptions.realtime.session`   | WebSocket `/realtime`  | Qwen-ASR-Realtime 的 session 事件协议                                     |
| `audio.speech`                            | HTTP                   | SpeechSynthesizer 非流式 TTS                                              |
| `audio.speech.stream`                     | HTTP SSE               | SpeechSynthesizer 流式 TTS                                                |
| `audio.speech.multimodal`                 | HTTP/SSE               | Qwen-TTS、MiniMax 多模态生成接口                                          |
| `audio.speech.realtime.inference`         | WebSocket `/inference` | Qwen-Audio-TTS、CosyVoice、Sambert task 事件协议                          |
| `audio.speech.realtime.session`           | —                     | 当前范围不支持 Qwen-TTS-Realtime session 模式                            |

## Adapter

Adapter 是 route target 的必选、可校验能力，不使用字符串兜底：

| adapter                    | request → upstream                                                   |
| -------------------------- | -------------------------------------------------------------------- |
| `passthrough`              | 同协议、同 operation                                                 |
| `dashscope-asr-qwen-file`  | OpenAI multipart ASR → Base64 Data URL → Qwen3-ASR（`content.audio` + `asr_options`） |
| `dashscope-asr-qwen-audio-file` | OpenAI multipart ASR → Qwen-Audio-3.0（`input_audio` + 必填 `format` / `language_hints`；响应 `output.text`、`usage.duration`） |
| `dashscope-asr-fun-file`   | OpenAI multipart ASR → Base64 Data URL → Fun-ASR-Realtime 非实时 ASR |
| `dashscope-asr-file-async` | OpenAI `audio.transcriptions` + 公网 `file_url` → DashScope 异步 submit/poll |
| `passthrough`              | DashScope 原生实时 ASR 事件 → DashScope 同名 task/session WebSocket  |
| `dashscope-tts-speech`     | OpenAI speech → DashScope SpeechSynthesizer                          |
| `dashscope-tts-qwen`       | OpenAI speech → DashScope Qwen-TTS 多模态 TTS                        |
| `dashscope-tts-minimax`    | OpenAI speech → DashScope MiniMax 多模态 TTS                         |
| `passthrough`              | DashScope 原生实时 TTS 事件 → DashScope 同名 task/session WebSocket  |

## Provider 端点

`providers.endpoints.dashscope` 保存明确的 HTTP/WSS 端点。Admin 可根据地域与 Workspace ID 生成官方地址，但运行时只读取已保存地址，不自动猜地域或替换域名。

需要覆盖的 capability：

- 文件识别提交与任务查询
- SpeechSynthesizer
- 多模态生成
- `/inference` WebSocket
- `/realtime` WebSocket
- 热词管理
- 音色复刻/设计管理

API Key 继续使用现有 Provider key 存储；Workspace ID 不是密钥，可以保存在端点配置中或直接固化到业务空间专属域名。

默认中国大陆 HTTP base 为 `https://dashscope.aliyuncs.com/api/v1`。只配置 base 时，网关会派生对应的 HTTP 与 `wss://dashscope.aliyuncs.com/api-ws/v1/{inference|realtime}` 地址；使用国际站、专属业务空间或代理时，应在 Provider 中填写实际 base 或逐项覆盖完整端点。

## 配置顺序

1. 新建或编辑供应商账号，启用 `DashScope` 协议，填写 API Key 和 DashScope base；需要专用地址时再展开端点覆盖。
2. 新建网关模型。`Model ID` 是客户端使用的公开名称；模型分类选择 `Audio`，再选择 `Speech to text` 或 `Text to speech`。
3. 在路由中创建对应 Request Surface 和 Target。`Provider model` 必须填写 DashScope 的真实模型名，它与网关 `Model ID` 是两个独立字段。
4. HTTP 文件 ASR 按模型接口选择 adapter：Qwen3 用 `dashscope-asr-qwen-file`，Qwen-Audio-3.0 flash 用 `dashscope-asr-qwen-audio-file`，Fun-ASR 用 `dashscope-asr-fun-file`，filetrans 用 `dashscope-asr-file-async`。Admin 路由弹窗提供 ASR 快捷预设。不要把 Audio 3.0 接到 Qwen3 adapter。
5. 同步 HTTP 透传：request/upstream 都选 `dashscope` + `audio.transcriptions.multimodal`，adapter 选 `passthrough`。原生实时 ASR/TTS 仍走 `/v1/dashscope/realtime`。HTTP TTS 按模型接口选择 `dashscope-tts-speech`、`dashscope-tts-qwen` 或 `dashscope-tts-minimax`。

这里不根据模型名前缀自动猜 adapter。选错接口族时应直接暴露 DashScope 的错误，避免把配置错误伪装成故障转移。

## 文件与流式数据

- 同步文件 ASR 可以直接发送上游支持的请求体。
- 异步文件 ASR 只接受客户端提供的公网 `file_url`（HTTP(S) 或 OSS）。网关不代为上传文件，也不依赖 R2；缺少 `file_url` 时该 adapter 明确报错，不回退成同步请求。
- TTS 音频和 ASR 大文件不得无界缓冲。HTTP/SSE 音频块使用 `ReadableStream` 转换并向客户端持续写出。
- WebSocket 使用 `fetch(..., { headers: { Upgrade: 'websocket', Authorization: ... } })` 建立带鉴权头的上游连接；下游由 `WebSocketPair` 接入。二进制消息在 `accept()` 前固定为 `arraybuffer`。

实时入口格式如下：

```text
wss://<gateway>/v1/dashscope/realtime?model=<gateway-model>&operation=<operation>
Authorization: Bearer <gateway-api-key>
```

当前调试台（Playground）与模拟器（Simulator）支持以下项：

- OpenAI `audio.transcriptions` 转换：Qwen-Audio-3.0 flash / Qwen3 / Fun-ASR 同步，以及 filetrans 异步（`file_url`）
- DashScope `audio.transcriptions.multimodal` HTTP 透传
- `audio.transcriptions.realtime.inference`
- `audio.transcriptions.realtime.session`
- `audio.speech.realtime.inference`

TTS 不支持 `audio.speech.realtime.session`（Qwen-TTS-Realtime 会话模式不在本期范围内）。

客户端发送 DashScope 官方 `run-task` 或 `session.update` 事件。网关只把启动帧中的模型替换为路由配置的 Provider model，并转发后续文本、二进制帧和服务端事件。Cloudflare Worker 使用 `WebSocketPair`，Node Proxy runtime 使用 `ws` 的 HTTP upgrade 适配器；两条路径共用路由、鉴权、初始连接 failover、事件转发和用量记录逻辑。

## 热词与音色资源

热词和音色属于供应商账号，不参与模型路由和故障转移。仅管理员会话可以调用以下接口；请求体与响应均保持 DashScope 官方格式：

```text
POST /api/admin/providers/:providerId/dashscope/hotwords
POST /api/admin/providers/:providerId/dashscope/voices
```

- 热词端点转发到 ASR customization API，可使用官方的 create/list/query/update/delete vocabulary action。
- Qwen/CosyVoice 音色操作转发到 TTS customization API。
- MiniMax 音色请求的 `model` 以 `minimax/` 开头时，转发到 multimodal-generation API。

这些接口使用所选 Provider 保存的 DashScope Key，不接受客户端直接传入供应商密钥。

## 本地配置

同步 ASR、TTS、资源管理和异步文件 ASR 都无需额外存储。异步文件 ASR 请求必须携带 DashScope 可访问的公开 `file_url`。

数据库还需要应用 `0022_request_log_audio_characters.sql`，用于记录 TTS 的真实字符数。

## 计费与日志

| 能力       | 上游真实用量       | billing kind                 |
| ---------- | ------------------ | ---------------------------- |
| ASR 按时长 | 音频秒数           | `audio_per_second`           |
| ASR token  | input/output token | `audio_tokens`               |
| TTS        | `usage.characters` | `audio_characters`           |
| 音色创建   | `usage.count`      | 单独的 Provider 资源操作记录 |

请求日志增加 TTS 字符数，保留上游 request ID、协议、operation、adapter 和最终路由目标。日志不保存音频二进制；文本请求遵循现有 request-body 日志策略。

## 分阶段验收

1. **协议底座**：Provider endpoint、operation、adapter 和按字符计费均有单元测试；现有 OpenAI/Anthropic/Gemini 测试不回归。
2. **HTTP ASR**：用 mock fetch 验证请求映射、同步响应、异步 submit/query、失败状态和真实 usage。
3. **HTTP TTS**：验证 SpeechSynthesizer 与多模态两种请求体、非流式音频、SSE 分片顺序、字符计费。
4. **WebSocket**：分别验证 `/inference` 与 `/realtime` 的握手鉴权、事件转换、二进制转发、正常关闭和上游错误。
5. **Provider 资源**：验证热词与音色的 create/list/query/delete，不把资源操作加入模型故障转移。
6. **Admin/Simulator**：可以配置 DashScope 端点和 adapter；文件 ASR、TTS、实时连接分别可测试。
7. **全量回归**：运行 Core、Proxy、Admin 全部单元测试和构建，再交由人工使用真实 DashScope Key 验收。

## 人工验收清单

1. **flash 转换**：路由快捷预设选 Qwen-Audio-3.0 flash（OpenAI 转换）。调试台（Playground）与模拟器（Simulator）上传短 wav/webm，确认转写文本和 `usage.duration`，Request Logs 记 `audio_per_second`。
2. **flash 透传**：同一模型另建 DashScope HTTP 请求入口（Request Surface）。调试台与模拟器打官方 `input_audio` JSON，确认原生 `output.text` 与 `usage.duration`。
3. **filetrans**：OpenAI transcriptions + 公网 `file_url`（不要传本地 blob）。调试台 submit/poll 后应看到转写文本与时长。
4. 选择 TTS 模型、填写 `input`、`voice` 和 `response_format`，确认页面可以试听和下载，Request Logs 记录字符数。
5. 分别用 `/inference` 与 `/realtime` operation 建立原生 WebSocket，确认启动事件中的公开模型名被替换为 Provider model，二进制可双向传输，终态事件后日志成功落库。
6. 用管理员资源接口各执行一次 list/query；只有确实需要创建资源时再验证 create/delete，避免产生无用的供应商资源。
7. 千问 Token Plan 预设显式配置 `audio.transcriptions.multimodal`（`qwen-audio-3.0-asr-flash` 同步 HTTP），不含 filetrans 异步端点，也不写 `dashscope.base`（避免派生热词 / 异步转写地址）。按量百炼 CN/Intl 使用 `dashscope.base` 即可派生 multimodal 与异步端点。
