# `@octafuse/admin`

**管理控制台**：API keys、providers、models、routes、日志与审计等。Next.js 16 + OpenNext（Cloudflare）或 **Node**；与 Proxy **共用同一数据库**（D1 或 SQL）。

## 职责

- **做**：管理 UI；`app/api/admin/[...path]/route.ts` 鉴权后转发到内部 Hono（路径约定见 [docs/api/admin.md](../../docs/api/admin.md)）。
- **不做**：各产品自有门户、插件市场等。

## 环境

- **`ADMIN_USERNAME` / `ADMIN_PASSWORD`**：控制台登录。本地 `preview`：`.dev.vars`。生产：**`ADMIN_PASSWORD`** 用 Worker **Secret**。
- **数据库**：Wrangler 绑定 **`DB`**（D1）或根 `.env` 的 **`DATABASE_URL`**（Node）；须与 Proxy 指向同一逻辑库。

外部自动化：`GATEWAY_MASTER_URL` + `Authorization: Bearer <MASTER_KEY>`。

## 命令

```bash
npm run dev:admin          # 根目录：OpenNext preview + D1
npm run dev:admin:node     # Node + SQL
npm run deploy:admin
```

单包开发：`cd packages/admin` 后 `npm run dev`（无 D1 时管理 API 会失败，仅适合改 UI）。

文档：[docs/README.md](../../docs/README.md) · [docs/api/admin.md](../../docs/api/admin.md) · [AGENTS.md](./AGENTS.md)



