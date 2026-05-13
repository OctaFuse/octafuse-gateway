# `@octafuse/proxy`

Octafuse **推理入口**：Cloudflare Worker（配置在 **`packages/proxy/wrangler.jsonc`**），绑定 D1，对外提供：

- `GET /`、`GET /health`
- OpenAI / Anthropic / Gemini 兼容：`/v1/*`、`/v1beta/*`

**不提供** `/admin/*`。管理 API 由 **`@octafuse/admin`** 在 **`/api/admin/*`** 上暴露。

## 命令

在仓库根安装依赖后：

```bash
npm run dev -w @octafuse/proxy    # 或根目录 npm run dev:proxy
npm run deploy -w @octafuse/proxy
```

可选 **Node 运行时**（当前为 Postgres；无 `/admin`）：

```bash
# 推荐：在仓库根（读根 `.env`）
npm run dev:proxy:node

# 或在本包
cd packages/proxy
# .env：DATABASE_URL；DATABASE_DRIVER 可省略（默认 postgres）；可选 PORT（默认 8787）
npm run dev:node
```

详见 [docs/README.md](../../docs/README.md) 与 [docs/ops/local-testing-environments.md](../../docs/ops/local-testing-environments.md)。
