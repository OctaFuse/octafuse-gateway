# `@octafuse/core`

Gateway 共享库：**D1 / Postgres 仓储**、类型、`system_config`、关键写路径（用量 + 预算审计）、业务服务（如 `key-service`）等。被 **`@octafuse/proxy`** 与 **`@octafuse/admin`** 引用；无独立 HTTP 入口。

D1 表结构迁移位于本包 **`migrations-d1/`**；在仓库根执行 **`npm run db:migrate*`**（配置见同目录 **`wrangler.d1.jsonc`**）。Postgres 迁移链位于本包 **`migrations-postgres/`**，由仓库根 **`npm run db:migrate:pg`**（`src/migrate/cli.ts` → `migrate/postgres.ts`）读取（路径相对本包解析）。
