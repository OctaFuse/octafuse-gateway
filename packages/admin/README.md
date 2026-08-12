# `@octafuse/admin`

**管理控制台**：管理 API Keys、Providers、Models、Routes、Agent Tools、三账本计费、日志、审计与分析。Next.js 16 + OpenNext（Cloudflare）或 **Node**；与 Proxy **共用同一数据库**（Cloudflare 使用 D1，Node 使用 Postgres 或 MySQL）。2.0 中一个 Provider 维护一把上游 Key，Routes 页面按 Request Surface → Route Pool → Upstream Target 展示和配置路由。

## 职责

- **做**：管理 UI；`app/api/admin/[...path]/route.ts` 鉴权后转发到内部 Hono（路径约定见 [docs/developers/api/admin.md](../../docs/developers/api/admin.md)）。
- **不做**：各产品自有门户、插件市场等。

## 环境

- **`ADMIN_USERNAME` / `ADMIN_PASSWORD`**：控制台登录。本地 `preview` / `dev:admin`：读 `.dev.vars`；若缺失会自动生成（默认 **`admin` / `admin`**，见 `scripts/ensure-dev-vars.mjs`）。生产：**`ADMIN_PASSWORD`** 用 Worker **Secret**（`npx wrangler secret put ADMIN_PASSWORD --name <ADMIN_WORKER_NAME>`）。
- **数据库**：Wrangler 绑定 **`DB`**（D1）或根 `.env` 的 **`DATABASE_URL`** + **`DATABASE_DRIVER`**（Node；Postgres / MySQL）；须与 Proxy 指向同一逻辑库。

外部自动化：在后台创建具名、最小权限的 Admin API Key，然后使用 `GATEWAY_MASTER_URL` + `Authorization: Bearer <ADMIN_API_KEY>`。

## 命令

```bash
npm run dev:admin          # 根目录：OpenNext preview + D1
npm run dev:admin:node     # Node + SQL
npm run deploy:admin
```

单包开发：`cd packages/admin` 后 `npm run dev`（默认 `:3000`；无 D1 / SQL 时管理 API 会失败，仅适合改 UI）。完整 Admin API 联调请在根目录使用 `npm run dev:admin`（`:8789` + D1）或 `npm run dev:admin:node`（`:8789` + Postgres / MySQL）。

文档：[docs/README.md](../../docs/README.md) · [route-topology.md](../../docs/developers/architecture/route-topology.md) · [admin API](../../docs/developers/api/admin.md) · [AGENTS.md](./AGENTS.md)

