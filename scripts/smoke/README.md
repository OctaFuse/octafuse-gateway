# Gateway smoke scripts

仓库内**保留**的冒烟脚本用于：（1）对**已启动**的 Node Proxy / Admin 发 HTTP，验证核心路由与可选管理写路径（含**同一用户多 key**与**级联删用户**）；（2）对 **`@octafuse/core`** 关键写路径做 **mock DB** 单测；（3）在配置 **`DATABASE_URL`** 时直连 Postgres/MySQL，验证 **`insertRequestUsageAndChargeTx` 并发累加**（与 Proxy `recordUsage` 相同存储路径）。它们**不是**运行时转发逻辑的一部分。

## 1. Node + SQL（Postgres / MySQL 等）

实现位于 **`test-node-core-routes.ts`**。`test-postgres-core-routes.ts` 为历史文件名入口，与前者共用同一套逻辑。

先按文档启动 **Proxy**（及可选 **Admin**），在仓库根：

```bash
npm run test:gateway:node-smoke
# 或（与上式等价实现，名称保留）
npm run test:gateway:postgres-smoke
```

环境变量与开关见 **`test-node-core-routes.ts` 文件头注释**（`GATEWAY_BASE_URL`、`GATEWAY_MASTER_*`、`GATEWAY_SMOKE_SKIP_ADMIN` 等）。

## 2. Core 写路径（无需 Proxy）

```bash
npx tsx --test scripts/smoke/test-critical-write-paths.ts
```

使用 `node:test` + mock D1 / Postgres 客户端，校验 `createApiKeyWithAudit` 等批处理 / 事务边界。

## 3. Postgres / MySQL：存储层并发扣费（与 Proxy 同一路径）

```bash
npm run test:gateway:sql-storage-smoke
```

直连 **`DATABASE_URL`**（`DATABASE_DRIVER` 默认 `postgres`，MySQL 须显式 `mysql`），在同一 `users` 下并发调用 `insertRequestUsageAndChargeTx`，断言 `budget_spent` 原子累加；结束 **`deleteUserHard`** 清理。**未配置 `DATABASE_URL` 时脚本退出 0（跳过）**。

**D1**：单 Worker 内 `batch()` 串行；生产语义与 SQL 累加一致；端到端可依赖 **`npm run test:gateway:node-smoke`**（对真实 Admin + Proxy + D1 发 HTTP）。

本地可顺序执行（需已启动 Proxy/Admin 时再跑第 1 步）：

```bash
npm run test:gateway:node-smoke
npm run test:gateway:sql-storage-smoke   # 无 DATABASE_URL 则跳过
npx tsx --test scripts/smoke/test-critical-write-paths.ts
```

## 4. 协议与路由的手工回归

已移除未在 `package.json` 声明依赖的 OpenAI / Anthropic / Gemini **官方 SDK** 示例脚本。需要测上游协议时，请用 **curl**、自写小脚本，或在你自己的客户端里把 `baseURL` 指到本网关；`model_routes` 的 **`custom_params`** 与请求体合并顺序仍为：

1. `custom_params`
2. 用户请求体（用户字段优先）

可在 Admin 配好路由后，用「不传某字段 / 显式覆盖」做回归。

## 说明

`test-postgres-core-routes` 名称中的 “postgres” 为历史遗留：脚本对 **任意** `DATABASE_DRIVER` 下的 Node 网关同样适用（见 `test-node-core-routes.ts` 内 `smokeLabel()`）。
