# 客户端接入

客户端接入 Gateway 时，只需要把原本的供应商 Base URL 和 API Key 改成 Gateway 的 Proxy URL 与用户 API Key。

## OpenAI 兼容

Base URL 指向 Proxy：

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

模型列表（需用户 Key；默认仅 LLM，不含纯图片生成模型）：

```bash
curl -sS http://localhost:8787/v1/models \
  -H "Authorization: Bearer sk-your-api-key"
# 含图片生成模型：?kind=image 或 ?kind=all
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

Agent Tools（需用户 Key；Admin → Tools 已为对应工具配置 Active 引擎与第三方 API Key）。示例如下（当前联网类工具之一）：

```bash
curl -sS http://localhost:8787/v1/tools/web-search \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"query":"OctaFuse gateway","count":5}'
```

## Anthropic 兼容

Anthropic 风格接口使用 Proxy 的 `/v1/messages`，认证可用 `x-api-key`：

```bash
curl -sS http://localhost:8787/v1/messages \
  -H "x-api-key: sk-your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'
```

## Gemini 兼容

Gemini 风格接口使用 Proxy 的 `/v1beta/models/...`：

```bash
curl -sS "http://localhost:8787/v1beta/models/your-route-model:generateContent?key=sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

## 查询当前 Key 的预算

```bash
curl -sS http://localhost:8787/v1/me \
  -H "Authorization: Bearer sk-your-api-key"
```

完整用户接口见 [developers/api/user.md](../developers/api/user.md)。
