# Cloudflare Worker 部署配置

本目录存放 **Wrangler / Workers Builds** 用的实例变量（Worker 名、D1、`routes`）。**不**用于 Node + Postgres 本地开发——那部分见仓库根 [`.env.example`](../.env.example)。

**外部用户首次上云**：请先读 **[Cloudflare 快速部署](../docs/operators/deployment/cloudflare-quickstart.md)**（`npm run bootstrap:cloudflare`）。本页偏运维路径与 Dashboard 配置。

详细运维说明：[docs/operators/deployment/cloudflare.md](../docs/operators/deployment/cloudflare.md)。生产 **Connect to Git** 的 Dashboard 配置见 **[§C](#git-自动部署connect-to-git)**。

> 本仓库**不提供**「Deploy to Cloudflare」单按钮：官方 Deploy Button 无法一次部署 monorepo 双 Worker + 共享 D1；请用 quickstart CLI。

---

## 先选一条路径

| 路径 | 何时用 | 需要 `cloudflare-worker/*.env`？ | 需要远程 D1？ |
|------|--------|----------------------------------|---------------|
| **[外部快速部署](../docs/operators/deployment/cloudflare-quickstart.md)** | 自有账号首次上云 | ✅ 由 `bootstrap:cloudflare` 生成 | ✅ 脚本创建或复用 |
| **[A. 本地开发](#a-本地-cloudflare-开发不上线)** | 本机改代码、本地 D1 | ❌ 不需要 | ❌ 仅 `.wrangler/state` |
| **[B. dev 演示部署](#b-dev-演示远程-octafusedev)** | 长期公共测试 `test-api.octafuse.dev` | ✅ [`example.env`](./example.env) | ✅ 独立 dev 库 |
| **[C. 生产 Git 自动部署](#c-生产-git-自动部署)** | 自有生产环境 | ❌ 不进 Git；用 **Build variables** 或本地 gitignore env | ✅ 各实例生产库 |

---

## 配置文件怎么放

| 文件 | 是否提交 Git | 用途 |
|------|--------------|------|
| [`example.env`](./example.env) | ✅ 提交 | **dev 演示** canonical 配置（`octafuse.dev`） |
| 自建 `cloudflare-worker/<name>.env` | ❌ gitignore | **生产**本地 CLI 或 Dashboard 配置备份 |
| Cloudflare **Build variables** | ❌ 仅在 Dashboard | **生产** Worker 的 Git 自动部署（与实例 `.env` 同名变量） |

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
- 更多组合（Hybrid、Postgres）：[local-testing-environments.md](../docs/developers/local-development.md)。

### 远程 deploy 之后继续本地 dev

`deploy-soloent.sh`、`deploy:proxy`、`db:migrate:remote` 等会执行 **`gen:wrangler --remote`**，在生成的 `wrangler.jsonc` 里写入 **`D1_DATABASE_ID`**。此后若直接 `dev:proxy` / `dev:admin`，Wrangler 会连 **另一套** 本地 D1（与 `npm run db:migrate` 默认迁移的 `(DB)` 套不一致）。

**回到本地开发前**（仓库根；shell 勿 export `D1_DATABASE_ID`）：

```bash
npm run gen:wrangler
npm run db:migrate   # 可选
# 重启 dev:proxy / dev:admin
```

详见 [local-testing-environments.md §1 · database_id](../docs/developers/local-development.md#️-本地-d1-与-database_id远程-deploy-后必读)。

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
# Admin 密码：npx wrangler secret put ADMIN_PASSWORD --name octafuse-gateway-admin-dev

npx dotenv -e ./cloudflare-worker/example.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:admin
```

验证：`GET https://test-api.octafuse.dev/health`、Admin 登录。

### 后续发版（CLI）

dev 演示**不使用** Git 自动部署；发版继续用 CLI：

```bash
npx dotenv -e ./cloudflare-worker/example.env -- npm run db:migrate:remote  # 有新 SQL 时
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:admin
```

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

### Git 自动部署（Connect to Git）

1. 完成上方实例 env；首次可用下方 [本地 CLI 发版](#本地-cli-发版补充) bootstrap。
2. Proxy / Admin 两个 Worker 分别 **Connect to Git**（仓库 `octafuse-gateway`，生产分支通常 `main`）。
3. 按下方 **Dashboard 配置** 填写；**Build variables** 与 `cloudflare-worker/<your-instance>.env` **同名同值**（`D1_DATABASE_ID` **只放 Dashboard，不进 Git**）。
4. `git push` → 自动构建部署；**D1 迁移仍手动**（Git 流水线不会跑迁移）：

```bash
npx dotenv -e ./cloudflare-worker/<your-instance>.env -- npm run db:migrate:remote
```

#### Dashboard 配置

**入口**：Dashboard → 对应 Worker → **Settings → Builds** → **Connect to Git**。Proxy 与 Admin **各绑一次**；Worker 名须与 `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME` 一致。

**通用设置**

| 项 | 值 |
|----|-----|
| **Root directory（根目录）** | **留空**（monorepo 根；`npm ci` / `gen:wrangler` 必须在仓库根执行） |
| **非生产分支构建** | 按需勾选 |

**构建 / 部署命令**

**勿**在 Deploy 填 `npm run deploy:proxy` / `npm run deploy:admin`——CI 已拆分 build 与 deploy；Deploy 再跑 `deploy:*` 会重复生成配置。

| Worker | Build command | Deploy command |
|--------|---------------|----------------|
| **Proxy** | `npm ci && npm run gen:wrangler` | `npm run deploy -w @octafuse/proxy` |
| **Admin** | `npm ci && npm run gen:wrangler && npm run build:cf -w @octafuse/admin` | `cd packages/admin && npx opennextjs-cloudflare deploy` |

- Build 阶段 `npm ci` → `postinstall` → `gen:wrangler` 读 **Build variables** 生成 `wrangler.jsonc`。
- **Admin**：`ADMIN_PASSWORD` 用 Worker **Secrets**（`npx wrangler secret put ADMIN_PASSWORD --name <ADMIN_WORKER_NAME>`），不是 Build variable。
- 可选 Build variable：`WRANGLER_SEND_METRICS=false`。

**Build variables**

| 变量 | 必填 | 说明 |
|------|------|------|
| `PROXY_WORKER_NAME` | Proxy Worker | 须与 Dashboard Worker 名一致 |
| `ADMIN_WORKER_NAME` | Admin Worker | 同上 |
| `D1_DATABASE_NAME` | ✅ | D1 逻辑名 |
| `D1_DATABASE_ID` | ✅ | `npx wrangler d1 list`；**只放 Dashboard，不进 Git** |
| `D1_MIGRATIONS_WORKER_NAME` | 可选 | 仅 D1 迁移脚本配置名 |
| `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` | 可选 | 写入 wrangler `routes`；不设则由 Dashboard 绑定域名 |

**Build watch paths**（**Settings → Builds → Build watch paths**；Exclude 留空）

Proxy — Include（一行粘贴）：

```
packages/proxy/*, packages/core/*, scripts/deploy/*, package.json, package-lock.json, patches/*
```

Admin — Include：

```
packages/admin/*, packages/core/*, scripts/deploy/*, package.json, package-lock.json, patches/*
```

改 `packages/core` 或根 `package.json` / `package-lock.json` 时两个 Worker 都会构建；改 `docs/` 等不在 Include 内的路径 **不会**触发构建。更多细节：[deployment-cloudflare.md §4](../docs/operators/deployment/cloudflare.md#4-workers-builds-connect-to-git)。

### 本地 CLI 发版（补充）

推荐（与 bootstrap 同一套实例 env）：

```bash
npm run deploy:cloudflare -- <your-instance> --migrate
npm run deploy:cloudflare -- <your-instance>
```

等价的手动命令：

```bash
npx dotenv -e ./cloudflare-worker/<your-instance>.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/<your-instance>.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/<your-instance>.env -- npm run deploy:admin
```

外部用户首次请用 [`npm run bootstrap:cloudflare`](../docs/operators/deployment/cloudflare-quickstart.md)。

## 环境变量说明

| 变量 | 说明 |
|------|------|
| `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME` | **须与 Dashboard Worker 名一致** |
| `D1_DATABASE_NAME` | D1 逻辑名 |
| `D1_DATABASE_ID` | 远程 deploy / migrate **必填**；proxy 与 admin **共用**。本地 CLI deploy 写入 wrangler 后，继续 `dev:proxy`/`dev:admin` 前须 `npm run gen:wrangler`（见 [local-testing-environments.md §1](../docs/developers/local-development.md#️-本地-d1-与-database_id远程-deploy-后必读)） |
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
