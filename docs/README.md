# Octafuse Gateway 文档

本仓库 **`octafuse`** 是 Gateway 的 **npm workspaces** 单体：**`packages/proxy`**（推理）与 **`packages/admin`**（管理 UI + `/api/admin/*`）共享 **`@octafuse/core`**。

## 必读

| 文档 | 说明 |
|------|------|
| [architecture/runtime-data.md](./architecture/runtime-data.md) | **运行时（Cloudflare / Node）× 数据库（D1 / Postgres / MySQL）**、部署拓扑与迁移目录 |

## 架构

| 文档 | 说明 |
|------|------|
| [architecture/admin-layered.md](./architecture/admin-layered.md) | Admin 路由 / 服务 / 仓储分层 |

默认拓扑（Cloudflare + D1）：

```mermaid
flowchart LR
  subgraph clients [调用方]
    Portal[portal]
    Client[AI_client]
    Browser[browser]
  end
  subgraph cf [Cloudflare]
    Proxy["@octafuse/proxy"]
    Admin["@octafuse/admin"]
    D1[(D1)]
  end
  Core["@octafuse/core"]
  Proxy --> D1
  Admin --> D1
  Proxy -.-> Core
  Admin -.-> Core
  Client --> Proxy
  Portal --> Proxy
  Portal --> Admin
  Browser --> Admin
```

| 包 | 运行时（典型） | 对外路径（摘要） | 数据 |
|----|----------------|------------------|------|
| `packages/proxy` | **CF Worker** 或 **Node** | `GET /`、`GET /health`、**`/v1/*`**、**`/v1beta/*`** | **D1**（Worker）或 **Postgres / MySQL**（Node） |
| `packages/admin` | **OpenNext + wrangler** 或 **Node** | 管理 UI；**`/api/admin/*`** | 与 Proxy **同源** |
| `packages/core` | 库 | 被 proxy / admin 引用 | **D1 / Postgres / MySQL**（驱动见 runtime-data） |

要点：**Proxy Worker 不挂载 `/admin/*`**。管理 HTTP 由 Admin 在 **`{GATEWAY_MASTER_URL}/api/admin/...`** 提供（Bearer `MASTER_KEY` 或已登录 Cookie）。

## 与下游门户的契约

| 变量 | 指向 |
|------|------|
| `GATEWAY_URL` | Proxy 根（用户推理） |
| `GATEWAY_MASTER_URL` | Admin 根；**`{GATEWAY_MASTER_URL}/api/admin/*`** |
| `GATEWAY_MASTER_KEY` | 与当前库 **`system_config.MASTER_KEY`** 一致 |

## API

| 文档 | 说明 |
|------|------|
| [api/README.md](./api/README.md) | 总览：Base URL、认证、错误形态 |
| [api/public.md](./api/public.md) / [api/user.md](./api/user.md) | 公开接口与用户接口（经 Proxy） |
| [api/admin.md](./api/admin.md) | 管理接口（对外 `/api/admin/*`） |

## 运维与部署

| 文档 | 说明 |
|------|------|
| [ops/deployment.md](./ops/deployment.md) | **部署索引**（入口） |
| [ops/deployment-cloudflare.md](./ops/deployment-cloudflare.md) | Cloudflare：Connect to Git、Wrangler、密钥 |
| [ops/deployment-docker.md](./ops/deployment-docker.md) | Docker 镜像、Compose、GHCR/ACR |
| [ops/local-testing-environments.md](./ops/local-testing-environments.md) | 本地 D1 / Node + SQL |
| [ops/release-versioning.md](./ops/release-versioning.md) | Changesets、`vX.Y.Z`、镜像与 Release |
| [ops/postgres-cutover.md](./ops/postgres-cutover.md) | D1 ↔ Postgres 脚本（`scripts/db/cutover/`） |

**Compose 宿主机环境文件**：[docker/deploy/README.md](../docker/deploy/README.md)（从 `docker/examples/env.*.example` 复制）。

## 参考（行为与语义）

| 文档 | 说明 |
|------|------|
| [reference/streaming-billing.md](./reference/streaming-billing.md) | 流式计费与取消 |
| [reference/budget-audit-logs.md](./reference/budget-audit-logs.md) | 预算审计日志 |
| [reference/provider-thinking-configs.md](./reference/provider-thinking-configs.md) | 渠道思考类参数 |
| [reference/provider-import-presets.md](./reference/provider-import-presets.md) | Admin Provider 导入模板 |

## 仓库根常用命令

```bash
npm install
npm run db:migrate          # 本地 D1 → ./.wrangler/state
npm run dev:proxy           # Proxy Worker :8787
npm run dev:proxy:node      # Proxy Node + SQL :8787
npm run dev:admin           # Admin OpenNext preview + D1 :8789
npm run dev:admin:node      # Admin Node + SQL :8789
npm run deploy:proxy
npm run deploy:admin
```

D1 迁移目录：**`packages/core/migrations-d1/`**（`wrangler.d1.jsonc` 同目录）。Postgres：**`packages/core/migrations-postgres/`**（`npm run db:migrate:pg`）。MySQL：**`packages/core/migrations-mysql/`**（`npm run db:migrate:mysql`）。
