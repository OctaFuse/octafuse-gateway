# `@octafuse/core`

共享库：**D1 / Postgres / MySQL** 仓储、类型、迁移 CLI（`octafuse-migrate`）、关键写路径与领域服务。被 **`@octafuse/proxy`** 与 **`@octafuse/admin`** 引用；无独立 HTTP 入口。

- **D1**：`migrations-d1/` + 根目录 **`npm run db:migrate*`**（`wrangler.d1.jsonc`）
- **Postgres**：`migrations-postgres/` + **`npm run db:migrate:pg`**
- **MySQL**：`migrations-mysql/` + **`npm run db:migrate:mysql`**

架构与运行时矩阵：[docs/README.md](../../docs/README.md) · [docs/architecture/runtime-data.md](../../docs/architecture/runtime-data.md)
