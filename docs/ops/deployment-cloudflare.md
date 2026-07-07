# 线上部署：Cloudflare（Proxy Worker + Admin + D1）

本文说明在 **Cloudflare** 上部署 **octafuse-gateway**：**Proxy Worker**、**Admin（OpenNext on Workers）** 与共享 **D1** 数据库。表结构以 **`packages/core/migrations-d1/`** 为准。

**持续交付**：推荐 **Workers Builds（Connect to Git）**——`git push` 触发构建与部署；实例差异（Worker 名、D1、`routes`）通过每个 Worker 的 **Build variables** 注入，**不在 Git 中提交真实 `database_id`**。

不使用 D1 时改走 Docker 自托管，见 [deployment-docker.md](./deployment-docker.md)。

---

## 1. 配置模型（模板 + 环境变量）

| 文件 | 角色 |
|------|------|
| `packages/*/wrangler.base.jsonc`、`packages/core/wrangler.d1.base.jsonc` | **已提交模板**（无真实 `database_id` / 生产 `routes`） |
| `packages/proxy/wrangler.jsonc`、`packages/admin/wrangler.jsonc`、`packages/core/wrangler.d1.jsonc` | **生成产物**（`npm run gen:wrangler`，已 gitignore） |

构建/部署前执行 `npm run gen:wrangler`（`postinstall` 也会为本地 dev 生成无 `database_id` 的配置）。远程部署/迁移须带 `--remote` 且设置 **`D1_DATABASE_ID`**。

```bash
# 本地开发（postinstall 已生成，或手动）
npm run gen:wrangler

# 远程部署 / 迁移（须 D1_DATABASE_ID）
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run gen:wrangler -- --remote
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run deploy:admin
```

实例变量清单见 [`cloudflare-worker/example.env`](../../cloudflare-worker/example.env)。

---

## 2. 环境变量（Build variables 或 `cloudflare-worker/*.env`）

| 变量 | 说明 |
|------|------|
| `CF_INSTANCE` | 可选实例后缀（如 `octarouter`）；留空则用 `octafuse-gateway-*` 基础名 |
| `PROXY_WORKER_NAME` | Proxy Worker 名，**须与 Dashboard 中连接的 Worker 名一致** |
| `ADMIN_WORKER_NAME` | Admin Worker 名，同上 |
| `D1_DATABASE_NAME` | D1 逻辑名；默认 `octafuse-gateway[-CF_INSTANCE]` |
| `D1_DATABASE_ID` | 远程部署/迁移**必填**；proxy 与 admin **共用同一 UUID** |
| `D1_MIGRATIONS_WORKER_NAME` | 可选；默认 `octafuse-d1-migrations[-CF_INSTANCE]` |
| `PROXY_CUSTOM_DOMAIN` | 可选；设置则写入 `routes`（如 `api.example.com`） |
| `ADMIN_CUSTOM_DOMAIN` | 可选；Admin 自定义域 |

**同账号多实例示例**（完整值见 `cloudflare-worker/example.env`）：

| 实例 | PROXY_WORKER_NAME | D1_DATABASE_NAME | 自定义域 |
|------|-------------------|------------------|----------|
| **dev 演示**（[`cloudflare-worker/example.env`](../../cloudflare-worker/example.env)） | `octafuse-gateway-proxy-dev` | `octafuse-gateway-dev` | `api.octafuse.dev` / `gateway-admin.octafuse.dev` |
| soloent（octafuse-gateway 仓） | `octafuse-gateway-proxy` | `octafuse-gateway` | 不设（域由 Dashboard 管理） |
| octarouter（fork 仓） | `octarouter-gateway-proxy` | `octarouter-gateway` | `PROXY_CUSTOM_DOMAIN=api.octarouter.com` 等 |

---

## 3. 首次创建 D1

```bash
npx wrangler login
npx wrangler d1 create octafuse-gateway   # 或 octarouter-gateway 等
npx wrangler d1 list                      # 复制 database_id
```

将 **`D1_DATABASE_ID`** 写入该实例的 Build variables 或 `cloudflare-worker/<name>.env`，**勿**再手改三份 wrangler 文件。

---

## 4. Workers Builds（Connect to Git）

