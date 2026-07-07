# 线上部署：Cloudflare（Proxy Worker + Admin + D1）

本文说明 **octafuse-gateway** 在 Cloudflare 上的三种用法：**本地 D1 开发**、**dev 演示（octafuse.dev）**、**生产 Git 自动部署**。

**快速入口**：[cloudflare-worker/README.md](../../cloudflare-worker/README.md)（路径速查 + 命令清单）。

表结构以 **`packages/core/migrations-d1/`** 为准。Docker 自托管见 [deployment-docker.md](./deployment-docker.md)。

---

## 0. 配置模型（必读）

| 文件 | 角色 |
|------|------|
| `packages/*/wrangler.base.jsonc`、`packages/core/wrangler.d1.base.jsonc` | **已提交模板**（无生产 `database_id`） |
| `packages/proxy/wrangler.jsonc`、`packages/admin/wrangler.jsonc`、`packages/core/wrangler.d1.jsonc` | **生成产物**（`npm run gen:wrangler`，gitignore） |
| `cloudflare-worker/example.env` | **dev 演示**配置（可提交） |
| `cloudflare-worker/*.env`（除 example） | **生产/私有**（gitignore）；或仅用 Dashboard **Build variables** |

**两种注入方式（变量名相同）**：

| 方式 | 何时用 |
|------|--------|
| **Cloudflare Build variables** | Workers Builds · `git push` 自动部署 |
| **`dotenv -e cloudflare-worker/xxx.env`** | 本地 CLI：`deploy:*`、`db:migrate:remote` |

`gen-wrangler` 只读 `process.env`，不读 Git 里的 env 文件（CI 构建时 Build variables 即 env）。

---

## 1. 本地 Cloudflare 开发

目标：本机 Worker，**不**部署到 Cloudflare，D1 在 `.wrangler/state`。

```bash
npm install
npm run db:migrate
npm run dev:proxy    # :8787
npm run dev:admin    # :8789
```

- `postinstall` 已跑 `gen:wrangler`（无 `D1_DATABASE_ID` 即可）。
- **不需要** `cloudflare-worker/*.env`。
- 详见 [local-testing-environments.md](./local-testing-environments.md) §1–2。

---

## 2. dev 演示部署（example.env · octafuse.dev）

长期公共测试环境，配置见 [`cloudflare-worker/example.env`](../../cloudflare-worker/example.env)：

| 角色 | 域名 | Worker |
|------|------|--------|
| Proxy | `https://test-api.octafuse.dev` | `octafuse-gateway-proxy-dev` |
| Admin | `https://test-admin.octafuse.dev` | `octafuse-gateway-admin-dev` |
| D1 | — | `octafuse-gateway-dev` |

**首次（CLI）**：

```bash
npx wrangler d1 create octafuse-gateway-dev
# 更新 example.env 中 D1_DATABASE_ID
npx dotenv -e ./cloudflare-worker/example.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:admin
```

