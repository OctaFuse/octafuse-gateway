# Gateway smoke scripts

仓库内**保留**的冒烟脚本只做两件事：（1）对**已启动**的 Node Proxy / Admin 发 HTTP，验证核心路由与可选管理写路径；（2）对 **`@octafuse/core`** 关键写路径做 **mock DB** 单测。它们**不是**运行时转发逻辑的一部分。

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

## 3. 协议与路由的手工回归

已移除未在 `package.json` 声明依赖的 OpenAI / Anthropic / Gemini **官方 SDK** 示例脚本。需要测上游协议时，请用 **curl**、自写小脚本，或在你自己的客户端里把 `baseURL` 指到本网关；`model_routes` 的 **`custom_params`** 与请求体合并顺序仍为：

1. `custom_params`
2. 用户请求体（用户字段优先）

可在 Admin 配好路由后，用「不传某字段 / 显式覆盖」做回归。

## 说明

`test-postgres-core-routes` 名称中的 “postgres” 为历史遗留：脚本对 **任意** `DATABASE_DRIVER` 下的 Node 网关同样适用（见 `test-node-core-routes.ts` 内 `smokeLabel()`）。
