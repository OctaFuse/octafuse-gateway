# 部署文档索引（Octafuse）

多运行时（Cloudflare / Node）与多数据库（D1 / Postgres / MySQL）的架构总览见 **[architecture/runtime-data.md](../architecture/runtime-data.md)**。

**octafuse** 的部署常见模式：

1. **Cloudflare 全托管（默认）**：Proxy Worker + Admin Pages，共用 D1。见 [deployment-cloudflare.md](./deployment-cloudflare.md)。
2. **Hybrid**：Proxy Node + Postgres，Admin 继续 Cloudflare + D1。见 [deployment-docker.md](./deployment-docker.md)。
3. **Full self-hosted PG**：Proxy Node + Admin Node/兼容运行时，共用 Postgres。见 [deployment-docker.md](./deployment-docker.md) 与 [postgres-cutover.md](./postgres-cutover.md)。
4. **Full self-hosted MySQL**：同上形态，共用 MySQL 8（`DATABASE_DRIVER=mysql`，迁移 `migrations-mysql/`）。见 [deployment-docker.md](./deployment-docker.md)（含 **`docker/compose/node-mysql.yml`**，以及 MySQL 时区需统一 UTC 的说明）。
5. **中国境内等自托管 Docker + Postgres**：镜像由 CI 推 registry（如 GHCR/ACR），宿主机拉镜像、迁移、启停；目录约定见 [docker/deploy/README.md](../../docker/deploy/README.md)，编排与变量见 [deployment-docker.md](./deployment-docker.md)。

本地与多套 D1 数据目录见 [local-testing-environments.md](./local-testing-environments.md)。若需在 D1 与 Postgres 之间做数据迁移或对账，见 [postgres-cutover.md](./postgres-cutover.md)（脚本在 `scripts/db/cutover/`，需自备 Postgres 迁移链与运维窗口）。
