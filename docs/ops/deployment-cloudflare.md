# 线上部署：Cloudflare（Proxy Worker + Admin Pages + D1）

本文描述在 **Cloudflare** 上部署 **octafuse**：优先 **§0 Connect to Git**（免本机 `wrangler`）；亦可使用 **§2 本机 `npm run deploy:*`**。数据面为 **D1**；表结构以 **`packages/core/migrations-d1/`** 为准。与 **`your-portal`** 的环境变量对齐见后文。

**生产典型对外域名（海外）**：Proxy **`https://gateway.example.com`**，Admin **`https://gateway-admin.example.com`**（DNS 与证书在 Cloudflare 控制台配置；门户侧 **`GATEWAY_URL` / `GATEWAY_MASTER_URL`** 与之一致）。中国境内等自托管 Docker 部署见 [deployment-docker.md](./deployment-docker.md) 与 [docker/deploy/README.md](../../docker/deploy/README.md)；Nginx 流式反代见 [docker/examples/nginx/](../../docker/examples/nginx/)。

## 0. Connect to Git（推荐：免本机 `wrangler`）

在 Cloudflare 控制台将 **Git 仓库** 关联到 **Workers**（或等价「从 Git 构建并部署」能力）后，每次推送即可触发构建与部署；**D1 绑定名 `DB`、环境变量与 Secrets** 在 Worker 的 **Settings** 中配置，可覆盖 `packages/*/wrangler.jsonc` 中的占位 `database_id`（与 Dashboard 绑定一致即可）。

**Fork 本仓**（或导入为自有 Git 远程），在同一 Cloudflare 账号下创建 **D1** 数据库（逻辑名 **`octafuse-gateway`**），再创建 **两个** Worker 项目并分别关联该仓库，按下表设置 **Root directory** 与 **Build command**（构建环境需能执行 `npm ci`，且已配置 `wrangler` 所需的账号凭证；Cloudflare 侧通常已注入）。

| Worker | Root directory | Build command（示例） | 控制台配置要点 |
|--------|----------------|----------------------|----------------|
| **Proxy** | `packages/proxy` | `cd ../.. && npm ci && cd packages/proxy && npx wrangler deploy` | **Settings → Variables → D1 database bindings**：绑定名 **`DB`**，指向目标 D1 实例。 |
| **Admin** | `packages/admin` | `cd ../.. && npm ci && cd packages/admin && npm run build:cf && npx wrangler deploy`（若需每次部署前迁移，见 §0.1） | 同上绑定 **`DB`**（与 Proxy **同一** D1）。**Variables**：`ADMIN_USERNAME`（如 `admin`）。**Secrets**：`ADMIN_PASSWORD`（控制台登录密码，勿提交进 Git）。 |

**Admin OpenNext 构建耗时**较长；若 Workers 免费套餐或默认构建超时，可改用下文「本机 wrangler 路径」部署 Admin，或升级具备更长构建时间的计划 / 使用自建 CI（如 GitHub Actions）在本机构建后仅上传产物。

### 0.1 D1 远程迁移（Connect to Git / CI）

远程 D1 的 schema 须先于（或至少不晚于）依赖新表结构的 Worker 上线。任选其一：

1. **在 Admin Worker 的 Build command 前追加迁移（幂等）**（每次部署都会执行一次 `apply`，无待执行迁移时开销较小）。**Root directory** 设为 `packages/admin` 时，构建起始目录即该目录，首行 `cd ../..` 进入仓库根：

   ```bash
   cd ../.. && npm ci && npx wrangler d1 migrations apply octafuse-gateway --config ./packages/core/wrangler.d1.jsonc --remote && cd packages/admin && npm run build:cf && npx wrangler deploy
   ```

2. **本机一次性迁移**（与下节「本机 wrangler 路径」一致）：仓库根执行 `npm run db:migrate:remote`（需已 `npx wrangler login` 且 `packages/core/wrangler.d1.jsonc` 中 `database_id` 与远程 D1 一致，或由 CLI 指定远程库）。

3. **可选：自建 GitHub Actions**（`workflow_dispatch`，仅执行 `npm ci` + `wrangler d1 migrations apply … --remote`），与业务 Worker 的 Connect to Git 解耦；便于审计与限权。本仓库未内置该 workflow 时，可自行拷贝 [deployment-docker.md](./deployment-docker.md) 中 CI 凭证管理思路维护。

> **套餐与超时**：Workers 免费档对单次构建时长与资源有限制；Admin 的 `npm run build:cf`（OpenNext）较重，若构建失败或超时，优先改用 §2 本机 `npm run deploy:admin`，或升级具备更长构建时间的计划 / 自建 CI 完成构建后再 `wrangler deploy`。

### 0.2 升级须知（`ADMIN_PASSWORD` 不再写入 `wrangler.jsonc`）

自移除 `packages/admin/wrangler.jsonc` 中的默认 `ADMIN_PASSWORD` 后：**若生产环境从未在 Dashboard / Secret 中设置 `ADMIN_PASSWORD`**，下一次 Admin Worker 部署后将不再有控制台登录密码。升级前请在 Cloudflare **Worker → Settings → Secrets** 添加 **`ADMIN_PASSWORD`**，或在本机对该项目执行：

