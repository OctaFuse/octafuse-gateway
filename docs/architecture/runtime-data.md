# 运行时与数据存储架构（Octafuse）

`@octafuse/core` 承载统一的类型、仓储与领域逻辑；**对外交付形态**由两套正交选择决定：

1. **运行时**：**Cloudflare 边缘**（Worker / Pages + OpenNext）或 **Node.js**（本机/Docker/K8s 等）。
2. **数据存储**：**D1**（SQLite、Cloudflare 绑定）、**PostgreSQL** 或 **MySQL 8**（均通过 Node 侧 **`DATABASE_URL`** + **`DATABASE_DRIVER`** 选择；Worker 仅 D1）。

二者组合后得到下文的「部署模式」。同一业务语义下，D1、Postgres 与 MySQL 使用**各自迁移目录**保持 schema 对齐（见文末）。

---

## 能力矩阵（按组件）

| 组件 | Cloudflare 运行时 | Node 运行时 | 数据库 |
|------|-------------------|-------------|--------|
| **Proxy**（`packages/proxy`） | Worker：`npm run dev:proxy` / `deploy:proxy`；**仅绑定 D1**，不用 `DATABASE_URL` | `npm run dev:proxy:node`（`packages/proxy/src/runtime/node.ts`）；**Postgres 或 MySQL**（`DATABASE_DRIVER` + `DATABASE_URL`） | **D1 ⊕ Postgres ⊕ MySQL**（同进程不能混用） |
| **Admin**（`packages/admin`） | OpenNext + wrangler：`npm run dev:admin` / `deploy:admin`；**绑定同一 D1** | 本地开发：`npm run dev:admin:node`（或 `packages/admin` 内 `npm run dev:node`，`:8789`）；生产：`next start` / Docker：需 **`DATABASE_URL`** + **`DATABASE_DRIVER`**（与 Proxy Node 同语义；Postgres 可省略驱动，**MySQL 须 `mysql`**）与 **`ADMIN_*`** | **D1 ⊕ Postgres ⊕ MySQL 二选一** |
| **Core**（`packages/core`） | 被 Worker / Pages 以 `d1` 驱动引用 | 被 Node 以 `postgres` / `mysql` 驱动引用 | 迁移见下 |

> **约束**：Cloudflare Worker **不能**直连外部 Postgres/MySQL；若在边缘保留 Worker，则数据库只能是 **D1**。要用 Postgres 或 MySQL，Proxy/Admin 须在 **Node** 跑（例如 Docker 自托管，见 [deployment-docker.md](../ops/deployment-docker.md)）。

---

## 部署模式（三种常见拓扑）

| 模式 | Proxy | Admin | 数据库 | 典型场景 |
|------|---------|--------|--------|----------|
| **A. Cloudflare 全托管（默认）** | Worker | Pages（OpenNext） | **共用 D1** | 生产默认；运维最简单 |
| **B. Hybrid** | **Node**（容器/VPS） | 仍为 **Cloudflare Pages** | Proxy=**Postgres**，Admin=**D1**（两库需分别迁移/对齐，适合分阶段上 PG） | 推理侧先行迁 PG，管理端仍在 CF |
| **C. Full Node + Postgres** | Node | Node（Next 容器等） | **同一 Postgres** | 全自托管、与 K8s/Docker 一致；见 Docker 文档 |
| **C′. Full Node + MySQL 8** | Node | Node（Next 容器等） | **同一 MySQL** | 与 C 相同交付形态；迁移目录 `migrations-mysql/` |

详细步骤与变量：

- 模式 A：[deployment-cloudflare.md](../ops/deployment-cloudflare.md)
- 模式 B / C、Docker、双镜像：[deployment-docker.md](../ops/deployment-docker.md)
- D1 ↔ Postgres 迁移/对账脚本：[postgres-cutover.md](../ops/postgres-cutover.md)
- 索引入口：[deployment.md](../ops/deployment.md)

---

## 关系示意（逻辑视图）

```mermaid
flowchart TB
  subgraph core ["@octafuse/core"]
    logic["业务逻辑 / 仓储接口"]
  end

  subgraph cf ["Cloudflare 路径"]
    W["Worker: packages/proxy"]
    P["OpenNext Admin: packages/admin"]
    D1[(D1 octafuse-gateway)]
    W --> D1
    P --> D1
  end

  subgraph node ["Node 路径"]
    NP["Node Proxy\nruntime/node.ts"]
    NA["Node Admin\nnext start / Docker"]
    SQL[("Postgres 或 MySQL")]
    NP --> SQL
    NA --> SQL
  end

  logic -.-> W
  logic -.-> P
  logic -.-> NP
  logic -.-> NA
```

> 图中 **cf** 与 **node** 为并列交付方式；生产一般只选其中一条「竖条」（全 D1 或全关系型 PG/MySQL），Hybrid 则 Proxy 与 Admin 分别落在不同竖条（含两套存储）时需严格约定账号与迁移顺序。

---

## 迁移脚本位置

| 目标库 | SQL 目录 | 常用命令（仓库根） |
|--------|-----------|-------------------|
| **D1** | `packages/core/migrations-d1/` | `npm run db:migrate` / `db:migrate:remote`（`packages/core/wrangler.d1.jsonc`） |
| **PostgreSQL** | `packages/core/migrations-postgres/` | `npm run db:migrate:pg`（`packages/core/src/migrate/cli.ts` → `migrate/postgres.ts`） |
| **MySQL 8** | `packages/core/migrations-mysql/` | `npm run db:migrate:mysql`（同上 CLI → `migrate/mysql.ts`）；容器内 `db:migrate:mysql:docker` |

环境变量约定见仓库根 **[`.env.example`](../../.env.example)**；本地组合 D1 / PG / MySQL、Hybrid 调法见 **[local-testing-environments.md](../ops/local-testing-environments.md)**。

---

## 用户 / API Key / 用量数据流（Proxy）

鉴权与扣费路径在三种存储上一致，仅事务封装不同（D1 用 `batch()`；Postgres / MySQL 用 Drizzle 事务 + 条件 `UPDATE` 防并发 lazy reset 双写审计）。

```mermaid
sequenceDiagram
  participant C as Client
  participant P as Proxy
  participant DB as DB / Repos

  C->>P: Authorization Bearer sk-...
  P->>DB: getApiKeyWithUserByKey(key)
  DB-->>P: key + user budget 列
  P->>P: maybeResetBudget(user)
  alt 周期到期需落库
    P->>DB: updateUserBudgetWithAuditTx
  end
  P-->>C: 403 if spent >= budget_max（可配置）
  C->>P: chat / messages / gemini
  P->>DB: insertRequestUsageAndChargeTx
  Note over DB: INSERT request_log + UPDATE users.budget_spent += Δ + INSERT user_audit_logs
```

- **表级关系与不变量**（email / external 约束、多 active key、级联规则）：[user-keys-data-model.md](./user-keys-data-model.md)。
- **审计事件与列语义**：[../reference/user-audit-logs.md](../reference/user-audit-logs.md)。
