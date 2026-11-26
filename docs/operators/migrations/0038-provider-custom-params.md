# 0038：供应商默认请求参数

三库脚本：`packages/core/migrations-{d1,postgres,mysql}/0038_provider_custom_params.sql`。Postgres 脚本会设置 `search_path` 为 `octafuse_gateway`，并使用 `IF NOT EXISTS`，重复执行不会报错。

## 变更

`providers` 只新增一列，不改已有数据：

- `custom_params`：可空文本，无默认值。保存按上游协议分组的默认请求头和请求体（JSON）。已有供应商均为 `NULL`，请求行为与升级前完全一致。

配套的功能：

- Admin 供应商编辑弹窗新增「自定义参数」页签，可按协议配置默认请求头和请求体。
- 路由上的自定义参数仍然生效，并优先于供应商默认值。
- 受保护的请求头和请求体的 `model` 字段仍由网关管理，不会被覆盖。
- 原生透传与 WebSocket 入口同样应用配置的请求头。
- 调试台预览与线上请求使用同一套合并逻辑（`packages/core/src/provider-custom-params.ts`）。

## 步骤

1. 备份后对目标库执行对应 `0038_provider_custom_params.sql`（或官方 migrate）。
2. 再滚动更新同版本 Proxy 与 Admin。

顺序有要求：新版 Proxy / Admin 读取 `providers` 时会查询 `custom_params`，列不存在时路由解析和供应商页都会报错。旧版 Proxy / Admin 配合已迁移的库没有问题。

## 回滚

先回退 Proxy / Admin。回退后已配置的供应商默认参数不再生效，请求会按旧行为发送，上游可能因缺少所需的请求头或请求体字段而拒绝请求；路由上的自定义参数不受影响。新增列可以保留；确需删除时执行 `ALTER TABLE providers DROP COLUMN custom_params`（D1 需要 SQLite 3.35+），会丢失已配置的供应商默认参数，请先导出。
