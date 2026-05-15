# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** 是以 npm workspaces 组织的单仓：共享 **`@octafuse/core`**，对外提供 **推理 Proxy**（OpenAI / Anthropic / Gemini 兼容），以及面向运维与自动化的 **Admin**（Next.js 16 + OpenNext）。

**常见部署**：Cloudflare **Proxy Worker** + **Admin Pages** + **D1**；或自托管 **Proxy + Admin** + **Postgres** / **MySQL**。

本仓库以 **GNU Affero General Public License v3.0（AGPLv3）** 授权，全文见 [LICENSE](./LICENSE)。

**English:** [README.md](./README.md)

## What is OctaFuse

**OctaFuse** 是一个面向团队与企业场景的 AI Gateway（网关）项目，用于统一承接多业务系统的模型调用需求。它通过 `Proxy + Admin + Core` 的分层架构，把「模型接入、路由治理、预算计费、审计观测」沉淀为独立基础设施，而不是散落在各个业务服务中重复实现。

- **Proxy（`packages/proxy`）**：对外提供 OpenAI / Anthropic / Gemini 兼容推理入口
- **Admin（`packages/admin`）**：提供管理台与 `/api/admin/*` 自动化管理接口
- **Core（`packages/core`）**：统一仓储、类型、迁移与跨数据库实现（D1 / Postgres / MySQL）

## Why OctaFuse

创建 OctaFuse 的初衷，是为了构建一套可自主掌控、可持续演进的 AI 网关能力，服务内部不同 SaaS 系统。

在调研过多个开源和商业方案后，我们发现几类共性痛点：一是 **provider** 选择面偏窄，难以同时覆盖公有云、私有部署与内部模型；二是不少产品 **只提供 OpenAI 形态入口**，团队已在用的 Anthropic、Gemini 等协议往往需要额外适配或二次封装；三是 **计费与审计**能力偏固定或不足，难以按路由、用户、成本口径等灵活建模与对账。

OctaFuse 希望通过更高自由度解决上述问题：

- 支持接入更多不同 Provider（包括各种 Coding/Token/Agent Plan、本地/内部部署模型），并在同一网关上承载多种客户端常用协议
- 支持按业务需要定义路由、计费口径与审计/追溯方式，便于多产品线或对内对账
- 通过标准管理 API 与业务系统对接，减少耦合

## Features

基于当前代码与文档，OctaFuse 已提供以下核心能力：

- **多协议兼容**：`/v1/chat/completions`（OpenAI）、`/v1/messages`（Anthropic）、`/v1beta/*`（Gemini）
- **统一密钥与预算体系**：用户 / Key 管理、预算上限与周期重置、`/v1/me` 预算查询
- **模型路由治理**：Provider / Model / Route 管理，支持 route group 与优先级 failover
- **分层计费与对账**：`metered_cost` / `standard_cost` / `charged_cost` 三套成本口径
- **审计与观测**：全局与按 Key 的请求日志、用户级审计轨迹，便于追溯与问题排查
- **Analytics（用量与可靠性）**：管理台按时间范围汇总模型用量、供应商用量、用户用量及可靠性概况，便于做容量观察、成本感知与稳定性对比
- **Playground（试调用）**：管理台里针对单条模型路由发起试请求，快速确认能否连上供应商、配置是否正确；不占用用户额度，也不会像真实业务调用那样产生计费与用量记录，适合排错与上线前自检
- **Simulator（客户端模拟）**：管理台里用浏览器模拟真实应用：带上用户 API Key、按 OpenAI / Anthropic / Gemini 方式调用你部署的网关，用来联调与验收「鉴权、选路、计费、日志」是否与线上一致
- **多运行时部署**：Cloudflare（Worker + Pages + D1）或自托管（Docker/Node + Postgres/MySQL）
- **业务系统解耦**：通过 Admin API（`/api/admin/*`）对接上层 SaaS，让业务更专注 AI 应用本身

## Quick Start

### 方式 A：本地 Docker（推荐先跑通）

```bash
docker compose -f docker/compose/quickstart.yml up --build
curl -sS http://localhost:8787/health
```

健康后：
- Proxy：`http://localhost:8787`
- Admin：`http://localhost:8789`（默认 `admin / changeme`）

然后在 Admin 中完成三步：配置 Provider → 配置 Model Route → 创建 API Key，即可开始调用推理接口。

### 方式 B：Cloudflare 部署

按 [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) 将仓库关联为两个 Worker（Proxy + Admin），并绑定同一 D1（`DB`）。随后执行远程迁移与部署命令（见下方“Cloudflare：从 Git 一键部署”章节）。

### 方式 C：自托管 Node + Postgres/MySQL

如需落地到自有基础设施（Docker/K8s/VPS），见 [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md) 与 [docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md)。

## Contributing

欢迎提交 Issue / PR 一起完善 OctaFuse。提交前建议先阅读：

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)（文档边界与敏感信息规范）

## 文档地图

| 主题 | 链接 |
|------|------|
| 文档边界与敏感信息规范 | [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) |
| 架构与「运行时 × 数据库」 | [docs/README.md](./docs/README.md) → [docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md) |
| API | [docs/api/README.md](./docs/api/README.md) |
| 部署（Cloudflare / Docker / 发版） | [docs/ops/deployment.md](./docs/ops/deployment.md) |
| HTTP 示例 | [examples/README.md](./examples/README.md) |

> 改动 `README*.md`、`docs/**`、`examples/**`、`docker/**` 之前请先读 **[docs/CONVENTIONS.md](./docs/CONVENTIONS.md)**：它说明哪些文档必须留在本仓（API 契约、迁移、运行时行为），哪些是未来可外移到独立 `octafuse-website` 的候选，以及如何用占位符避免把真实密钥 / Webhook / 连接串提交进 Git。

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

仓库根目录 **`Dockerfile.proxy` / `Dockerfile.admin` / `Dockerfile.migrate`** 三镜像；**`docker/compose/`** 一键与分拆编排；示例与 Nginx 片段：**[`docker/examples/`](./docker/examples/)**。Compose 用的宿主机环境文件约定：**[`docker/deploy/README.md`](./docker/deploy/README.md)**。完整说明：[docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)。
