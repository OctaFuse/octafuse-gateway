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

模型列表：

```bash
curl -sS http://localhost:8787/v1/models \
  -H "Authorization: Bearer sk-your-api-key"
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
