# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** 是以 npm workspaces 组织的单仓：共享 **`@octafuse/core`**，对外提供 **推理 Proxy**（OpenAI / Anthropic / Gemini 兼容），以及面向运维与自动化的 **Admin**（Next.js 16 + OpenNext）。**默认路径**：Cloudflare **Proxy Worker** + **Admin Pages**，共用 **D1**（逻辑库名 `octafuse-gateway`）。**自托管路径**：Docker 分拆 **Proxy** 与 **Admin**，共用 **Postgres** 或 **MySQL** 网关库（与海外 D1 **默认不同步**；见 [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)）。

本仓库以 **GNU Affero General Public License v3.0（AGPLv3）** 授权，全文见 [LICENSE](./LICENSE)。

**English README:** [README.md](./README.md)

## 贡献与安全

- [CONTRIBUTING.md](./CONTRIBUTING.md) — 含 AGPL 贡献许可及「维护者可另行商业许可」条款说明。  
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1。  
- [SECURITY.md](./SECURITY.md) — 漏洞请走 **GitHub Security Advisories**，勿在公开 issue 贴敏感信息。

## 约 60 秒上手（Docker + Postgres）

需 Docker Compose **v2.20+**（支持 `service_completed_successfully`）。

```bash
docker compose -f docker/compose/quickstart.yml up --build
```

健康后：

```bash
curl -sS http://localhost:8787/health
```

浏览器打开 **Admin**：`http://localhost:8789`（默认 `admin` / `changeme`）。在界面中配置至少一个上游 **provider** 与 **model route**，再创建 API Key（界面或 Admin API）。Postgres 种子数据中的默认 **`MASTER_KEY`** 为 `sk-dev-admin-key`（`Authorization: Bearer …` 调 `POST /api/admin/*`）；生产环境务必轮换，见 [docs/api/admin.md](./docs/api/admin.md)。

配置好路由与 Key 后，可对 `POST /v1/chat/completions` 做端到端调用（示例见英文 README）。

MySQL、仅 D1 开发、以及带 `migrate` profile 的分步编排，见 **`docker/compose/node-pg.yml`**、**`docker/compose/node-mysql.yml`** 与 [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)。

## Cloudflare：从 Git 一键部署（Connect to Git）

Fork 本仓后在 **Cloudflare 控制台** 将仓库关联到 **两个 Worker**（Proxy + Admin）：**Root directory** 分别设为 `packages/proxy` 与 `packages/admin`，在控制台为两者绑定同一 **D1**（绑定名 **`DB`**），并将 **`ADMIN_PASSWORD`** 设为 Worker **Secret**（勿写入 Git）。详细构建命令、可选「构建前远程 D1 迁移」与升级说明见 **[docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md)** 的 **§0**。

## 迁移策略（重要）

为后续产品化与开源，`packages/core/migrations-d1/`、`migrations-postgres/`、`migrations-mysql/` 作为新装环境的**最终基线**维护；后续变更以调整基线 SQL 为主。已部署环境的手工变更统一放在 **`docs/manual-sql/`**，并区分 D1 / Postgres 等执行面。

**替代关系**：`packages/proxy` 承接对外推理面；`packages/admin` 承接管理控制台（UI 与 BFF）。

## 包一览

| 包 | npm 名 | 说明 |
|----|--------|------|
| `packages/core` | `@octafuse/core` | D1 / Postgres / MySQL 仓储、类型、迁移 CLI（`octafuse-migrate`） |
| `packages/proxy` | `@octafuse/proxy` | Cloudflare Worker 或 Node：仅 **`/v1/*`**、**`/v1beta/*`**、**`/health`**、**`/`** |
| `packages/admin` | `@octafuse/admin` | 管理 UI + **`/api/admin/*`**（与 Proxy 同一库） |

更完整的架构与文档索引见 **[docs/README.md](./docs/README.md)**。

## 运行与数据面（Cloudflare / Node × D1 / Postgres / MySQL）

