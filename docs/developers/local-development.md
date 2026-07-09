# 本地开发与测试：Octafuse

本文说明如何在本地组合 **Proxy Worker**、**Admin（OpenNext）** 与 **D1**，以及可选 **Node + Postgres** 或 **Node + MySQL**。整体「运行时 × 数据库」矩阵见 **[architecture/runtime-data.md](./architecture/runtime-data.md)**。

**Cloudflare 本地开发 vs 远程部署**：本文件 §1–2 为**本机 D1**（不上线）。远程 dev 演示、生产 Git 部署见 **[cloudflare-worker/README.md](../../cloudflare-worker/README.md)**。

## 拓扑模式（本地/部署一致口径）

| 模式 | Proxy | Admin | 数据库 |
|------|------|------|------|
| Cloudflare 全托管（默认） | Worker (`npm run dev:proxy`) | OpenNext preview (`npm run dev:admin`) | D1 |
| Hybrid | Node (`npm run dev:proxy:node`) | OpenNext preview (`npm run dev:admin`) | Proxy=Postgres，Admin=D1 |
| Full self-hosted PG | Node (`npm run dev:proxy:node`) | Node（`npm run dev:admin:node`，:8789） | Postgres |
| Full self-hosted MySQL | Node + **`DATABASE_DRIVER=mysql`** | Node + **`DATABASE_DRIVER=mysql`** | MySQL 8 |

> 说明：当前仓库默认开发路径仍是 Cloudflare + D1。若要演练 Full self-hosted PG，请确保 Admin 运行时已按你们环境接入同一 Postgres。

## 0. 环境变量模板

复制仓库根 [`.env.example`](../../.env.example) → **`.env`**，按注释取消注释所需段落；可选新建 **`.env.local`** 覆盖本机值（模板见该文件顶部「Optional local override」段落）。Node + Postgres：`DATABASE_URL` 必填；**`DATABASE_DRIVER`** 由 **`@octafuse/core`** 解析，**`dev:proxy:node`** 与 **`dev:admin:node`** 规则一致（可省略，默认 `postgres`）。Admin Node 另需 **`ADMIN_USERNAME` / `ADMIN_PASSWORD`**。

## 1. 默认：Proxy + 本地 D1

仓库根目录：

- **持久化**：`./.wrangler/state`（与根脚本中 `--persist-to` 保持一致）。
- **D1 逻辑库名**：默认 `octafuse-gateway`（`npm install` / `postinstall` 会通过 `gen:wrangler` 生成 `packages/proxy/wrangler.jsonc`；模板见 `wrangler.base.jsonc`）。

```bash
npm install
npm run db:migrate
npm run dev:proxy    # http://127.0.0.1:8787
```

管理类 HTTP **不在**该端口上；需要管理 API 或 UI 时使用下文第 2 节 Admin。

用户推理接口的 `Authorization: Bearer` 使用库内 `sk-…`；管理密钥与 D1 **`system_config.MASTER_KEY`** 一致（开发种子见 `packages/core/migrations-d1/0002_seed.sql`）。

### ⚠️ 本地 D1 与 `database_id`（远程 deploy 后必读）

`db:migrate`、`dev:proxy`、`dev:admin` **共用同一 persist 目录**（`./.wrangler/state`），但 Wrangler 还会按生成后的 `wrangler.jsonc` 是否包含 **`database_id`**，在 persist 目录下选择**不同的本地 SQLite 文件**：

| `wrangler.jsonc` | 本地 D1 标识（wrangler 日志） | 典型场景 |
|------------------|-------------------------------|----------|
| **无** `database_id` | `octafuse-gateway (DB)` | 纯本地开发；`npm run db:migrate` 迁移的是这套 |
| **有** `database_id` | `octafuse-gateway (<UUID>)` | 执行过 `deploy:*` / `db:migrate:remote`（带 `cloudflare-worker/*.env`）之后 |

因此会出现：**迁移已成功，但 dev 里看不到数据**（或 provider 数量对不上）——不是路径错了，而是 **migrate 与 dev 读到了两套本地 D1**。

**常见触发**：在本机跑完

```bash
./cloudflare-worker/deploy-soloent.sh --migrate   # 或任意 dotenv + deploy:proxy / db:migrate:remote
```

之后未切回本地配置，直接 `npm run dev:proxy` / `dev:admin`。远程 deploy 会通过 `gen:wrangler --remote` 把 **`D1_DATABASE_ID` 写入** gitignore 的 `packages/proxy/wrangler.jsonc`、`packages/admin/wrangler.jsonc`、`packages/core/wrangler.d1.jsonc`。

