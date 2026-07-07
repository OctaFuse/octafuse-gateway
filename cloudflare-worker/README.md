# Cloudflare Worker 部署配置

本目录存放 **Wrangler / Workers Builds** 用的实例变量（Worker 名、D1、`routes`）。**不**用于 Node + Postgres 本地开发——那部分见仓库根 [`.env.example`](../.env.example)。

详细运维说明：[docs/ops/deployment-cloudflare.md](../docs/ops/deployment-cloudflare.md)。

---

## 先选一条路径

| 路径 | 何时用 | 需要 `cloudflare-worker/*.env`？ | 需要远程 D1？ |
|------|--------|----------------------------------|---------------|
| **[A. 本地开发](#a-本地-cloudflare-开发不上线)** | 本机改代码、本地 D1 | ❌ 不需要 | ❌ 仅 `.wrangler/state` |
| **[B. dev 演示部署](#b-dev-演示远程-octafusedev)** | 长期公共测试 `test-api.octafuse.dev` | ✅ [`example.env`](./example.env) | ✅ 独立 dev 库 |
| **[C. 生产 Git 自动部署](#c-生产-git-自动部署)** | 自有生产环境 | ❌ 不进 Git；用 **Build variables** 或本地 gitignore env | ✅ 各实例生产库 |

---

## 配置文件怎么放

| 文件 | 是否提交 Git | 用途 |
|------|--------------|------|
| [`example.env`](./example.env) | ✅ 提交 | **dev 演示** canonical 配置（`octafuse.dev`） |
| 自建 `cloudflare-worker/<name>.env` | ❌ gitignore | **生产**本地 CLI 或 Dashboard 配置备份 |
| Cloudflare **Build variables** | ❌ 仅在 Dashboard | **生产 / dev Worker 的 Git 自动部署**（与 `.env` 同名变量） |

`gen-wrangler` 只读 **环境变量**（`process.env`），不关心来自文件还是 Dashboard。

---

## A. 本地 Cloudflare 开发（不上线）

目标：本机 Proxy `:8787` + Admin `:8789`，D1 数据在 **`.wrangler/state`**。

```bash
npm install          # postinstall 会 npm run gen:wrangler（无 D1_DATABASE_ID 的本地配置）
npm run db:migrate   # 本地 D1 迁移
npm run dev:proxy    # http://127.0.0.1:8787
npm run dev:admin    # http://127.0.0.1:8789（OpenNext preview + 本地 D1）
```

- **不需要** `cloudflare-worker/*.env`。
- 生成配置：`packages/proxy/wrangler.jsonc` 等（gitignore，由 `*.base.jsonc` + `gen:wrangler` 生成）。
- Admin 本地密码：[`packages/admin/.dev.vars.example`](../packages/admin/.dev.vars.example) → `.dev.vars`。
- 更多组合（Hybrid、Postgres）：[local-testing-environments.md](../docs/ops/local-testing-environments.md)。

---

## B. dev 演示（远程 · octafuse.dev）

目标：公共测试环境，域名：

| 角色 | URL |
|------|-----|
| Proxy | `https://test-api.octafuse.dev` |
| Admin | `https://test-admin.octafuse.dev` |

配置来源：[`example.env`](./example.env)（Worker 名 `*-dev`，D1 `octafuse-gateway-dev`）。

### 首次 bootstrap（CLI）

```bash
npx wrangler login
npx wrangler d1 create octafuse-gateway-dev   # 若尚未创建
npx wrangler d1 list                          # 将 database_id 写入 example.env

# 在 Dashboard 创建 Worker（名须与 example.env 一致）：
#   octafuse-gateway-proxy-dev
#   octafuse-gateway-admin-dev
# Admin 密码：npx wrangler secret put ADMIN_PASSWORD -w octafuse-gateway-admin-dev

npx dotenv -e ./cloudflare-worker/example.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:admin
```

验证：`GET https://test-api.octafuse.dev/health`、Admin 登录。

### 后续：Git 自动部署（可选）

1. 两个 `-dev` Worker → **Connect to Git**（`octafuse-gateway` 仓）。
2. **Build variables**：与 `example.env` 中变量**同名同值**（见 [deployment-cloudflare.md § Workers Builds](../docs/ops/deployment-cloudflare.md#4-workers-builds-connect-to-git)）。
3. `git push` → 自动构建部署；**D1 迁移仍手动** `db:migrate:remote`。

给测试用户的下游变量：

```env
GATEWAY_URL=https://test-api.octafuse.dev
GATEWAY_MASTER_URL=https://test-admin.octafuse.dev
GATEWAY_MASTER_KEY=<D1 system_config.MASTER_KEY>
```

---

## C. 生产 Git 自动部署

**同一套代码、多实例**：差异在 **每个 Worker 的 Build variables**（或本地 gitignore 的 env 文件），不在 Git 里提交生产 `D1_DATABASE_ID`。

### 准备实例 env（本地 CLI 可选）

复制 [`example.env`](./example.env) 为 `cloudflare-worker/<your-instance>.env`（**勿 commit**），按你的 Cloudflare 账号修改：

| 变量 | 说明 |
|------|------|
| `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME` | 与 Dashboard Worker 名一致 |
| `D1_DATABASE_NAME` / `D1_DATABASE_ID` | `npx wrangler d1 list` 确认 |
| `D1_MIGRATIONS_WORKER_NAME` | 可选；仅 D1 迁移脚本用 |
| `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` | 可选；不设则由 Dashboard 绑定域名 |

### Git 自动部署（推荐）

1. Dashboard → 对应 Worker → **Settings → Builds**。
2. **Build variables** 与本地 env **同名同值**（生产 UUID **只放 Dashboard**）。
3. Build / Deploy command 见 [deployment-cloudflare.md §4](../docs/ops/deployment-cloudflare.md#4-workers-builds-connect-to-git)（含 **Build watch paths**，避免无关 push 触发部署）。
4. 有新 SQL：`npx dotenv -e ./cloudflare-worker/<your-instance>.env -- npm run db:migrate:remote` → 再 `git push`。

### 本地 CLI 发版（补充）

```bash
npx dotenv -e ./cloudflare-worker/<your-instance>.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/<your-instance>.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/<your-instance>.env -- npm run deploy:admin
```

---

## 环境变量说明

| 变量 | 说明 |
|------|------|
| `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME` | **须与 Dashboard Worker 名一致** |
| `D1_DATABASE_NAME` | D1 逻辑名 |
| `D1_DATABASE_ID` | 远程 deploy / migrate **必填**；proxy 与 admin **共用** |
| `D1_MIGRATIONS_WORKER_NAME` | 仅写入 `wrangler.d1.jsonc` 的项目名；**无需**单独建 Worker |
| `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` | 可选；写入 wrangler `routes` |

实现：`npm run gen:wrangler` → [`scripts/deploy/gen-wrangler.mjs`](../scripts/deploy/gen-wrangler.mjs) 读 env，从 `packages/*/wrangler.base.jsonc` 生成 gitignore 的 `wrangler.jsonc`。

---

## 与根目录 `.env.example` 的区别

| | `cloudflare-worker/` | 根 `.env.example` → `.env` |
|--|----------------------|----------------------------|
| 用途 | Cloudflare 部署 / 远程 D1 | Node + Postgres/MySQL、Docker、冒烟 |
| 典型命令 | `deploy:proxy`、`db:migrate:remote` | `dev:proxy:node`、`db:migrate:pg` |

两者互不替代。
