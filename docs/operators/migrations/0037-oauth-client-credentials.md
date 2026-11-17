# 0037：OAuth 机密客户端、手工客户端与客户端元数据文档

三库脚本：`packages/core/migrations-{d1,postgres,mysql}/0037_oauth_client_credentials.sql`。Postgres 脚本会设置 `search_path` 为 `octafuse_gateway`。

## 变更

`oauth_clients` 只新增列，不改已有数据：

- `token_endpoint_auth_method`：非空，默认 `none`。取值 `none`、`client_secret_basic`、`client_secret_post`。已有注册实例都是公开客户端，取默认值后行为不变。
- `client_secret_hash`：可空。机密客户端与手工客户端的 `client_secret`（前缀 `ocs_`）的 SHA-256 哈希，明文只在签发或重置时返回一次。
- `metadata_fetched_at`：可空。客户端元数据文档（CIMD）最近一次抓取成功的时间，用来判断是否需要重新抓取。

已有的 `registration_method` 列新增两个取值：`manual`（运营在 Admin 手工签发）与 `cimd`（`client_id` 是元数据文档的 https 地址）。动态注册仍是 `dcr`。

配套的功能：

- 动态注册可以声明 `client_secret_basic` / `client_secret_post` 成为机密客户端；机密客户端在令牌端点认证，PKCE 可选。
- Admin「MCP 服务」页每个应用下可以签发、重置、删除手工凭据，供不支持动态注册的平台使用。手工客户端不会被 7 天未使用清理，随应用删除。
- 新增可选配置 `MCP_OAUTH_CIMD_ENABLED`（默认关闭），开启后接受以 https 地址为 `client_id` 的客户端。
- 应用的回调规则支持本机 `localhost`（忽略端口）、`https://*.domain` 子域通配和末尾 `*` 前缀匹配。规则保存在已有的 `oauth_apps.redirect_uris` 中，不需要迁移数据。

## 步骤

1. 备份后对目标库执行对应 `0037_oauth_client_credentials.sql`（或官方 migrate）。
2. 再滚动更新同版本 Proxy 与 Admin。

顺序有要求：新版 Proxy / Admin 读取 `oauth_clients` 时会查询新列，列不存在时动态注册、授权和 Admin 应用页都会报错。旧版 Proxy / Admin 配合已迁移的库没有问题。

## 回滚

先回退 Proxy / Admin。回退后手工客户端、机密客户端和 CIMD 客户端无法再换取令牌（旧版本把它们当作公开客户端，且不认识 https 形式的 `client_id`），需要重新接入；公开客户端不受影响。新增列可以保留；确需删除时执行 `ALTER TABLE oauth_clients DROP COLUMN …`（D1 需要 SQLite 3.35+），并先删除 `registration_method` 为 `manual` / `cimd` 的行。