```bash
cd packages/admin
npx wrangler secret put ADMIN_PASSWORD
```

## 1. 前置条件（本机 `wrangler` / `npm run deploy:*`）

若**仅**使用 **§0 Connect to Git** 并在 Cloudflare 控制台完成 D1 绑定与 Secrets，可不执行本节的本地 `npm install` / `wrangler login`；以下面向在**本机**或自建 CI 中调用 `wrangler` 的路径。

- 已 `npm install`（仓库根）。
- 已 `npx wrangler login`。
- 在目标账号下创建 D1 数据库 **`octafuse-gateway`**（逻辑名须与 `packages/proxy/wrangler.jsonc`、`packages/admin/wrangler.jsonc` 中 `database_name` 一致）。
- 将两处配置里的 **`database_id`** 都设为**同一个** D1 实例 ID（Dashboard → D1 → 数据库详情）。

**Postgres** 不作为 Cloudflare Worker 的存储后端。可选 Node 进程仅用于自托管 Proxy，见 [deployment-docker.md](./deployment-docker.md)。

### 本地与生产对照（摘要）

| 项目 | 本地 | 生产 |
|------|------|------|
| Proxy | `npm run dev:proxy`（根目录），`:8787` | `npm run deploy:proxy`，Worker 名见 `packages/proxy/wrangler.jsonc` 的 `name` |
| Admin | `npm run dev:admin` 或 `cd packages/admin && npm run preview` | `npm run deploy:admin` |
| D1 | `--persist-to ./.wrangler/state`（与脚本一致） | Dashboard 绑定同一 `database_id` |
| `MASTER_KEY` | D1 `system_config.MASTER_KEY`（种子见 `packages/core/migrations-d1/0002_seed.sql`） | 同上，以数据库为权威 |

## 2. 迁移与发布顺序（本机 `wrangler` / `npm run deploy:*`）

以下与 **§0 Connect to Git** 二选一或混用（例如迁移在本机、部署走 Git）。

1. 合并并通过自测。
2. **远程 D1** 有待执行迁移时，在**仓库根**执行：

   ```bash
   npm run db:migrate:remote
   ```

3. **部署 Proxy Worker**：

   ```bash
   npm run deploy:proxy
   ```

4. **部署 Admin Pages**（需在 Cloudflare 上绑定与 Proxy **相同**的 D1）：

   ```bash
   npm run deploy:admin
   ```

原则：**先让远程库 schema 与代码一致，再发布依赖新 schema 的制品**。若某次仅改代码、不改 schema，可跳过迁移步骤。

## 3. `MASTER_KEY` 与 Admin 认证

- 管理接口使用的 Bearer Token 必须与 D1 **`system_config.MASTER_KEY`** 一致；`requireMasterKey` 从数据库读取，**不**以 Worker Secret 为权威来源（与 v1 行为一致）。
- 首次上线后应在 Admin 的 Config 或 SQL 中将 `MASTER_KEY` 改为强随机值，并同步到密钥管理。
- **外部调用**管理 API：对 **`{GATEWAY_MASTER_URL}/api/admin/...`**（Admin Pages 根 URL；your-portal 环境变量名）携带 `Authorization: Bearer <MASTER_KEY>`（见 [api/admin.md](../api/admin.md)）。

## 4. 下游服务环境变量

| 服务 | 变量 | 说明 |
|------|------|------|
| your-portal（国际） | `GATEWAY_URL` | 客户端 / JWT / 健康检查：Proxy Worker 根 URL（典型 **`https://gateway.example.com`**） |
| your-portal（国际） | `GATEWAY_MASTER_URL` | Admin Pages 根 URL；管理请求 **`/api/admin/*`**（典型 **`https://gateway-admin.example.com`**） |
| your-portal（国际） | `GATEWAY_MASTER_KEY` | 与 **本区** D1 `MASTER_KEY` 一致 |
| your-portal (China-region example)（中国） | 同上 | 指向 **`https://gateway-cn.example.com`** / **`https://gateway-admin-cn.example.com`** 与境内库 **`MASTER_KEY`** |

更新 `MASTER_KEY` 后，必须同步更新 **`GATEWAY_MASTER_KEY`**，否则门户创建 Key、外部脚本调管理接口会 401。

## 5. 健康检查与观测

- Proxy：`GET /health`（探针打在 **Proxy 域名**上）。
- Admin 应用自身健康由 Pages/Worker 平台探针或自定义路由负责（若已配置）。
- 日志：`npx wrangler tail`，Worker 名称以 `packages/proxy/wrangler.jsonc` 的 `name` 为准；可在该配置中启用 `observability`。

## 6. 多套环境

- 新建独立 D1，复制/调整 `database_id`，可部署到独立 Worker 与 Pages 项目（预发、演练）。

---

**相关文档**：[部署索引](./deployment.md) · [本地测试](./local-testing-environments.md) · [Admin API](../api/admin.md)
