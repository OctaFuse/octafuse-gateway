# 部署文档索引（Octafuse）

多运行时（Cloudflare / Node）与多数据库（D1 / Postgres / MySQL）的架构总览见 **[runtime-data.md](../../developers/architecture/runtime-data.md)**（部署模式矩阵 SSOT）。

## 数据库与迁移

- **新装**：以 `packages/core/migrations-d1/`、`migrations-postgres/`、`migrations-mysql/` 为表结构基线；用根目录 **`npm run db:migrate*`** 或 Docker **migrate** 镜像应用（见 [docker.md](./docker.md)）。
- **已上线环境**：表结构演进以 **迁移 CLI / 镜像 migrate Job** 为主；若遇紧急数据修复，在运维窗口内用 **`wrangler d1 execute`** 或直连 SQL 执行，并尽快把结果合回基线迁移（PR）。

**Compose 宿主机环境文件**（镜像、`DATABASE_URL`、`ADMIN_*`）：从 **`docker/examples/env.*.example`** 复制到 **`docker/deploy/`** 下自建文件（勿提交），约定见 **[docker/deploy/README.md](../../../docker/deploy/README.md)**。

## 怎么选文档

**默认推荐 Cloudflare**（个人与小流量通常可在免费额度内运行）。本地试用与一键上云见 [users/quickstart.md](../../users/quickstart.md)。

| 场景 | 文档 |
|------|------|
| Cloudflare 首次上云 | [cloudflare-quickstart.md](./cloudflare-quickstart.md) |
| Cloudflare 运维 / Workers Builds / 多实例 | [cloudflare.md](./cloudflare.md) · 实例 env：[cloudflare-worker/README.md](../../../cloudflare-worker/README.md) |
| Docker / Postgres / MySQL / Hybrid 自托管 | [docker.md](./docker.md) |
| Zeabur 等容器平台 | [zeabur.md](./zeabur.md) |
| D1 ↔ Postgres ETL / 对账 | [d1-postgres-cutover.md](../migrations/d1-postgres-cutover.md) |
| 本地开发组合 | [local-development.md](../../developers/local-development.md) |

拓扑对照（CF / Hybrid / Full PG / MySQL）以 [runtime-data.md](../../developers/architecture/runtime-data.md) 为准，本文不重复完整矩阵。
