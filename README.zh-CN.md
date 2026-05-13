# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** 是以 npm workspaces 组织的单仓：共享 **`@octafuse/core`**，对外提供 **推理 Proxy**（OpenAI / Anthropic / Gemini 兼容），以及面向运维与自动化的 **Admin**（Next.js 16 + OpenNext）。

**常见部署**：Cloudflare **Proxy Worker** + **Admin Pages** + **D1**；或自托管 **Proxy + Admin** + **Postgres** / **MySQL**。

本仓库以 **GNU Affero General Public License v3.0（AGPLv3）** 授权，全文见 [LICENSE](./LICENSE)。

**English:** [README.md](./README.md)

## 文档地图

| 主题 | 链接 |
|------|------|
| 文档边界与敏感信息规范 | [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) |
| 架构与「运行时 × 数据库」 | [docs/README.md](./docs/README.md) → [docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md) |
| API | [docs/api/README.md](./docs/api/README.md) |
| 部署（Cloudflare / Docker / 发版） | [docs/ops/deployment.md](./docs/ops/deployment.md) |
| HTTP 示例 | [examples/README.md](./examples/README.md) |

> 改动 `README*.md`、`docs/**`、`examples/**`、`docker/**` 之前请先读 **[docs/CONVENTIONS.md](./docs/CONVENTIONS.md)**：它说明哪些文档必须留在本仓（API 契约、迁移、运行时行为），哪些是未来可外移到独立 `octafuse-docs` 的候选，以及如何用占位符避免把真实密钥 / Webhook / 连接串提交进 Git。

## 约 60 秒上手（Docker + Postgres）

需 Docker Compose **v2.20+**（支持 `service_completed_successfully`）。

```bash
docker compose -f docker/compose/quickstart.yml up --build
```

健康后：

```bash
curl -sS http://localhost:8787/health
```

浏览器打开 **Admin**：`http://localhost:8789`（默认 `admin` / `changeme`）。配置上游 **provider** 与 **model route**，再创建 API Key。Postgres 种子中的默认 **`MASTER_KEY`** 为 `sk-dev-admin-key`（`Authorization: Bearer …` 调 `POST /api/admin/*`）；生产务必轮换，见 [docs/api/admin.md](./docs/api/admin.md)。

端到端聊天示例见英文 README 中的 `curl`。

MySQL、仅 D1 开发、分拆编排：**`docker/compose/node-pg.yml`**、**`docker/compose/node-mysql.yml`**、[docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)。

## Cloudflare：从 Git 一键部署

在 Cloudflare 控制台将仓库关联到 **两个 Worker**（Proxy + Admin）：**Root directory** 分别为 `packages/proxy` 与 `packages/admin`，绑定同一 **D1**（绑定名 **`DB`**），**`ADMIN_PASSWORD`** 设为 Worker **Secret**。详见 [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) 的 **§0**。

## 包一览

| 包 | npm 名 | 说明 |
|----|--------|------|
| `packages/core` | `@octafuse/core` | D1 / Postgres / MySQL 仓储、类型、迁移 CLI |
| `packages/proxy` | `@octafuse/proxy` | Worker 或 Node：**`/v1/*`**、**`/v1beta/*`**、**`/health`**、**`/`** |
| `packages/admin` | `@octafuse/admin` | 管理 UI + **`/api/admin/*`**（与 Proxy 同一库） |

## 数据库迁移

新装环境的基线 SQL：

- `packages/core/migrations-d1/`
- `packages/core/migrations-postgres/`
- `packages/core/migrations-mysql/`

通过下方根目录命令或 Docker **migrate** 镜像应用（见 [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)）。线上一次性修复请纳入运维手册或在 PR 中更新基线，索引见 [docs/ops/deployment.md](./docs/ops/deployment.md)。

## 版本与发版

根包 `octafuse` 与 `@octafuse/*` **共用一条 semver**。**`vX.Y.Z`** 标签触发 GHCR 与 **GitHub Release**。变更摘要由 **Changesets** 汇总到根目录 **[CHANGELOG.md](./CHANGELOG.md)**。

- 需要记入下一版：`npx changeset`
- 维护流程：[docs/ops/release-versioning.md](./docs/ops/release-versioning.md) · [`.changeset/README.md`](./.changeset/README.md)

## 环境变量

- 复制 **[`.env.example`](./.env.example)** → **`.env`**。
- 可选 **`.env.local`**（不提交；说明见 **`.env.example`** 顶部）。
- **Node（Postgres 或 MySQL）**：**`DATABASE_URL`**；**`DATABASE_DRIVER`**（MySQL 须显式 **`mysql`**）；Admin 需 **`ADMIN_USERNAME` / `ADMIN_PASSWORD`**。
- **Cloudflare + D1**：使用 Wrangler 绑定；Worker 勿配置 `DATABASE_URL`。**`ADMIN_PASSWORD`** 用 Secret；见 [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) §0。

## 常用命令（仓库根）

```bash
npm install
cp .env.example .env

npm run db:migrate
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

## 与下游门户对齐

| 变量 | 作用 |
|------|------|
| `GATEWAY_URL` | Proxy 根 URL |
| `GATEWAY_MASTER_URL` | Admin 根 URL；管理 API 为 **`{GATEWAY_MASTER_URL}/api/admin/*`** |
| `GATEWAY_MASTER_KEY` | Bearer，须等于 **`system_config.MASTER_KEY`** |

## 贡献与安全

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md) — 漏洞请走 **GitHub Security Advisories**

## Docker（可选）

**`docker/build/`** 三镜像；**`docker/compose/`** 一键与分拆编排；示例与 Nginx 片段：**[`docker/examples/`](./docker/examples/)**。Compose 用的宿主机环境文件约定：**[`docker/deploy/README.md`](./docker/deploy/README.md)**。完整说明：[docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)。
