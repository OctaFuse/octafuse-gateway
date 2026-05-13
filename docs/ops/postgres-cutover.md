# 可选：D1 → Postgres 迁移、对账与灰度（运维脚本）

本文面向需要在 **D1** 与 **Postgres** 之间做 **ETL / 对账 / 切换演练** 的运维场景，对应仓库内 **`scripts/db/cutover/`** 下的 TypeScript 工具。默认生产仍以 **Cloudflare Worker + D1** 为主；切到 Postgres 时，**推理流量**由 **Node 版 Proxy**（`packages/proxy`）承担，**管理面**由 **Admin 应用**承担（Hybrid 时可继续 D1，Full self-hosted PG 时应接入同一 Postgres；Docker 双镜像见 [deployment-docker.md](./deployment-docker.md)）。

## 0. 前置条件

- 目标 Postgres 已具备与业务一致的 schema（见 **`npm run db:migrate:pg`** / **`packages/core/src/migrate/postgres.ts`** 与 **`packages/core/migrations-postgres/`**）。
- 可访问源 D1（远程或本地持久化目录）。
- 已阅读 [deployment-docker.md](./deployment-docker.md) 中 Node Proxy 的边界（**无 `/admin` HTTP**）。

> 默认 ETL 使用 `--d1-source=remote`。迁移**本地** D1 时加 `--d1-source=local`，并可配 `--d1-persist-to=./.wrangler/state`（与本地 wrangler 一致）。

## 1. ETL（D1 → Postgres）

在**仓库根**执行：

```bash
DATABASE_URL='postgres://...' npx tsx scripts/db/cutover/etl-d1-to-postgres.ts --truncate --batch-size=1000
```

增量幂等（可重复执行）：

```bash
DATABASE_URL='postgres://...' npx tsx scripts/db/cutover/etl-d1-to-postgres.ts --batch-size=1000
```

使用 `--help` 查看表过滤、`--d1-source` 等选项。

## 2. 对账

```bash
DATABASE_URL='postgres://...' npx tsx scripts/db/cutover/reconcile-d1-postgres.ts
```

失败时脚本非 0 退出，需修复后再切换。

## 3. 灰度与切换要点

- **Worker（D1）** 与 **Node（Postgres）** 可并行存在不同入口；切换的是**流量与主写库**，不是在同进程内换驱动。
- **管理接口**验证应在 **Admin 应用**（`/api/admin/*`）对目标库进行，而不是期望 Node Proxy 提供 `/admin/*`。
- Hybrid 模式可先切 Proxy 到 Postgres，Admin 暂留 D1；Full self-hosted PG 需将 Admin 一并切到 Postgres。
- Canary 阶段建议观察：5xx、延迟、`api_key_request_logs` 写入、`budget_spent` 与预算审计一致性。

建议在 canary 前固定执行以下最小探针（示例）：

```bash
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8789/api/admin/config -H 'Authorization: Bearer sk-dev-admin-key'
```

## 4. 回滚

将流量切回 **Worker + D1** 或停止故障 Node 池；保留 Postgres 数据用于排障；修复后自增量 ETL、对账、再灰度。

## 5. Checklist（摘要）

1. Postgres schema / 迁移（含 `0002_seed.sql` 默认 `system_config`）就绪  
2. 全量 ETL（必要时 `--truncate`）  
3. 对账  
4. 增量 ETL + 再对账  
5. Node canary + Admin 连同一库验证  
6. 切流量与切后观测  

---

**相关文档**：[部署索引](./deployment.md) · [Docker/Node 说明](./deployment-docker.md) · [本地测试拓扑](./local-testing-environments.md)
