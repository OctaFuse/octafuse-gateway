# `@octafuse/proxy`

**推理入口**：Cloudflare Worker（`wrangler.jsonc`）或 **Node**（Postgres / MySQL）。对外：

- `GET /`、`GET /health`
- 公开目录：`GET /catalog/models`（无需用户 Key）
- OpenAI / Anthropic / Gemini 兼容：`/v1/*`、`/v1beta/*`（含 `POST /v1/images/*`）
- Agent Tools（可扩展 `/v1/tools/*`；当前含）：`web-search`、`web-fetch`、`web-deep-search`

**不提供** `/admin/*`。管理 API 由 **`@octafuse/admin`** 在 **`/api/admin/*`** 提供。Tools 引擎 Key 与单价在 Admin → **Tools** 维护。

## 命令（在仓库根 `npm install` 后）

```bash
npm run dev:proxy          # Worker + 本地 D1
npm run dev:proxy:node     # Node + SQL（根 `.env`）
npm run deploy:proxy
```

文档：[docs/README.md](../../docs/README.md) · [docs/developers/local-development.md](../../docs/developers/local-development.md)
