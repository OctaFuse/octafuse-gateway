# ElevenLabs 音频

`elevenlabs` 是上游协议族，和 OpenAI、Anthropic、Gemini、DashScope、MiniMax 并列，不是供应商名称。原生接口用 `xi-api-key` 请求头鉴权，Base 默认 `https://api.elevenlabs.io/v1`。欧盟数据驻留使用 `https://api.eu.residency.elevenlabs.io/v1`。

客户端有两种接法：

- **原生透传**：`POST /elevenlabs/v1/text-to-speech/{voice_id}` 与 `POST /elevenlabs/v1/speech-to-text`，路径和 ElevenLabs 官方 SDK 一致，只需要把 SDK 的 `base_url` 指向 `{gateway}/elevenlabs`。
- **OpenAI 兼容**：`POST /v1/audio/speech` 与 `POST /v1/audio/transcriptions`，由适配器 `elevenlabs-tts`、`elevenlabs-asr-file` 转成上游请求，ElevenLabs 特有字段用 `extra_body`（multipart 用额外表单字段）。

## 当前能力

只配置 Base 时，网关派生下表中的地址。

| 能力 | 派生路径 | 说明 |
|------|----------|------|
| `audio.transcriptions` | `{base}/speech-to-text` | 文件转写（Scribe），multipart |
| `audio.speech` | `{base}/text-to-speech/{voice_id}` | 文本转语音。`voice_id` 是路径参数，每次请求填入；自定义 URL 必须包含 `{voice_id}` 占位符 |

不在范围内：WebSocket 流式合成与实时转写、音色管理、语音转语音、配音、音效、音乐。见 [能力覆盖](../reference/native-provider-coverage.md)。

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

模型名规则：TTS 供应商模型名匹配 `eleven_*`（排除 `*_sts_*`、`*_ttv_*`、`eleven_text_to_sound_*`、`eleven_music*`），ASR 匹配 `scribe_*`（排除实时模型）。

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

## 计费

- **TTS 按字符**（`per_character`）。字符数优先取响应头 `x-character-count`；该头缺失时按输入文本长度计。最终计费要求字符数非空，所以不会出现「调用成功但没有字符数」。流式变体在流结束后记账。
- **STT 按秒**（`per_second`）。时长依次取上游 `audio_duration_secs`、词级时间戳的最大结束时间、对上传文件的媒体解析、最后按文件字节估算。

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

核对来源：[模型列表](https://elevenlabs.io/docs/overview/models)与 [API 定价](https://elevenlabs.io/pricing/api)，核对日期 2026-10-17。关键词提示（$0.05/小时）、转写编辑（$0.07/小时）是 ElevenLabs 的附加计费，目录价不含。没有收录的：`scribe_v1`（已弃用，定价页不再列价）、`scribe_v2_realtime`（只有 WebSocket）、语音转语音（`*_sts_*`）、音色设计（`*_ttv_*`）、音效和音乐模型，网关都不代理这些接口。`eleven_v4_turbo` 与 `eleven_v3_conversational` 官方主要面向实时 / WebSocket 场景，网关只代理 HTTP 文本转语音。

## 错误与故障转移

ElevenLabs 的业务错误体是 `{ "detail": { "status": "...", "message": "..." } }`，HTTP 状态不总能反映是谁的问题。网关按 `detail.status` 改写状态码，这样额度和并发问题会被当成供应商侧故障，触发故障转移和熔断，而不是当作用户请求错误：

| `detail.status` | 改写为 |
|-----------------|--------|
| `quota_exceeded` | 402 |
| `too_many_concurrent_requests`、`system_busy` | 429 |

其余状态码原样返回。TTS 等待上游响应头的超时为 120 秒，响应头到达后不再套总超时，流式变体由客户端断开或上游结束为止。转写沿用网关的音频转写超时。

## 供应商配置

导入预设「ElevenLabs」写入 `elevenlabs.base = https://api.elevenlabs.io/v1`。它没有 `openai.base`，OpenAI `/v1/audio/*` 由适配器转换，不依赖 OpenAI 端点。已导入的供应商需要在「ElevenLabs」页签手工填写 Base，或分别填写 `audio_transcriptions`、`audio_speech` 两个完整 URL。

调试台：原生透传的 JSON 里用 `voice_id`、可选 `variant`（`speech`、`stream`、`timestamps`、`stream-timestamps`）和 `output_format` 指定路径与 query，其余字段按 ElevenLabs 官方 JSON 填写。模拟器打公开路径，按同样约定拼出 `/elevenlabs/v1/text-to-speech/{voice_id}`。