**切回本地开发（方案 A）**——在仓库根、且 shell **未** export `D1_DATABASE_ID` 时：

```bash
npm run gen:wrangler    # 重新生成本地 wrangler（无 database_id）
npm run db:migrate      # 可选：确保 (DB) 这套迁移最新；内部也会先 gen:wrangler
# 停掉旧 dev 进程后重启
npm run dev:proxy
npm run dev:admin
```

**自检**（有输出则说明 dev 会连 `(UUID)` 那套，而不是 `db:migrate` 默认那套）：

```bash
grep database_id packages/proxy/wrangler.jsonc || echo "OK: 本地 D1 (DB)"
```

**注意**：若根 `.env.local` 配置了 `DATABASE_URL`，`dev:proxy:node` / `dev:admin:node` 走 **Postgres**，与 `db:migrate`（D1）不是同一库；见下文 §5。

### Wrangler 与环境变量文件

- 若存在根目录 **`.dev.vars`**，Wrangler 会优先于 `.env` / `.env.local`。
- 无 `.dev.vars` 时，Wrangler 可从 **`.env` / `.env.local`** 加载变量（取决于当前 Wrangler 版本与 `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV`）。

## 2. Admin（含 D1 的管理 API）

推荐在本地用 **OpenNext preview**（与生产一致、带 D1）：

```bash
npm run dev:admin
# 等价于在 packages/admin 执行：build:cf 后 preview，:8789，--persist-to ../../.wrangler/state
```

仅改 UI、不需要 D1 时：

```bash
cd packages/admin
npm run dev    # :3000，/api/admin/* 会因无 DB 返回 500
```

## 3. 多套本地 D1：换 `--persist-to` 目录

与 §1 中 **`database_id` 分裂**不同：这里是**故意**用另一个 persist 目录隔离数据。换目录即换一套本地 SQLite；迁移与 dev 必须使用**相同**的 `--persist-to`。

示例（在根目录手动调用 wrangler，路径自定）：

```bash
npm run db:migrate   # 内部：gen:wrangler + wrangler d1 migrations apply --local
# 或手动（须与 npm run db:migrate 使用相同 persist 路径）：
# npm run gen:wrangler && node scripts/deploy/wrangler-d1-cli.mjs migrations apply --local --persist-to ./.wrangler/state-alt
npx wrangler dev --config packages/proxy/wrangler.jsonc --port 8787 --persist-to ./.wrangler/state-alt
```

## 4. 远程 D1

```bash
# 远程须 D1_DATABASE_ID（cloudflare-worker/*.env 或环境变量）
npx dotenv -e ./cloudflare-worker/<name>.env -- npm run db:migrate:remote
```

仅在有明确变更窗口时执行；查询优先只读 SQL，避免误写生产数据。

## 5. 可选：Node + Postgres（Proxy）

Cloudflare Worker **只连 D1**。Postgres 路径使用 **`packages/proxy`** 内 Node 入口（与 Worker 共用 `createProxyApp`，**不包含 `/admin`**）。

**推荐（在仓库根维护一份 `.env`）**：

```bash
cp .env.example .env   # 取消注释 DATABASE_URL；DATABASE_DRIVER 可省略（默认 postgres）
npm run db:migrate:pg   # 首次迁移（种子键由 `0002_seed.sql` 写入）
npm run dev:proxy:node   # 等价于先 dotenv 加载根 .env，再执行 proxy 的 dev:node
```

**或**在 **`packages/proxy`** 目录放置 `.env`（可复制 [`packages/proxy/.env.example`](../../packages/proxy/.env.example)），然后：

```bash
cd packages/proxy
npm run dev:node
```

Postgres schema 迁移：SQL 位于 **`packages/core/migrations-postgres/`**（与 D1 的 `packages/core/migrations-d1/` 并列），在仓库根执行 **`npm run db:migrate:pg`**（实现为 **`packages/core/src/migrate/cli.ts`** → `migrate/postgres.ts`）。

### 5.1 Full self-hosted PG：Admin 走 Node + Postgres

当你需要验证 **Proxy + Admin 全栈都走 PG**（不依赖 D1）时，在第二个终端启动 Admin（推荐根 `.env` 已配置 `DATABASE_URL` 与 `ADMIN_*`）：

```bash
npm run dev:admin:node   # 等价：dotenv 加载根 .env 后执行 packages/admin 的 dev:node（:8789）
```

或在本包：`cd packages/admin && npm run dev:node`（需本目录 `.env` 或 `ln -s ../../.env .env`）。