Dashboard → 对应 Worker → **Settings** → **Builds**。Worker 名须与生成配置中的 `name` 一致，否则构建失败（[Workers name requirement](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/#workers-name-requirement)）。

### Build variables（每个 Worker 单独配置）

在 **Build variables** 中设置上表变量（proxy/admin 共用同一 `D1_DATABASE_ID`；admin Worker 只需 `ADMIN_*` + D1 变量，proxy 只需 `PROXY_*` + D1 变量——为简单起见两边可配全套）。

### 构建 / 部署命令

Root directory 与命令示例（`cd ../..` 回到 monorepo 根以执行 `gen:wrangler`）：

| Worker | Root directory | Build command | Deploy command |
|--------|----------------|---------------|----------------|
| **Proxy** | `packages/proxy` | `cd ../.. && npm ci && npm run gen:wrangler` | `npx wrangler deploy` |
| **Admin** | `packages/admin` | `cd ../.. && npm ci && npm run gen:wrangler && cd packages/admin && npm run build:cf` | `npx opennextjs-cloudflare deploy` |

**说明**：

- Build variables 在 **`npm ci` → `postinstall` → `gen:wrangler`** 时生效；Build command 中显式再跑 `gen:wrangler` 亦可（远程 deploy 若需 `--remote`，Build variables 已含 `D1_DATABASE_ID` 时普通 `gen:wrangler` 即可——仅 `deploy:*` / `db:migrate:remote` npm 脚本才加 `--remote` 校验）。
- **D1 迁移不在自动部署流水线中**（保持现状）：有新 SQL 时本地/CI 手动 `npm run db:migrate:remote` 后再 push。
- **Admin**：`ADMIN_PASSWORD` 用 Worker **Secrets**，勿写入 Git。
- CI 非交互：可设 `WRANGLER_SEND_METRICS=false`。

---

## 5. 迁移与发布顺序

1. 有待执行迁移：`npx dotenv -e ./cloudflare-worker/<x>.env -- npm run db:migrate:remote`
2. `git push` 触发 Workers Builds，或本地：`npm run deploy:proxy` / `deploy:admin`（须先 `gen:wrangler --remote`）

先迁移、再发依赖新 schema 的 Worker。

---

## 6. `MASTER_KEY` 与 Admin 认证

- 管理接口 Bearer 须与 D1 **`system_config.MASTER_KEY`** 一致（从库读，不以 Worker Secret 为准）。
- 首次上线后应轮换 `MASTER_KEY`，并同步下游 **`GATEWAY_MASTER_KEY`**（见 [api/admin.md](../api/admin.md)）。

---

## 7. 下游环境变量

| 变量 | 说明 |
|------|------|
| `GATEWAY_URL` | Proxy 根 URL |
| `GATEWAY_MASTER_URL` | Admin 根 URL；`/api/admin/*` |
| `GATEWAY_MASTER_KEY` | 与 D1 `MASTER_KEY` 一致 |

---

## 8. 健康检查与观测

- Proxy：`GET /health`
- 日志：`npx wrangler tail`（Worker 名见 Build variables 中的 `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME`）

---

## 9. 灰度切换（soloent + octarouter 同账号）

推荐顺序：**先 octarouter fork，验证通过后再 soloent**，避免影响 soloent 生产。

### 阶段 A：octarouter（octarouter-gateway 仓）

1. 从 upstream `octafuse-gateway` merge 含本改造的提交。
2. 为 **octarouter-gateway-proxy** / **octarouter-gateway-admin** 配置 Build variables（见 `cloudflare-worker/example.env` 中 octarouter 示例）。
3. 更新 Build command（§4），Deploy command 保持不变。
4. Push → 验证构建成功、`GET /health`、Admin 登录、`api.octarouter.com` / `gateway-admin.octarouter.com`。

### 阶段 B：soloent（octafuse-gateway 仓）

1. **`wrangler d1 list` 确认 soloent 生产 `D1_DATABASE_ID`**（勿用占位 UUID）。
2. 为 **octafuse-gateway-proxy** / **octafuse-gateway-admin** 配置 Build variables（无 custom domain 变量）。
3. 更新 Build command，Push 验证。

### 回滚

- Workers Builds 部署历史可回滚到上一版本；或临时恢复旧版 committed wrangler 配置（不推荐长期使用）。

---

## 10. Fork 同步（octarouter-gateway）

改造后 **无需**在 merge 时保留三份 `wrangler.jsonc` 的 `merge=ours`；同步 upstream 时只跟源码与 `migrations-d1/`，生产绑定留在 Cloudflare Build variables。详见 [octarouter-gateway/SYNC_UPSTREAM.md](https://github.com/OctaFuse/octarouter-gateway/blob/main/SYNC_UPSTREAM.md)。

---

**相关文档**：[部署索引](./deployment.md) · [本地测试](./local-testing-environments.md) · [Admin API](../api/admin.md)
