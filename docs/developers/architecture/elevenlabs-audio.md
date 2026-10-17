# ElevenLabs 音频

`elevenlabs` 是上游协议族，和 OpenAI、Anthropic、Gemini、DashScope、MiniMax 并列，不是供应商名称。原生接口用 `xi-api-key` 请求头鉴权，Base 默认 `https://api.elevenlabs.io/v1`。欧盟数据驻留使用 `https://api.eu.residency.elevenlabs.io/v1`。

客户端有两种接法：

- **原生透传**：`POST /elevenlabs/v1/text-to-speech/{voice_id}`、`POST /elevenlabs/v1/speech-to-text`，以及两条 WebSocket（见下文「WebSocket 透传」），路径和 ElevenLabs 官方 SDK 一致，只需要把 SDK 的 `base_url` 指向 `{gateway}/elevenlabs`。
- **OpenAI 兼容**：`POST /v1/audio/speech` 与 `POST /v1/audio/transcriptions`，由适配器 `elevenlabs-tts`、`elevenlabs-asr-file` 转成上游请求，ElevenLabs 特有字段用 `extra_body`（multipart 用额外表单字段）。

## 当前能力

只配置 Base 时，网关派生下表中的地址。

| 能力 | 派生路径 | 说明 |
|------|----------|------|
| `audio.transcriptions` | `{base}/speech-to-text` | 文件转写（Scribe），multipart |
| `audio.speech` | `{base}/text-to-speech/{voice_id}` | 文本转语音。`voice_id` 是路径参数，每次请求填入；自定义 URL 必须包含 `{voice_id}` 占位符 |
| `audio.speech.realtime` | `wss://…/text-to-speech/{voice_id}/stream-input` | 单路 WebSocket 流式合成。由 HTTP(S) base 换 scheme 得到；自定义 URL 同样必须包含 `{voice_id}` |
| `audio.transcriptions.realtime` | `wss://…/speech-to-text/realtime` | Scribe 实时转写（WebSocket） |

不在范围内：`multi-stream-input`、音色管理、语音转语音、配音、音效、音乐。见 [能力覆盖](../reference/native-provider-coverage.md)。

## 适配器

| 适配器 | 转换 |
|--------|------|
| `passthrough` · `elevenlabs/audio.speech` | 公开 `POST /elevenlabs/v1/text-to-speech/{voice_id}`，另外三个变体见下表。JSON 原样转发，只把 `model_id` 换成供应商模型名 |
| `passthrough` · `elevenlabs/audio.transcriptions` | 公开 `POST /elevenlabs/v1/speech-to-text`，表单原样转发，只把 `model_id` 换成供应商模型名 |
| `elevenlabs-tts` | OpenAI `POST /v1/audio/speech` → ElevenLabs text-to-speech。响应是音频字节或 OpenAI speech SSE |
| `elevenlabs-asr-file` | OpenAI multipart 转写 → ElevenLabs `POST /v1/speech-to-text`。响应改写成 OpenAI 格式 |

文本转语音的四个变体共用 operation `audio.speech`，路由上不另拆：

| 公开路径 | 上游路径 | 响应 |
|----------|----------|------|
| `/elevenlabs/v1/text-to-speech/{voice_id}` | `/text-to-speech/{voice_id}` | 音频字节 |
| `…/{voice_id}/stream` | `/text-to-speech/{voice_id}/stream` | 分块音频字节 |
| `…/{voice_id}/with-timestamps` | `/text-to-speech/{voice_id}/with-timestamps` | JSON，含 `audio_base64` 与对齐信息 |
| `…/{voice_id}/stream/with-timestamps` | `/text-to-speech/{voice_id}/stream/with-timestamps` | NDJSON 流 |

| `passthrough` · `elevenlabs/audio.speech.realtime` | 公开 `GET /elevenlabs/v1/text-to-speech/{voice_id}/stream-input?model_id=`（WebSocket） |
| `passthrough` · `elevenlabs/audio.transcriptions.realtime` | 公开 `GET /elevenlabs/v1/speech-to-text/realtime?model_id=`（WebSocket） |

模型名规则：TTS 供应商模型名匹配 `eleven_*`（排除 `*_sts_*`、`*_ttv_*`、`eleven_text_to_sound_*`、`eleven_music*`）。文件转写 ASR 匹配 `scribe_*`，实时转写匹配 `scribe_*realtime*`；两类互相排除，所以 `scribe_v2_realtime` 只能挂在实时转写路由上。

## 原生透传

请求里 `model_id` 填 **Gateway 模型 ID**（可带 `:route_group` 后缀），转发时换成路由上的供应商模型名。`voice_id` 必须是字母、数字、`_`、`-` 组成的安全字符串，其他值直接 400。`output_format`、`enable_logging`、`optimize_streaming_latency` 等 query 参数原样转发。