随后可用 Bearer（`system_config.MASTER_KEY`）直连验证：

```bash
curl -sS http://127.0.0.1:8789/api/admin/config \
  -H 'Authorization: Bearer sk-dev-admin-key'
```

## 6. Docker 本地样例（Node + PG，双容器）

### 6.1 用仓库根目录 `Dockerfile.*` 构建并启动（推荐）

根目录构建 **gateway-proxy** 与 **gateway-admin** 两个镜像，并与 Postgres 一起编排：

```bash
docker compose -f docker/compose/node-pg.yml up -d postgres
docker compose -f docker/compose/node-pg.yml --profile migrate run --rm migrate
docker compose -f docker/compose/node-pg.yml up -d gateway-proxy gateway-admin
```

若本机 **`8787` / `8789`** 已被占用，可改映射到其它主机端口（容器内端口不变），例如：

```bash
GATEWAY_PROXY_HOST_PORT=28787 GATEWAY_ADMIN_HOST_PORT=28789 \
  docker compose -f docker/compose/node-pg.yml up -d gateway-proxy gateway-admin
```

等价地可先手动构建镜像：

```bash
docker build -f Dockerfile.proxy -t octafuse-proxy:local .
docker build -f Dockerfile.admin -t octafuse-admin:local .
```

### 6.2 Docker：Node + MySQL（双容器，本地构建镜像）

**`docker/compose/node-mysql.yml`** 内置 **MySQL 8.4** 与 **`db:migrate:mysql:docker`** 流程（须先 migrate 再起应用）：

```bash
docker compose -f docker/compose/node-mysql.yml up -d mysql
docker compose -f docker/compose/node-mysql.yml --profile migrate run --rm migrate
docker compose -f docker/compose/node-mysql.yml up -d gateway-proxy gateway-admin
```

预构建镜像示例已收敛为外置 Postgres 的 proxy/admin 独立部署；MySQL 场景保留根目录本地构建编排。

### 6.3 用预构建镜像（GHCR、自建 Harbor 或任意私有 registry）

从第二私有 registry（自建 Harbor 等）拉取时，在 `docker/examples/env.*.example` 中按对应注释将 `GATEWAY_*_IMAGE` 改为 `registry.example.com/<namespace>/octafuse-gateway-{proxy,admin,migrate}:v1.0.0` 形态（见 [deployment-docker.md](../operators/deployment/docker.md) §4.2），再按需改 tag。

```bash
cd docker/examples
cp env.compose.external.example .env.gateway
# 编辑 GATEWAY_PROXY_IMAGE、GATEWAY_ADMIN_IMAGE、GATEWAY_MIGRATE_IMAGE、DATABASE_URL、ADMIN_PASSWORD 等
docker compose --env-file .env.gateway -f gateway.proxy.yml -f gateway.admin.yml --profile migrate run --rm migrate
docker compose --env-file .env.gateway -f gateway.proxy.yml -f gateway.admin.yml up -d
```

常用诊断：在配置好 `DATABASE_URL` 后可用 `npm run db:list:pg` 或 `npx tsx scripts/db/diag/list-pg-databases.ts`（于**仓库根**执行）核对库名与主机。

### 6.4 Full self-hosted PG（不用 Docker：本机双进程）

不跑 Compose 时，可分别用 Node 起 Proxy 与 Admin（同一 `DATABASE_URL`），见上文第 5 节与 [deployment-docker.md](../operators/deployment/docker.md) §6。

## 7. 与外部集成方联调

- **用户推理**：`GATEWAY_URL=http://127.0.0.1:8787`（Proxy）。
- **管理 API**：`GATEWAY_MASTER_URL=http://127.0.0.1:8789`（或你本地 Admin preview 的 origin），路径 **`/api/admin/...`**；`GATEWAY_MASTER_KEY` 与 D1 `MASTER_KEY` 一致。

## 8. 冒烟脚本

`scripts/smoke/` 下为 **HTTP 核心链路**冒烟（`npm run test:gateway:node-smoke` / `test:gateway:postgres-smoke`，需已启动 Node **Proxy** / **Admin**）以及 **`@octafuse/core`** 关键写路径 mock 单测（`npx tsx --test scripts/smoke/test-critical-write-paths.ts`）。说明见 [scripts/smoke/README.md](../../scripts/smoke/README.md)。协议级手工回归请用 curl 或自有客户端，不再随仓附带官方 SDK 示例脚本。

---

**相关文档**：[Cloudflare 部署](../operators/deployment/cloudflare.md) · [API 总览](./api/README.md)