| 维度 | 说明 |
|------|------|
| **默认** | Cloudflare Worker + Pages，数据库 **D1**（`packages/core/migrations-d1/`） |
| **自托管 / PG** | Proxy：`npm run dev:proxy:node` 或 Docker；Admin：`npm run dev:admin:node` + 根目录 **`.env`** 的 **`DATABASE_URL`** / **`ADMIN_*`**；库表 **`migrations-postgres/`** |
| **自托管 / MySQL 8** | **`DATABASE_DRIVER=mysql`** + **`mysql://`**；**`migrations-mysql/`**；**`docker/compose/node-mysql.yml`** |
| **混合** | 例如 Proxy=Postgres、Admin 仍连 D1（两套库须分别维护），见 **[docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md)** |

## 环境变量

- 复制 **[`.env.example`](./.env.example)** → **`.env`**。  
- 可选新建 **`.env.local`**（不提交；示例见 **`.env.example`** 顶部「Optional local override」段落）。  
- **Node（Postgres 或 MySQL）**：配置 **`DATABASE_URL`**；**`DATABASE_DRIVER`** 与 `@octafuse/core` 解析规则一致（可省略时默认 postgres；MySQL 须显式 **`mysql`**）。Admin 需 **`ADMIN_USERNAME` / `ADMIN_PASSWORD`**。Proxy 可选 **`PORT`**（默认 `8787`）；Admin `dev:node` 固定 **`:8789`**。  
- **Cloudflare + D1**：`packages/proxy` / `packages/admin` 的 Wrangler 绑定；Worker 上勿配置 `DATABASE_URL`。**`ADMIN_PASSWORD`** 请用 Worker **Secret** 或 `wrangler secret put`，勿写入 `wrangler.jsonc`；见 [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) §0。  
- **仅在本包启动**：可用 **`packages/proxy/.env.example`** / **`packages/admin/.env.example`**，或在包目录 `ln -s ../../.env .env`。

## 常用命令（仓库根）

```bash
npm install
cp .env.example .env

npm run db:migrate       # 本地 D1 → ./.wrangler/state
npm run db:migrate:pg
npm run db:migrate:mysql

npm run dev:proxy
npm run dev:proxy:node
npm run dev:admin
npm run dev:admin:node
npm run deploy:proxy
npm run deploy:admin

npm run test:gateway:postgres-smoke
```

仅改 Admin UI、不需要 D1 时，可在 `packages/admin` 使用 `npm run dev`（管理 API 会因无 D1 返回 500，属预期）。

## 与下游门户（your-portal）对齐

| 变量 | 作用 |
|------|------|
| `GATEWAY_URL` | Proxy 根 URL（兼容 OpenAI 等入口） |
| `GATEWAY_MASTER_URL` | Admin 根 URL；管理 API 为 **`{GATEWAY_MASTER_URL}/api/admin/*`** |
| `GATEWAY_MASTER_KEY` | Bearer，须等于当前网关库 **`system_config.MASTER_KEY`** |

## 部署注意

- **D1 迁移**：`packages/core/migrations-d1/`，根目录 **`npm run db:migrate`** / **`db:migrate:remote`**（**`packages/core/wrangler.d1.jsonc`**）。  
- **Postgres / MySQL**：分别由 `scripts` 与 core migrate CLI 执行对应目录 SQL。  
- **`packages/proxy/wrangler.jsonc`** 与 **`packages/admin/wrangler.jsonc`** 中的 D1 绑定须指向同一逻辑库（若使用 D1）。

## Docker（可选）

**`docker/build/Dockerfile.proxy`**、**`docker/build/Dockerfile.admin`**、**`docker/build/Dockerfile.migrate`** 与 **`docker/compose/quickstart.yml`**（一键）、**`docker/compose/node-pg.yml`**、**`docker/compose/node-mysql.yml`**；预构建镜像示例见 **`docker/examples/`**（含 **[`docker/examples/nginx/`](./docker/examples/nginx/)** 流式友好反代片段）。运维见 **[docker/deploy/README.md](./docker/deploy/README.md)**、**[docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)**。

变更记录：使用 **GitHub Releases** 即可。
