# MiniMax 音频

`minimax` 是上游协议族，和 OpenAI、Anthropic、Gemini、DashScope 并列，不是供应商名称。国内与国际 MiniMax 原生接口共用一套路径：Bearer 鉴权，Base 分别为 `https://api.minimaxi.com/v1` 与 `https://api.minimax.io/v1`。

客户端可以继续调用 OpenAI `POST /v1/audio/transcriptions`，由适配器 `minimax-asr-file` 转到 MiniMax。也可以直接调用原生透传 `POST /v1/minimax/speech_to_text`。

## 当前能力

只配置 Base 时，网关派生下表中的地址。语音合成、生图、视频和音乐等原生接口还没有能力项，供应商表单里也不会出现对应字段。

| 能力 | 派生路径 | 说明 |
|------|----------|------|
| `audio.transcriptions` | `{base}/speech_to_text` | 文件转写，模型 `asr-1.0` |

## 适配器

| 适配器 | 转换 |
|--------|------|
| `minimax-asr-file` | OpenAI multipart 转写 → MiniMax `POST /v1/speech_to_text`。`srt` / `vtt` 由网关生成 |
| `passthrough` · `minimax/audio.transcriptions` | 公开 `POST /v1/minimax/speech_to_text`，表单和响应原样转发，只把 `model` 换成供应商模型名 |

路由的供应商模型名填 `asr-1.0`。转换路由的对外协议保持 OpenAI `audio.transcriptions`，上游协议选 `minimax`。透传路由的对外协议和上游协议都是 `minimax` / `audio.transcriptions`。

## 请求与回包

- 表单字段是 `model`、`file`、`response_format`，以及路由请求参数（例如 `timestamp_level`）。
- `language` 放在请求头里（BCP-47，如 `zh`、`en`、`yue`），不进表单。
- `prompt` 和 `temperature` 丢弃，路由编辑器会标成已知不支持。
- 客户端要 `text` 或 `json` 时，上游请求 `json`。
- 客户端要 `verbose_json` 或 `diarized_json` 时，上游请求 `verbose_json`，原样返回（含 `segments[].speaker`）。
- 客户端要 `srt` 或 `vtt` 时，上游仍请求 `verbose_json`，网关用 `segments` 在本地生成字幕。这样计费始终能读到上游的 `duration`。
- 透传不改 `response_format`，也不生成 `srt` / `vtt`。客户端按 MiniMax 原生取值发送（`json` 或 `verbose_json`），网关原样返回。
- 错误沿用 MiniMax 的 OpenAI 风格错误体，状态码原样返回。
- 不支持流式转写。单文件上限沿用网关现有的 25MB，比 MiniMax 的 50MB 更严。

## 计费

按上游返回的 `duration` 按秒计费，没有最低时长。目录价：人民币 2.50 元/小时（`0.000694444` 元/秒），美元 $0.38/小时（`0.000105556` 美元/秒）。模型预设 ID 是 `minimax-asr-1.0`。

## 供应商配置

导入预设「MiniMax」会写入 `minimax.base = https://api.minimaxi.com/v1`，原有 OpenAI Chat 与 Anthropic Messages 不变。已经导入的供应商不会自动补上这个 Base，需要在供应商里手工填写。

调试台按所选适配器组装 multipart，并把 `language` 放进请求头。转换路由在模拟器里走 `POST /v1/audio/transcriptions`。透传路由走 `POST /v1/minimax/speech_to_text`：表单里的 `language` 由网关转到请求头，响应保持上游原文。