```bash
curl -X POST "$GATEWAY/elevenlabs/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128" \
  -H "xi-api-key: $OCTAFUSE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model_id":"elevenlabs-flash-v2.5","text":"Hello from OctaFuse."}' \
  --output out.mp3
```

`/elevenlabs/*` 路径除 `Authorization: Bearer` 外，也接受 `xi-api-key` 头，CORS 已放行。其他路径仍只认 Bearer。

转写透传：`model_id` 必填。上传 `file`，或改传 `cloud_storage_url` / `source_url` 让上游自己拉取。`webhook=true` 是异步模式，网关拿不到结果也无法计费，直接 400。

## OpenAI 兼容

### 文本转语音

| OpenAI 字段 | ElevenLabs |
|-------------|------------|
| `model` | 路径与 body 里的 `model_id`，换成供应商模型名 |
| `input` | `text` |
| `voice` | 路径里的 `voice_id`。必须是 ElevenLabs 音色 ID |
| `response_format` | query `output_format`：`mp3` → `mp3_44100_128`，`opus` → `opus_48000_128`，`pcm` → `pcm_24000`，`wav` → `wav_24000`。`aac`、`flac` 返回 400 |
| `speed` | `voice_settings.speed`，范围 `0.7`–`1.2`，等于 `1` 时不发送，范围外 400 |
| `instructions` | 上游没有对应字段，返回 400 |
| `stream_format=sse` | 请求上游 `/stream`，把音频分块包成 `speech.audio.delta`（base64）并以 `speech.audio.done` 结束 |

`wav` 固定 24 kHz：44.1 kHz 的 PCM / WAV 输出需要 ElevenLabs Pro 及以上套餐。`voice_settings`、`language_code`、`seed` 等官方字段写在请求体顶层（OpenAI SDK 用 `extra_body`）。`enable_logging`、`optimize_streaming_latency` 在顶层传入时会移到 query。`text`、`model_id`、`output_format` 由网关保留，客户端额外字段改不了。

```python
client.audio.speech.create(
    model="elevenlabs-flash-v2.5",
    input="Hello from OctaFuse.",
    voice="JBFqnCBsd6RMkjVDRZzb",
    response_format="mp3",
    extra_body={"voice_settings": {"stability": 0.5, "similarity_boost": 0.75}, "seed": 42},
)
```

### 文件转写

| OpenAI 字段 | ElevenLabs |
|-------------|------------|
| `model` | `model_id`，换成供应商模型名（`scribe_v2`） |
| `language` | `language_code` |
| `prompt` | 丢弃，路由编辑器标为已知不支持 |
| `response_format` | 见下表，由网关本地生成 |
| `timestamp_granularities` | 忽略。上游固定请求词级时间戳 |

`webhook=true` 返回 400。`tag_audio_events`、`num_speakers` 等官方字段用额外表单字段传入。

| `response_format` | 行为 |
|-------------------|------|
| `json` | `{ "text": ... }` |
| `text` | 纯文本 |
| `verbose_json` | 带 `language`、`duration`、`text`、`words`，`segments` 由网关用词级时间戳切出 |
| `diarized_json` | 强制 `diarize=true`，返回 `segments[]`（含 `speaker`，取自上游说话人标签，缺失时为 `speaker_0`） |
| `srt` / `vtt` | 用 `segments` 在本地生成字幕 |

`model_id`、`timestamps_granularity`、`webhook` 由网关保留。

## WebSocket 透传

只代理两条路径，其余 ElevenLabs WebSocket（如 `multi-stream-input`）不支持：

| 公开路径 | operation |
|----------|-----------|
| `GET /elevenlabs/v1/text-to-speech/{voice_id}/stream-input?model_id=` | `audio.speech.realtime` |
| `GET /elevenlabs/v1/speech-to-text/realtime?model_id=` | `audio.transcriptions.realtime` |

帧格式完全是 ElevenLabs 原生的，网关不改帧结构。与 DashScope 不同，模型写在 query 的 `model_id`（填 **Gateway 模型 ID**，可带 `:route_group` 后缀），所以升级**之前**就完成鉴权、`voice_id` 与模型类型校验、余额检查和选路由，Workers 上失败直接回 HTTP 状态码（400 / 401 / 403 / 404 / 426）；Node 上 `ws` 先完成下游升级，失败时以关闭码 1008 关闭，错误文本放在 close reason（见下文「运行时差异」）。其余 query（`output_format`、`audio_format`、`commit_strategy`、`language_code` 等）原样转给上游。

