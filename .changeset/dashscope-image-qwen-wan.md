---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

Access Alibaba DashScope image models (`qwen-image-3.0*` / `wan2.7-image*`) through OpenAI `/v1/images/generations`.

### Proxy

- Add `dashscope-image-qwen` and `dashscope-image-wan` conversion adapters that map OpenAI Images to DashScope multimodal generation
- Keep conversion targets when the stored upstream operation is `*`; resolve the mapped DashScope operation before dispatch
- Always send explicit `n` (default 1) so Wan does not silently generate 4 images
- Rewrite OpenAI `1024x1024` size strings to DashScope `1024*1024`
- Derive Qwen Pro `1k` / `2k` billing size from upstream usage
- Support `response_format=b64_json` by downloading OSS URLs

### Admin

- Token Plan preset now includes `images.generations.multimodal`
- Route modal adds Qwen / Wan image presets; provider form can override the multimodal image endpoint
- Allow image routes to save `upstream_protocol=dashscope` for OpenAI → DashScope conversion
- Playground can send DashScope image routes: OpenAI Images JSON is rewritten to multimodal-generation
