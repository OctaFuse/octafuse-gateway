# 线上部署：Cloudflare（代理服务 Worker + 管理后台 + D1）

本文说明 **octafuse-gateway** 在 Cloudflare 上的运维路径：**本地 D1 开发**、**dev 演示（octafuse.dev）**、**生产 Git 自动部署**。

**外部用户首次上云**（推荐）：[cloudflare-quickstart.md](./cloudflare-quickstart.md)（`npm run bootstrap:cloudflare`）。本页不替代该 quickstart。

实例 env 文件约定：[cloudflare-worker/README.md](../../../cloudflare-worker/README.md)。表结构以 **`packages/core/migrations-d1/`** 为准。Docker 自托管见 [docker.md](./docker.md)。

> 本仓库不以 Cloudflare Deploy Button 作为主路径：官方 Deploy Button 无法一次装齐 monorepo 双 Worker + 共享 D1。

---

## 0. 配置模型（必读）

| 文件 | 角色 |
|------|------|
| `packages/*/wrangler.base.jsonc`、`packages/core/wrangler.d1.base.jsonc` | **已提交模板**（无生产 `database_id`） |
| `packages/proxy/wrangler.jsonc`、`packages/admin/wrangler.jsonc`、`packages/core/wrangler.d1.jsonc` | **生成产物**（`npm run gen:wrangler`，gitignore） |
| `cloudflare-worker/example.env` | **dev 演示**配置（可提交） |
| `cloudflare-worker/*.env`（除 example） | **生产/私有**（gitignore）；或仅用 Cloudflare Dashboard **Build variables** |

**两种注入方式（变量名相同）**：

| 方式 | 何时用 |
|------|--------|
| **Cloudflare Build variables** | Workers Builds · `git push` 自动部署 |
| **`dotenv -e cloudflare-worker/xxx.env`** | 本地 CLI：`deploy:*`、`db:migrate:remote` |

`gen-wrangler` 只读 `process.env`，不读 Git 里的 env 文件（CI 构建时 Build variables 即 env）。

---

## 1. 本地 Cloudflare 开发