**后续 Git 自动部署**：两个 `-dev` Worker 的 **Build variables** 与 `example.env` 对齐 → `git push`。步骤见 [cloudflare-worker/README.md §B](../../cloudflare-worker/README.md#b-dev-演示远程-octafusedev)。

---

## 3. 生产部署

**同一仓库代码、多实例**：每个 Worker 一套 **Build variables**；**勿**把生产 `D1_DATABASE_ID` 提交进 Git。

| 场景 | Worker / D1 命名 | 自定义域 |
|------|------------------|----------|
| 默认生产（示例） | `octafuse-gateway-proxy` / `-admin`，D1 `octafuse-gateway` | 常见为 Dashboard 绑定，wrangler 不写 `routes` |
| dev 演示 | `*-dev`，D1 `octafuse-gateway-dev` | `test-api.octafuse.dev` 等（见 `example.env`） |
| 自有 fork / 第二实例 | 自定 Worker 名与 D1 名，避免与同账号其它实例冲突 | 可选 `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` |

本地 CLI：复制 [`example.env`](../../cloudflare-worker/example.env) 为 gitignore 的 `cloudflare-worker/<name>.env`，填生产值后 `dotenv -e ... deploy:*`（与 Build variables 同名同值）。

### 环境变量（Build variables / 本地 `.env`）

| 变量 | 说明 |
|------|------|
| `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME` | **须与 Dashboard Worker 名一致** |
| `D1_DATABASE_NAME` | D1 逻辑名 |
| `D1_DATABASE_ID` | 远程 deploy / migrate **必填** |
| `D1_MIGRATIONS_WORKER_NAME` | 可选；仅 `wrangler d1 migrations` 配置名，**无需建 Worker** |
| `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` | 可选 |

---

## 4. Workers Builds（Connect to Git）

Dashboard → Worker → **Settings → Builds**。Worker 名须与 `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME` 一致（[Workers name requirement](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/#workers-name-requirement)）。

### Build variables

在 **Build variables** 填入上表变量（proxy / admin 两个 Worker 各配一套；`D1_DATABASE_ID` 两边相同）。**生产 UUID 只放 Dashboard，不进 Git。**

### 构建 / 部署命令

Root directory 与 monorepo 根 `cd ../..` 示例：

| Worker | Root directory | Build command | Deploy command |
|--------|----------------|---------------|----------------|
| **Proxy** | `packages/proxy` | `cd ../.. && npm ci && npm run gen:wrangler` | `npx wrangler deploy` |
| **Admin** | `packages/admin` | `cd ../.. && npm ci && npm run gen:wrangler && cd packages/admin && npm run build:cf` | `npx opennextjs-cloudflare deploy` |

说明：

- `npm ci` → `postinstall` → `gen:wrangler` 会读 **Build variables** 生成 `wrangler.jsonc`。
- **D1 迁移不在 Git 流水线**：有新 SQL 时手动 `npm run db:migrate:remote`（带实例 env 或 export 变量）后再 push。
- **Admin**：`ADMIN_PASSWORD` 用 Worker **Secrets**。
- 可选：`WRANGLER_SEND_METRICS=false`。

### 本地 CLI（与 CI 相同生成逻辑）

```bash
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

将 **`D1_DATABASE_ID`** 写入 Build variables 或 gitignore 的 `cloudflare-worker/<name>.env`。

---

## 6. 迁移与发布顺序

1. 有待执行迁移：`npx dotenv -e ./cloudflare-worker/<x>.env -- npm run db:migrate:remote`
2. `git push`（Workers Builds）或本地 `deploy:proxy` / `deploy:admin`

先迁移、再发依赖新 schema 的 Worker。

---

## 7. 认证与下游

- 管理 API Bearer 须与 D1 **`system_config.MASTER_KEY`** 一致（见 [api/admin.md](../api/admin.md)）。
- 下游门户：`GATEWAY_URL`（Proxy）、`GATEWAY_MASTER_URL`（Admin）、`GATEWAY_MASTER_KEY`。

---

## 8. 健康检查

- Proxy：`GET /health`
- 日志：`npx wrangler tail`（Worker 名见 Build variables）

---

## 9. 多实例与灰度

同一 Cloudflare 账号可跑多套 Worker（不同 `PROXY_WORKER_NAME` / `D1_DATABASE_ID`）。升级 **gen-wrangler** 或迁移流程时，建议：

1. 先在 **dev 演示**（`example.env`）或 **staging Worker** 验证 Build variables + `git push`。
2. 再更新生产 Worker 的 Build variables；必要时对生产 Worker **Pause Builds**，配好变量后再恢复。
3. 有新 D1 SQL：**先** `db:migrate:remote`（对应实例 env），**再**部署依赖新 schema 的 Worker。

### 回滚

Workers Builds 部署历史 **Rollback**；或 Pause Builds 后回滚版本。

---

## 10. 下游 fork

若维护独立部署 fork，生产绑定（`D1_DATABASE_ID`、Worker 名、域名）应放在各 fork 的 **Build variables** 或 gitignore env 中，**勿**在 Git 里提交真实 `wrangler.jsonc`。merge upstream 时无需保留旧的 committed `database_id`。

---

**相关**：[cloudflare-worker/README.md](../../cloudflare-worker/README.md) · [部署索引](./deployment.md) · [本地测试](./local-testing-environments.md)
