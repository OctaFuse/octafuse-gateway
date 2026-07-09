# 部署文档索引（Octafuse）

多运行时（Cloudflare / Node）与多数据库（D1 / Postgres / MySQL）的架构总览见 **[runtime-data.md](../../developers/architecture/runtime-data.md)**。

## 数据库与迁移

- **新装**：以 `packages/core/migrations-d1/`、`migrations-postgres/`、`migrations-mysql/` 为表结构基线；用根目录 **`npm run db:migrate*`** 或 Docker **migrate** 镜像应用（见 [docker.md](./docker.md)）。
- **已上线环境**：表结构演进以 **迁移 CLI / 镜像 migrate Job** 为主；若遇紧急数据修复，在运维窗口内用 **`wrangler d1 execute`** 或直连 SQL 执行，并尽快把结果合回基线迁移（PR）。

**Compose 宿主机环境文件**（镜像、`DATABASE_URL`、`ADMIN_*`）：从 **`docker/examples/env.*.example`** 复制到 **`docker/deploy/`** 下自建文件（勿提交），约定见 **[docker/deploy/README.md](../../../docker/deploy/README.md)**。

## 常见部署模式

1. **Cloudflare 全托管（默认）**：Proxy Worker + Admin，共用 D1。见 [cloudflare-worker/README.md](../../../cloudflare-worker/README.md) 与 [cloudflare.md](./cloudflare.md)。
2. **Hybrid**：Proxy Node + Postgres，Admin 继续 Cloudflare + D1。见 [docker.md](./docker.md)。
3. **Full self-hosted PG**：Proxy Node + Admin Node，共用 Postgres。见 [docker.md](./docker.md) 与 [d1-postgres-cutover.md](../migrations/d1-postgres-cutover.md)。
4. **Full self-hosted MySQL**：同上形态，共用 MySQL 8（`DATABASE_DRIVER=mysql`，迁移 `migrations-mysql/`）。见 [docker.md](./docker.md)（含 **`docker/compose/node-mysql.yml`** 与 UTC 时区说明）。
5. **自托管 Docker + Postgres / MySQL（无 Cloudflare 依赖）**：镜像由 CI 推到 **GHCR**（或你在镜像仓库侧 mirror 到自建 Harbor 等），宿主机拉镜像、迁移、启停；编排与变量见 [docker.md](./docker.md)。
6. **Zeabur（容器平台）**：Proxy + Admin 为常驻 Service；**migrate 为一次性 Job**（勿常驻，否则 CrashLoop）。见 [zeabur.md](./zeabur.md)。

本地与多套 D1 数据目录见 [local-development.md](../../developers/local-development.md)。D1 与 Postgres 之间迁移或对账见 [d1-postgres-cutover.md](../migrations/d1-postgres-cutover.md)（脚本在 `scripts/db/cutover/`）。