本机 Worker、不上线；步骤见 [users/quickstart.md](../../users/quickstart.md) §1。远程 deploy 后继续本地 dev 前须 `npm run gen:wrangler`，详见 [local-development.md §1](../../developers/local-development.md#️-本地-d1-与-database_id远程-deploy-后必读)。

---

## 2. dev 演示部署（example.env · octafuse.dev）

长期公共测试环境，配置见 [`cloudflare-worker/example.env`](../../../cloudflare-worker/example.env)：

| 角色 | 域名 | Worker |
|------|------|--------|
| 代理服务（Proxy） | `https://test-api.octafuse.dev` | `octafuse-gateway-proxy-dev` |
| 管理后台（Admin） | `https://test-admin.octafuse.dev` | `octafuse-gateway-admin-dev` |
| D1 | — | `octafuse-gateway-dev` |

**首次（CLI）**：

```bash
npx wrangler d1 create octafuse-gateway-dev
# 更新 example.env 中 D1_DATABASE_ID
npx dotenv -e ./cloudflare-worker/example.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:admin
```

dev 演示**仅 CLI 发版**（有新 SQL 时先 `db:migrate:remote`）；生产 Connect to Git 见下方 §4。

下游测试变量：`GATEWAY_URL` / `GATEWAY_MASTER_URL` / `GATEWAY_MASTER_KEY`（见 [integration.md](../../developers/integration.md)）。

---

## 3. 生产部署

**同一仓库代码、多实例**：每个 Worker 一套 **Build variables**；**勿**把生产 `D1_DATABASE_ID` 提交进 Git。

| 场景 | Worker / D1 命名 | 自定义域 |
|------|------------------|----------|
| 默认生产（示例） | `octafuse-gateway-proxy` / `-admin`，D1 `octafuse-gateway` | 常见为 Cloudflare Dashboard 绑定，wrangler 不写 `routes` |
| dev 演示 | `*-dev`，D1 `octafuse-gateway-dev` | `test-api.octafuse.dev` 等（见 `example.env`） |
| 自有 fork / 第二实例 | 自定 Worker 名与 D1 名，避免与同账号其它实例冲突 | 可选 `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN`（多个主机名逗号分隔） |

本地 CLI：复制 [`example.env`](../../../cloudflare-worker/example.env) 为 gitignore 的 `cloudflare-worker/<name>.env`，填生产值后 `dotenv -e ... deploy:*`（与 Build variables 同名同值）。首次也可直接用 [cloudflare-quickstart.md](./cloudflare-quickstart.md)。

### 环境变量（Build variables / 本地 `.env`）

| 变量 | 说明 |
|------|------|
| `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME` | **须与 Cloudflare Dashboard 中的 Worker 名一致** |
| `D1_DATABASE_NAME` | D1 逻辑名 |
| `D1_DATABASE_ID` | 远程 deploy / migrate **必填**。写入生成的 `wrangler.jsonc` 后，本机 `dev:proxy`/`dev:admin` 会连**另一套**本地 D1；继续本地开发前执行 `npm run gen:wrangler`（见 [local-development.md §1](../../developers/local-development.md#️-本地-d1-与-database_id远程-deploy-后必读)） |
| `D1_MIGRATIONS_WORKER_NAME` | 可选；仅 `wrangler d1 migrations` 配置名，**无需建 Worker** |
| `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` | 可选。多个主机名用逗号分隔，同一 Worker 挂多个入口 |

---

## 4. Workers Builds（Connect to Git）

Cloudflare Dashboard → Worker → **设置（Settings）→ 构建（Builds）**。Worker 名须与 `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME` 一致（[Workers name requirement](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/#workers-name-requirement)）。代理服务与管理后台 **各绑一次**。

### Cloudflare Dashboard 通用设置

| 项 | 值 |
|----|-----|
| **Root directory** | **留空**（monorepo 根；`npm ci` / `gen:wrangler` 必须在仓库根执行） |
| **非生产分支构建** | 按需勾选 |

### Build variables

在 **Build variables** 填入 §3 上表变量（代理服务 / 管理后台两个 Worker 各配一套；`D1_DATABASE_ID` 两边相同）。**生产 UUID 只放 Cloudflare Dashboard，不进 Git。**

| 变量 | 必填 | 说明 |
|------|------|------|
| `PROXY_WORKER_NAME` | 代理服务 Worker | 须与 Cloudflare Dashboard Worker 名一致 |
| `ADMIN_WORKER_NAME` | 管理后台 Worker | 同上 |
| `D1_DATABASE_NAME` | ✅ | D1 逻辑名 |
| `D1_DATABASE_ID` | ✅ | `npx wrangler d1 list`；**只放 Cloudflare Dashboard** |
| `D1_MIGRATIONS_WORKER_NAME` | 可选 | 仅迁移脚本配置名 |
| `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` | 可选 | 写入 wrangler `routes`。多个主机名用逗号分隔，同一 Worker 挂多个入口，例如 `api.example.com,relay.example.com`。各域名所在 zone 须在同一 Cloudflare 账号 |

### 构建 / 部署命令

**勿**在 Deploy 填 `npm run deploy:proxy` / `npm run deploy:admin`——CI 已拆分 build 与 deploy；Deploy 再跑 `deploy:*` 会重复生成配置。

| Worker | Build command | Deploy command |
|--------|---------------|----------------|
| **代理服务** | `npm ci && npm run gen:wrangler` | `npm run deploy -w @octafuse/proxy` |
| **管理后台** | `npm ci && npm run gen:wrangler && npm run build:cf -w @octafuse/admin` | `cd packages/admin && npx opennextjs-cloudflare deploy` |

说明：

- `npm ci` → `postinstall` → `gen:wrangler` 会读 **Build variables** 生成 `wrangler.jsonc`。
- **D1 迁移不在 Git 流水线**：有新 SQL 时手动 `npm run db:migrate:remote`（带实例 env 或 export 变量）后再 push。
- **管理后台**：`ADMIN_PASSWORD` 用 Worker **Secrets**（`npx wrangler secret put ADMIN_PASSWORD --name <ADMIN_WORKER_NAME>`）。
- 可选：`WRANGLER_SEND_METRICS=false`。

### Build watch paths（减少无关 push 触发部署）

Cloudflare Dashboard → **设置 → 构建 → Build watch paths**。默认 `includes: *` 表示**任意文件变更都会构建**；本仓为 monorepo，建议为 **代理服务 / 管理后台分别配置**，Exclude 留空。

判定规则（[Build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)）：先匹配 **Exclude**，再匹配 **Include**；push 中任一变更路径命中 Include 则构建，否则跳过。

**代理服务 — Include**（一行粘贴）：

```
packages/proxy/*, packages/core/*, scripts/deploy/*, package.json, package-lock.json
```

**管理后台 — Include**：

```
packages/admin/*, packages/core/*, scripts/deploy/*, package.json, package-lock.json
```

说明：

- 改 **`packages/core`** 或根 **`package.json` / `package-lock.json`** 时两个 Worker 都会构建。
- 仅改 **`packages/proxy`** → 只构建代理服务；仅改 **`packages/admin`** → 只构建管理后台。
- **`docs/`、`docker/`、`examples/`** 等不在 Include 内 → **不会**触发 Worker 构建。
- 改 **`packages/core/migrations-d1/`** 会触发构建，但 **不会**自动跑迁移；仍需本地 `db:migrate:remote`。
- 需要强制全量构建时：Cloudflare Dashboard 手动 **Retry deployment**，或 push 空 commit。

### 本地 CLI（与 CI 相同生成逻辑）

```bash
npm run deploy:cloudflare -- <instance> --migrate   # 推荐
# 或手动：
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run gen:wrangler -- --remote
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run deploy:admin
```

---

## 5. 首次创建 D1

```bash
npx wrangler login
npx wrangler d1 create octafuse-gateway-dev   # 或你的生产 D1 名
npx wrangler d1 list
```

将 **`D1_DATABASE_ID`** 写入 Build variables 或 gitignore 的 `cloudflare-worker/<name>.env`。外部首次上云优先用 [cloudflare-quickstart.md](./cloudflare-quickstart.md)（脚本会创建或复用 D1）。

---

## 6. 迁移与发布顺序

1. 有待执行迁移：`npx dotenv -e ./cloudflare-worker/<x>.env -- npm run db:migrate:remote`
2. `git push`（Workers Builds）或本地 `deploy:proxy` / `deploy:admin`

先迁移、再发依赖新 schema 的 Worker。

---

## 7. 认证与下游

- 管理 API 使用后台创建的具名 Admin API Key，并按资源权限授权（见 [api/admin.md](../../developers/api/admin.md)）。
- 下游门户：`GATEWAY_URL`（代理服务）、`GATEWAY_MASTER_URL`（管理后台）、`GATEWAY_MASTER_KEY`（见 [integration.md](../../developers/integration.md)）。

---

## 8. 健康检查

- 代理服务：`GET /health`
- 管理后台：首页、数据库 Session 登录，以及携带具名 Admin API Key（含 `config.read`）的 `GET /api/admin/config`
- D1 迁移：`npx wrangler d1 execute <name> --remote --config packages/core/wrangler.d1.jsonc --command 'SELECT COUNT(*) AS applied FROM d1_migrations;'`
- 日志：`npx wrangler tail`（Worker 名见 Build variables）

### Workers Free 的 3 MiB 体积限制

Cloudflare Workers Free 的单 Worker gzip 上限为 **3 MiB**。管理后台依赖 **`@opennextjs/cloudflare@1.19.4+`**（未使用 `ImageResponse` / `opengraph-image` 时不再误打包 `@vercel/og` / `resvg.wasm`）。部署输出的 `Total Upload ... gzip` 应低于套餐上限。若仍超限，检查是否误引入 OG 路由或过大依赖。若免费额度余量吃紧或流量上来，也推荐升级 [Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/)（约 $5/月）——量大管饱，性价比极高。

管理后台的 `wrangler.base.jsonc` 设置了 **`NEXT_PRIVATE_MINIMAL_MODE=1`**：本应用无 Next `middleware.ts`，用以避开 Workerd 上 `getMiddlewareManifest()` 动态 `require` 导致的全站 500（上游 [opennextjs-cloudflare#1232](https://github.com/opennextjs/opennextjs-cloudflare/issues/1232)）。若日后引入 middleware，需等上游正式修复后再去掉该变量。

---

## 9. 多实例与灰度

同一 Cloudflare 账号可跑多套 Worker（不同 `PROXY_WORKER_NAME` / `D1_DATABASE_ID`）。升级 **gen-wrangler** 或迁移流程时，建议：

1. 先在 **dev 演示**（`example.env` + CLI 发版）或 staging 验证变更。
2. 再更新生产 Worker 的 Build variables；必要时对生产 Worker **Pause Builds**，配好变量后再恢复。
3. 有新 D1 SQL：**先** `db:migrate:remote`（对应实例 env），**再**部署依赖新 schema 的 Worker。

### 回滚

Workers Builds 部署历史 **Rollback**；或 Pause Builds 后回滚版本。

自定义域：把 `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` 改回需要保留的主机名（例如从逗号列表改回单个），再重新 `deploy:proxy` / `deploy:admin`。未再列出的 Custom Domain 会从该 Worker 解绑。新域名若尚未对外公布，解绑无用户影响。

---

## 10. 下游 fork

若维护独立部署 fork，生产绑定（`D1_DATABASE_ID`、Worker 名、域名）应放在各 fork 的 **Build variables** 或 gitignore env 中，**勿**在 Git 里提交真实 `wrangler.jsonc`。merge upstream 时无需保留旧的 committed `database_id`。

---

**相关**：[cloudflare-worker/README.md](../../../cloudflare-worker/README.md) · [部署索引](./README.md) · [local-development.md](../../developers/local-development.md)