**鉴权**：下游用网关 API Key，三种写法任选：`xi-api-key` 头（官方 SDK）、`Authorization: Bearer`、以及给浏览器用的子协议 `Sec-WebSocket-Protocol: octafuse-api-key.<key>`（浏览器 WebSocket 不能自定义头）。上游 Key 由路由选定的供应商 Key 写入 `xi-api-key`。网关不会把客户端的 Key 转给上游：query 里的 `xi-api-key`、`xi_api_key`、`api_key`、`authorization`、`token` 会被丢弃，TTS 首帧里的 `xi_api_key`、`xi-api-key`、`authorization` 字段会被剥掉。

```bash
# TTS：浏览器 / SDK 把 base_url 指向 {gateway}/elevenlabs 即可
wscat -c "wss://$GATEWAY/elevenlabs/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream-input?model_id=elevenlabs-flash-v2.5&output_format=pcm_16000" \
  -H "xi-api-key: $OCTAFUSE_API_KEY"
```

**故障转移**：只在上游握手阶段生效。上游拒绝升级时保留上游状态码并按 `detail.status` 改写（`quota_exceeded` → 402，并发限制 → 429），可切换下一条路由。握手成功、会话开始之后不再切换，也不会重放帧。

**运行时差异**：Cloudflare Workers 上先连上游、成功后再返回 101，所有失败都是 HTTP 错误。Node 上 `ws` 先完成下游升级再进入路由，因此鉴权、校验、选路由与上游握手的失败都表现为：连接建立后立即以关闭码 1008 关闭，错误文本（截断到 123 字节）放在 close reason；对 Node 部署的客户端，应把「刚连上就被 1008 关闭」当作这类错误处理。

## 计费

- **TTS 按字符**（`per_character`）。字符数优先取响应头 `x-character-count`；该头缺失时按输入文本长度计。最终计费要求字符数非空，所以不会出现「调用成功但没有字符数」。流式变体在流结束后记账。
- **STT 按秒**（`per_second`）。时长依次取上游 `audio_duration_secs`、词级时间戳的最大结束时间、对上传文件的媒体解析、最后按文件字节估算。

### WebSocket 会话计费

用量由网关**按客户端发出的内容估算**，不是上游回报值；只做会话开始前的余额检查，不会在会话中途按额度切断。

- **TTS stream-input**：数客户端文本帧里 `text` 的字符数（按码点），首帧 `" "`（初始化帧）不计。会话以上游 `isFinal` 结束；客户端在 `isFinal` 之前断开记为取消，上游未发 `isFinal` 就关闭记为失败，已发出的字符仍按实际数量入账。
- **实时转写**：把客户端 `audio_base_64` 解码后的字节数除以字节率得到秒数。字节率优先取服务端 `session_started.config.audio_format`，其次是 query 的 `audio_format`，都没有按 `pcm_16000`（32000 字节/秒）。`pcm_N` 为 16 位，`ulaw_` / `alaw_` 为 8 位。

因为是估算，用量需要和 ElevenLabs 控制台定期对账：客户端发了静音、或 STT 由 ElevenLabs 按实际处理时长计费时，两边会有出入。

目录模型预设（`elevenlabs-audio.json`）的美元价为官方刊例价；人民币价按美元 ×7 换算，是占位价而非官方人民币刊例（与 Anthropic、Google 预设同一约定），需要精确人民币账务时请在模型页手工调整。换算后：TTS 为 $0.08 / 千字符 → ¥0.56，$0.04 → ¥0.28；Scribe v2 / Medical 为 $0.22 / 小时 → `0.00042777` 元/秒（约 ¥1.54 / 小时）。

| 模型预设 ID | 供应商模型名 | 单价 |
|-------------|--------------|------|
| `elevenlabs-v4` | `eleven_v4` | $0.08 / 千字符 |
| `elevenlabs-v4-turbo` | `eleven_v4_turbo` | $0.04 / 千字符 |
| `elevenlabs-v3` | `eleven_v3` | $0.08 / 千字符 |
| `elevenlabs-v3-conversational` | `eleven_v3_conversational` | $0.04 / 千字符 |
| `elevenlabs-multilingual-v2` | `eleven_multilingual_v2` | $0.08 / 千字符 |
| `elevenlabs-flash-v2.5` | `eleven_flash_v2_5` | $0.04 / 千字符 |
| `elevenlabs-flash-v2` | `eleven_flash_v2`（仅英语） | $0.04 / 千字符 |
| `elevenlabs-turbo-v2.5` | `eleven_turbo_v2_5`（官方已弃用，建议用 Flash v2.5） | $0.04 / 千字符 |
| `elevenlabs-scribe-v2` | `scribe_v2` | $0.22 / 小时（`0.00006111` 美元/秒） |
| `elevenlabs-scribe-v2-medical` | `scribe_v2_medical` | 同 `scribe_v2` |
| `elevenlabs-scribe-v2-realtime` | `scribe_v2_realtime`（仅实时转写） | $0.39 / 小时（`0.00010833` 美元/秒，人民币 `0.00075833` 元/秒） |

