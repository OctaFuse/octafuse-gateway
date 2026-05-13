# Admin 分层约束（Octafuse）

本文说明 **`packages/admin`** 内管理 API 的分层边界，以及与 **`@octafuse/core`** 的关系，供开发与 code review 对齐。

## 分层定义

- **`packages/admin/lib/routes/admin/*`**：HTTP 层（Hono 挂载在内部路径 **`/admin/*`**）
  - 负责参数解析、调用 service、映射 HTTP 状态码与响应体。
  - 不直接写 SQL，不直接导入 `packages/core/src/db/**` 的实现文件（经 `GatewayRepositories` 间接访问）。
- **`packages/admin/lib/services/admin/*`**：业务层
  - 校验、编排、领域错误；可组合调用多个 repository 方法。
- **`packages/core/src/db/*`** 与 **`packages/core/src/storage/*`**：数据访问与事务
  - SQL / Drizzle、结果映射；不感知 HTTP。
  - 按领域拆分（如 `api-keys`、`providers`、`model-routes`），不按「admin / v1」分目录；**Proxy** 与 **Admin** 共用同一套 core 仓储接口。

## 依赖方向

允许：

`packages/admin/lib/routes/admin` → `packages/admin/lib/services/admin` → `@octafuse/core`（`GatewayRepositories` 等）

禁止：路由层直接访问 DB 实现细节（绕过 service 或 repositories 契约的「抄近道」）。

## 对外路径 vs 内部路径

- 浏览器与 BFF：`{ADMIN_ORIGIN}/api/admin/...`
- Next Route Handler（`app/api/admin/[...path]/route.ts`）将请求重写为内部 **`/admin/...`** 后交给上述 Hono 应用。

## 新增管理接口时的建议流程

1. 在 `lib/routes/admin` 增加 endpoint，只做 HTTP 接入。
2. 在 `lib/services/admin` 增加方法（校验 + 编排）。
3. 若需新查询，在 **`packages/core`** 的对应仓储中扩展，由 service 调用。
4. 跑 `npm run lint -w @octafuse/admin`（若项目已配置跨层 ESLint 约束，需保持通过）。
