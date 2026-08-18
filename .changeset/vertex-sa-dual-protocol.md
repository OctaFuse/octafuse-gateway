---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

Project-scoped Vertex accepts a GCP service account JSON and uses one OAuth access token for official OpenAI (`.../endpoints/openapi`) and native Gemini.

### Proxy
- Resolve provider credentials before egress; service accounts never go out as `?key=` or raw JSON
- Prefix Vertex OpenAI `provider_model_name` with `google/` when missing

### Admin
- Playground uses the same credential resolve + OpenAI model prefix
- Project-scoped Vertex import template now asks for a service account JSON
