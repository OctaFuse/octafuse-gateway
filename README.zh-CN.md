# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** 是以 npm workspaces 组织的单仓：共享 **`@octafuse/core`**，对外提供 **推理 Proxy**（OpenAI / Anthropic / Gemini 兼容），以及面向运维与自动化的 **Admin**（Next.js 16 + OpenNext）。

**常见部署**：Cloudflare **Proxy Worker** + **Admin Pages** + **D1**；或自托管 **Proxy + Admin** + **Postgres** / **MySQL**。

**English:** [README.md](./README.md) · **官网介绍：** [octafuse.dev/zh](https://octafuse.dev/zh/)

## What is OctaFuse

**OctaFuse** 是开源 **AI Gateway**：把分散在不同供应商、不同计划里的模型能力，汇总成 **一个 Base URL、一个 API Key** 的统一调用入口。

通过 **Proxy + Admin + Core** 分层架构，把「模型接入、路由治理、预算计费、审计观测」沉淀为独立基础设施——个人可汇总多个 Coding / Token Plan 与密钥，团队可为部门或客户单独发 Key 并做预算与审计。更多适用场景见 [octafuse.dev/zh](https://octafuse.dev/zh/)。

- **Proxy（`packages/proxy`）**：OpenAI / Anthropic / Gemini 兼容推理入口
- **Admin（`packages/admin`）**：管理台与 `/api/admin/*` 自动化管理接口
- **Core（`packages/core`）**：统一仓储、类型、迁移与跨数据库实现（D1 / Postgres / MySQL）

## Why OctaFuse

模型供应越来越碎片化——调用入口、API Key、额度、账单和日志分散在不同供应商与工具里，切换模型或排查问题都要改多处配置。

在调研多个开源与商业方案后，我们看到几类共性痛点：**Provider 覆盖偏窄**；不少产品 **只提供 OpenAI 形态入口**；**计费与审计**能力不足，难以按路由、用户或成本口径灵活建模。

OctaFuse 作为可自主部署、可持续演进的网关层来应对上述问题：

- 支持接入更多上游供应商（含各类 Plan 与本地 / 内部模型），并在同一网关上承载多种客户端协议
- 支持按业务需要定义路由、计费口径与审计方式
- 通过标准 **Admin API** 与上层系统集成，减少与供应商细节的耦合

## Features

- **统一接入入口** — 客户端一个 Base URL、一个 API Key；兼容 OpenAI / Anthropic / Gemini 等协议，背后路由到任意已配置上游
- **密钥与预算** — 用户 / Key 管理、预算上限与周期重置、`GET /v1/me` 额度查询
- **路由与容错** — Provider / Model / Route 管理，route group 与优先级 failover
- **计费与对账** — `metered_cost` / `standard_cost` / `charged_cost` 三套成本口径
- **审计与观测** — 全局与按 Key 的请求日志、用户级审计轨迹
- **错误告警** — 管理台配置飞书 / 企业微信 Webhook，Proxy 转发失败时主动推送
- **用量分析** — 管理台按时间范围汇总模型、供应商、用户用量及可靠性概况
- **联调与自检** — Playground 单路由试调用（不占用户额度）；Simulator 浏览器内模拟客户端调用
- **灵活部署** — Cloudflare（Worker + Pages + D1）或自托管（Docker / Node + Postgres / MySQL）
- **Admin API 集成** — 门户与业务系统通过 `/api/admin/*` 对接，自动开通用户、创建 Key、同步预算

## 界面预览

下面截图来自本地 Admin 实例，展示了最常用的几条运维链路：看整体用量、接入上游 Provider、配置模型路由，以及在开放给用户前先用 Playground 单路由试调。

| 运营概览 | 上游 Provider |
|---|---|
| ![Octafuse Gateway 管理台仪表盘，展示用量、成本、延迟和最近请求](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway Provider 页面，展示上游端点卡片和 Key 状态](./docs/assets/screenshots/providers.png) |

| 模型路由 | Playground |
|---|---|
| ![Octafuse Gateway 模型路由页面，展示 Provider 优先级和 route group](./docs/assets/screenshots/routes.png) | ![Octafuse Gateway Playground 页面，用于不计入用户 Key 账单的单路由测试](./docs/assets/screenshots/playground.png) |

## Quick Start

以下步骤仅用于**本地开发**。生产或预发部署见 **[部署](#部署)**。

| 路径 | 适合场景 | 运行时 | 数据库 |
|------|----------|--------|--------|
| **Docker** | 最快端到端跑通；本机不需要 Node 环境 | Node 容器 | Postgres 容器 |
| **Cloudflare 本地 D1** | Worker / OpenNext 开发；上线 Cloudflare 前验证 | Wrangler 本地 Worker + Admin 预览 | `./.wrangler/state` 下的本地 D1 |

### 方式 A：Docker（最快跑通）

前置：Docker Compose **v2.20+**（需支持 `service_completed_successfully`）。这个 compose 会启动 Postgres、执行一次性迁移，然后启动 Proxy 与 Admin。

```bash
docker compose -f docker/compose/quickstart.yml up --build
curl -sS http://localhost:8787/health
```

本地默认值：

| 项目 | 默认值 |
|------|--------|
| Proxy | `http://localhost:8787` |
| Admin | `http://localhost:8789` |
| Admin 登录 | `admin` / `changeme` |
| Postgres | `postgres://postgres:postgres@localhost:5432/octafuse` |
| Admin API Bearer | 本地种子写入的 `sk-dev-admin-key` |

如需改宿主机端口，不必编辑 YAML：

```bash
GATEWAY_PROXY_HOST_PORT=18787 \
GATEWAY_ADMIN_HOST_PORT=18789 \
POSTGRES_HOST_PORT=15432 \
docker compose -f docker/compose/quickstart.yml up --build
```

首次跑通流程：

1. 打开 Admin，用 `admin` / `changeme` 登录。
2. 新增或导入至少一个 **Provider**，并替换占位的上游 API Key。
3. 为客户端要调用的模型 ID 创建或启用 **Model Route**。
4. 创建一个用户 **API Key**。
5. 用这个用户 Key 调用 Proxy。

Postgres 种子中的默认 **`MASTER_KEY`** 为 `sk-dev-admin-key`（`Authorization: Bearer …` 调 `POST /api/admin/*`）；任何共享环境前务必轮换，见 [docs/api/admin.md](./docs/api/admin.md)。

端到端聊天示例（配置好路由与用户 Key 后）：

```bash
curl -sS http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

停止本地演示：

```bash
docker compose -f docker/compose/quickstart.yml down
```

如需删除本地 Postgres 数据卷、从空库重来，可追加 `-v`。

MySQL、分拆编排与预构建镜像：[docker/compose/node-pg.yml](./docker/compose/node-pg.yml)、[docker/compose/node-mysql.yml](./docker/compose/node-mysql.yml)、[docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)。

### 方式 B：Cloudflare（本地 D1）

前置：**Node.js 20+**、npm。这条路径使用本地 Wrangler；本地开发时**不需要** `cloudflare-worker/*.env`、远程 D1，也不需要先登录 Cloudflare。本地数据持久化在 `./.wrangler/state`。

```bash
npm install
npm run db:migrate          # 本地 D1 迁移
npm run dev:proxy           # Proxy Worker → http://127.0.0.1:8787
```

另开终端：

```bash
npm run dev:admin           # Admin OpenNext 预览 → http://127.0.0.1:8789
```

Cloudflare 本地默认值：

| 项目 | 默认值 / 位置 |
|------|---------------|
| Proxy Worker | `http://127.0.0.1:8787` |
| Admin 预览 | `http://127.0.0.1:8789` |
| D1 本地状态 | `./.wrangler/state` |
| Wrangler 模板 | `packages/*/wrangler.base.jsonc` 与 `packages/core/wrangler.d1.base.jsonc` |
| 生成的配置 | `packages/*/wrangler.jsonc` 与 `packages/core/wrangler.d1.jsonc`（已 gitignore） |
| Admin API Bearer | D1 `system_config.MASTER_KEY`；本地种子为 `sk-dev-admin-key` |

然后在 Admin 中配置 **Provider** → **Model Route** → **API Key**。管理 API 的 Bearer 须与 D1 `system_config.MASTER_KEY` 一致（开发种子见 `packages/core/migrations-d1/0002_seed.sql`）。

当你准备把同一套代码接到远程 Cloudflare D1：

1. 用 `npx wrangler login` 完成 Wrangler 认证，或在 shell / CI 中设置权限收敛的 Cloudflare API token。
2. 用 `npx wrangler d1 create <name>` 创建 D1。
3. 将 `PROXY_WORKER_NAME`、`ADMIN_WORKER_NAME`、`D1_DATABASE_NAME`、`D1_DATABASE_ID` 放进 Cloudflare Build variables，或放进 gitignore 的 `cloudflare-worker/<instance>.env`。
4. 有新 schema 时，先迁移远程 D1，再部署依赖新表结构的代码：

```bash
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run deploy:admin
```

**注意**：在本机跑过 `deploy-soloent.sh` / `db:migrate:remote` 之后，继续本地 dev 前须先 `npm run gen:wrangler`（否则 `db:migrate` 与 `dev:*` 会连两套不同的本地 D1）。说明见 [local-testing-environments.md §1](./docs/ops/local-testing-environments.md#️-本地-d1-与-database_id远程-deploy-后必读)。

可选路径（Node + Postgres/MySQL、多套本地 D1、冒烟脚本）：[docs/ops/local-testing-environments.md](./docs/ops/local-testing-environments.md)。

## 部署

生产与预发环境请查阅下列文档，Quick Start 不展开线上步骤。

| 主题 | 链接 |
|------|------|
| 部署索引（模式、迁移、环境文件） | [docs/ops/deployment.md](./docs/ops/deployment.md) |
| Cloudflare（Proxy Worker + Admin + D1） | [cloudflare-worker/README.md](./cloudflare-worker/README.md) · [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) |
| Docker / 自托管（Postgres、MySQL、GHCR、Compose） | [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md) |
| 运行时 × 数据库矩阵 | [docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md) |
| 版本与发版 | [docs/ops/release-versioning.md](./docs/ops/release-versioning.md) |

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

- 复制 **[`.env.example`](./.env.example)** → **`.env`**（Node/Postgres/Docker/冒烟）。
- **Cloudflare 部署**（Worker 名、D1 id、routes）：**`cloudflare-worker/`**，见 [cloudflare-worker/README.md](./cloudflare-worker/README.md)。生产用 Dashboard **Build variables**（不提交 env 文件）。
- **Cloudflare + D1**：由 `*.base.jsonc` + `npm run gen:wrangler` 生成 Wrangler 配置；Worker 勿配 `DATABASE_URL`。**`ADMIN_PASSWORD`** 用 Secret；见 [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md)。

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

npm run deploy:proxy        # 须 cloudflare-worker/*.env 或 Build variables — 见 cloudflare-worker/README.md
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

## 开源协议

本仓库以 **GNU Affero General Public License v3.0（AGPLv3）** 授权，全文见 [LICENSE](./LICENSE)。
