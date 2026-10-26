# 0034：粘性绑定记录明文 affinity_key

三库脚本：`packages/core/migrations-{d1,postgres,mysql}/0034_sticky_binding_affinity_key.sql`。Postgres 脚本会设置 `search_path` 为 `octafuse_gateway`。

## 变更

给 `route_pool_sticky_bindings` 加一列可空的 `affinity_key`（D1 / Postgres `TEXT`，MySQL `VARCHAR(512)`），内容是 `userId|modelId|routeGroup|protocol`。

此前表里只存它的 SHA-256，后台只能先知道邮箱再反查。有了这一列，后台路由页的「Provider 粘性」弹窗可以直接列出当前粘在各 Provider 上的用户（`GET /api/admin/routes/pools/:poolId/sticky/bindings`）。

- Proxy 新建或改绑时写入；续期时只补全还是空的旧行，不覆盖已有值。
- 迁移前已存在的行为 `NULL`，后台显示为「未记录用户」。这些行下次被命中并续期后补全，最迟在粘性 TTL（最长 24 小时）到期后自然消失，不需要回填脚本。
- 路由选择、绑定 CAS、`affinity_hash` 主键都不变。

## 步骤

1. 备份后对目标库执行对应 `0034_sticky_binding_affinity_key.sql`（或官方 migrate）。
2. 再滚动更新同版本 Proxy 与 Admin。

顺序有要求：新版 Proxy 写绑定时会带上这一列，库里还没有该列时绑定写入会失败。粘性按失败放行处理，请求照常路由，但本次不会记录绑定。旧版 Proxy / Admin 配合已迁移的库没有问题。

## 回滚

先回退 Proxy / Admin，再按需 `ALTER TABLE route_pool_sticky_bindings DROP COLUMN affinity_key`（D1 需要 SQLite 3.35+，不方便时保留该列即可）。
