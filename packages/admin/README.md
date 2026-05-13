# Octafuse Admin（`@octafuse/admin`）

Gateway **管理控制台**：API keys、providers、models、routes、`system_config`、请求日志、预算审计、analytics。运行于 **Next.js 16 + OpenNext（Cloudflare Pages）**，**直连 D1**（与 `@octafuse/proxy` 同一库 `octafuse`），对外提供 **`/api/admin/*`**。

## 职责与边界

- **做**：管理 UI；服务端 **`app/api/admin/[...path]/route.ts`** 鉴权后把请求重写为 `/admin/*` 交给 Hono（与 [API 文档](../../docs/api/admin.md) 中的内部路径一致）。
- **不做**：客户端版本、插件市场、计费门户的用户增长等（属各产品自有后台）。

## 仓库内路径（摘要）

| 路径 | 说明 |
|------|------|
| `app/api/admin/[...path]/route.ts` | Cookie 会话或 Bearer `MASTER_KEY`；重写 → Hono |
| `lib/admin-app.ts` | 挂载 `/admin/*` |
| `lib/routes/admin/*` | 管理 HTTP 处理 |
| `lib/services/admin/*` | 管理业务层（依赖 `@octafuse/core`） |
| `app/gateway/*` | 管理页面（`fetch('/api/admin/...')`） |

## 环境变量（Wrangler / `.dev.vars`）

- **`ADMIN_USERNAME`**、**`ADMIN_PASSWORD`**：控制台登录。本地 `npm run preview`：写入 **`.dev.vars`**（见 `.dev.vars.example`）。生产 Cloudflare：**`ADMIN_PASSWORD`** 须为 Worker **Secret** 或 `wrangler secret put`，**勿**写入 `wrangler.jsonc` 的 `vars`。
- **D1 `DB`**：`database_id` 须与 **`packages/proxy/wrangler.jsonc`**（Proxy）一致。

外部系统（如计费门户）：设置 **`GATEWAY_MASTER_URL`** 为本应用 origin，请求 **`POST /api/admin/keys`** 等，头 **`Authorization: Bearer <MASTER_KEY>`**（与 D1 `system_config.MASTER_KEY` 一致）。

## 命令

在已 `npm install` 的 **octafuse 根目录**：

```bash
cd packages/admin
npm run cf-typegen  # 首次 clone 或 wrangler 绑定变更后生成 cloudflare-env.d.ts（该文件已 gitignore）
npm run dev       # :3000，无 D1，仅适合改 UI
npm run preview   # :8789 + D1（--persist-to ../../.wrangler/state）
npm run deploy
```

完整本地联调见 [docs/ops/local-testing-environments.md](../../docs/ops/local-testing-environments.md)。

## 文档

- [docs/README.md](../../docs/README.md) — v2 总览
- [docs/api/admin.md](../../docs/api/admin.md) — 管理 API 矩阵
- [AGENTS.md](./AGENTS.md) — 本包开发与架构说明（英文）
