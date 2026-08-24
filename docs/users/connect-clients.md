# 客户端接入

客户端接入 Gateway 时，只需要记住一个代理服务（Proxy）根 URL，并把供应商 API Key 替换为用户 API Key：OpenAI SDK 使用 `{proxy}/v1`，Anthropic 使用 `{proxy}/v1/messages`，Gemini 使用 `{proxy}/v1beta/models/...`。

## OpenAI 兼容

Base URL 指向代理服务：

```text
http://localhost:8787/v1
```

请求示例：

```bash
curl -sS http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

Responses（需为模型配置 `openai.responses` 请求入口与同协议上游）：

```bash
curl -sS http://localhost:8787/v1/responses \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","input":[{"role":"user","content":"Hello"}],"stream":false}'
```

模型列表（需用户 Key；默认仅 LLM，不含纯文生图与音频模型）：

```bash
curl -sS http://localhost:8787/v1/models \
  -H "Authorization: Bearer sk-your-api-key"
# 文生图：?kind=image ；音频：?kind=audio ；全部：?kind=all
```

公开 Catalog（**无需**用户 Key，适合门户 discovery）：

```bash
curl -sS http://localhost:8787/catalog/models
```

图片生成（Images；需用户 Key + 已配置 OpenAI 协议 image 路由）：

```bash
curl -sS http://localhost:8787/v1/images/generations \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"a watercolor fox","size":"1024x1024"}'
```

图片编辑使用 `POST /v1/images/edits`（multipart）；并非所有上游都实现 OpenAI edits 形态，具体兼容性见 [文生图模型说明](../developers/reference/image-models.md)。

语音转写（Audio；需用户 Key + 已配置 OpenAI 协议 ASR 路由）：

```bash
curl -sS http://localhost:8787/v1/audio/transcriptions \
  -H "Authorization: Bearer sk-your-api-key" \
  -F model=whisper-1 \
  -F file=@recording.webm \
  -F language=zh \
  -F response_format=json
```

语音合成（TTS；需用户 Key + 已配置 `audio.speech` 路由）：

```bash
curl -sS http://localhost:8787/v1/audio/speech \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-tts-model","input":"你好，Octafuse。","voice":"your-voice"}' \
  --output speech.mp3
```

DashScope 同步多模态 ASR 使用原生 JSON 入口（需配置 `dashscope` + `audio.transcriptions.multimodal` 请求入口与同协议 `passthrough` 上游）：

```bash
curl -sS http://localhost:8787/v1/dashscope/services/aigc/multimodal-generation/generation \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-asr-model",
    "input": {
      "messages": [{
        "role": "user",
        "content": [{
          "type": "input_audio",
          "input_audio": {"data": "https://example.com/sample.wav"}
        }]
      }]
    },
    "parameters": {"format": "wav", "language_hints": ["zh"]}
  }'
```

网关返回 DashScope 原生 JSON，并按上游 `usage.duration` / `usage.seconds` 记录时长和费用。DashScope 原生实时 ASR / TTS 则继续使用 `/v1/dashscope/realtime` WebSocket 入口；连接参数与 operation 见 [DashScope 音频架构](../developers/architecture/dashscope-audio.md)。

智能体工具（Agent Tools；需用户 Key；管理后台 → 智能体工具已为对应工具配置活跃引擎与第三方 API Key）提供 `POST /v1/tools/web-search`、`POST /v1/tools/web-fetch`、`POST /v1/tools/web-deep-search`。示例如下：

```bash
curl -sS http://localhost:8787/v1/tools/web-search \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"query":"OctaFuse gateway","count":5}'
```

## Anthropic 兼容

Anthropic 风格接口使用代理服务的 `/v1/messages`，认证可用 `x-api-key` 或 `Authorization: Bearer`：

```bash
curl -sS http://localhost:8787/v1/messages \
  -H "x-api-key: sk-your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'
```

## Gemini 兼容

Gemini 风格接口使用代理服务的 `/v1beta/models/...`，认证可用查询参数 `key`、`x-goog-api-key` 或 `Authorization: Bearer`：

```bash
curl -sS "http://localhost:8787/v1beta/models/your-route-model:generateContent?key=sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

流式调用将 action 改为 `streamGenerateContent`（通常同时传 `alt=sse`）：

```text
POST /v1beta/models/your-route-model:streamGenerateContent?alt=sse&key=sk-your-api-key
```

## 查询当前 Key 的预算

```bash
curl -sS http://localhost:8787/v1/me \
  -H "Authorization: Bearer sk-your-api-key"
```

完整用户接口见 [developers/api/user.md](../developers/api/user.md)。
