---
"@octafuse/proxy": patch
"octafuse": patch
---

为缺失 `sequence_number` 的 OpenAI Responses SSE 事件兜底注入递增序号。

### Proxy

- **Responses 序号兜底**：部分上游（如 DeepSeek / GLM 聚合层）返回的 Responses 流式事件不含 `sequence_number`，Grok CLI 等严格反序列化客户端会因 `missing field sequence_number` 中断。`openai-responses-driver` 在转发每个 `data:` 事件前调用 `ensureResponsesSequenceNumber`：仅当事件顶层缺失该字段时注入递增序号；上游已带序号的事件原样保留，并让计数器越过该值避免后续注入重复。