核对来源：[模型列表](https://elevenlabs.io/docs/overview/models)与 [API 定价](https://elevenlabs.io/pricing/api)，核对日期 2026-10-17。关键词提示（$0.05/小时）、转写编辑（$0.07/小时）是 ElevenLabs 的附加计费，目录价不含。没有收录的：`scribe_v1`（已弃用，定价页不再列价）、语音转语音（`*_sts_*`）、音色设计（`*_ttv_*`）、音效和音乐模型，网关都不代理这些接口。TTS 目录模型同时可用于 HTTP 与 `stream-input` WebSocket 路由，需要各自建路由；`eleven_v3` 官方不支持 WebSocket，不要给它建实时路由。

## 错误与故障转移

ElevenLabs 的业务错误体是 `{ "detail": { "status": "...", "message": "..." } }`，HTTP 状态不总能反映是谁的问题。网关按 `detail.status` 改写状态码，这样额度和并发问题会被当成供应商侧故障，触发故障转移和熔断，而不是当作用户请求错误：

| `detail.status` | 改写为 |
|-----------------|--------|
| `quota_exceeded` | 402 |
| `too_many_concurrent_requests`、`system_busy` | 429 |

其余状态码原样返回。TTS 等待上游响应头的超时为 120 秒，响应头到达后不再套总超时，流式变体由客户端断开或上游结束为止。转写沿用网关的音频转写超时。

## 供应商配置

导入预设「ElevenLabs」写入 `elevenlabs.base = https://api.elevenlabs.io/v1`。它没有 `openai.base`，OpenAI `/v1/audio/*` 由适配器转换，不依赖 OpenAI 端点。已导入的供应商需要在「ElevenLabs」页签手工填写 Base，或分别填写 `audio_transcriptions`、`audio_speech` 两个完整 URL。

已导入的供应商要使用 WebSocket，除 Base 外无需额外配置（实时地址由 Base 派生）；也可以在「ElevenLabs」页签分别填 `audio_speech_realtime`、`audio_transcriptions_realtime` 两个完整 `wss://` URL（前者必须含 `{voice_id}`）。

### 调试台与模拟器中的实时路由

调试台与模拟器都能测试 ElevenLabs 实时路由，编辑器里的 JSON 是「参数袋」，由页面拆成路径、query 和帧：

| 路由 | 输入 | 编辑器字段如何使用 |
|------|------|-------------------|
| `audio.transcriptions.realtime`（实时转写） | 默认「浏览器麦克风」，可切换为音频文件（按实时速度回放） | 字段全部作为 query（如 `commit_strategy`、`language_code`、`include_timestamps`）；`audio_format` 固定为 `pcm_16000`，因为浏览器统一编码成 16 kHz / 16-bit PCM |
| `audio.speech.realtime`（实时合成） | 无音频输入，用 `text` 作为朗读内容 | `voice_id` 进路径；`output_format` 等白名单字段进 query；`text` 作为文本帧；其余字段（如 `voice_settings`）放进首帧 |

`model_id`、`model`、`variant` 在编辑器里会被忽略，模型由所选路由决定。

- **转写**：连接建立并收到 `session_started` 后才开始采集 / 发送音频。点「停止」（或文件播完）会发送一次 `commit:true` 并等待 `committed_transcript` 后关闭；若 8 秒内没有返回则直接关闭。响应区展示已提交的句子，加上末尾尚未提交的 partial。
- **合成**：音频帧累积后在关闭时拼成可播放的音频（`pcm_N` 会补 WAV 头）；原始报文里 base64 音频折叠成字节数。
- **调试台**：浏览器连管理后台 `/api/admin/playground/realtime`，由后台转发到上游（后台注入 `xi-api-key` 与路由的供应商模型名），不计费、不写请求日志、无故障转移。
- **模拟器**：浏览器直连 Proxy，用子协议 `octafuse-api-key.<key>` 鉴权，走完整的鉴权、选路由、余额检查与计费。
- 麦克风需要浏览器授权，页面要在 `localhost` 或 HTTPS 下打开。

命令行验证可以用 `wscat`、官方 SDK 或 `scripts/smoke/test-elevenlabs-realtime.ts`。

调试台（HTTP 透传）：原生透传的 JSON 里用 `voice_id`、可选 `variant`（`speech`、`stream`、`timestamps`、`stream-timestamps`）和 `output_format` 指定路径与 query，其余字段按 ElevenLabs 官方 JSON 填写。模拟器打公开路径，按同样约定拼出 `/elevenlabs/v1/text-to-speech/{voice_id}`。
