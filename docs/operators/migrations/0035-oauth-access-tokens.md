# 0035：OAuth 访问令牌表

三库脚本：`packages/core/migrations-{d1,postgres,mysql}/0035_oauth_access_tokens.sql`。Postgres 脚本会设置 `search_path` 为 `octafuse_gateway`。

## 变更

- 新增表 `oauth_access_tokens`：一行 = 一次授权（用户 × 应用）。列含 `client_id`、`client_name`、`token_hash`（SHA-256，唯一，可空）、`token_hint`（末 4 位）、`scopes`（默认 `["mcp"]`）、`expires_at`、`last_used_at`、`rotated_at`、`revoked_at`、`created_at`、`updated_at`。用户删除时级联删除。
- `api_key_request_logs` 增加可空列 `oauth_access_token_id`。来自访问令牌的 MCP 调用写这一列，此时 `api_key_id` 为空；用户 Key 的调用不变。

访问令牌与 `api_keys` 完全分开：前缀 `oat_`，只存哈希，会过期，只能访问 `/mcp` 与 `/mcp/*`，访问其它入口返回 403 `gateway.scope_denied`。刷新只轮换哈希与过期时间，行 id 不变；撤销是软删除，清空哈希并保留应用名，供请求日志继续显示。

令牌由授权服务器（SoloEnt 门户）经 Admin API `POST /api/admin/users/:id/oauth-access-tokens` 签发，明文只在响应里出现一次。后台入口见「用户 → OAuth 访问令牌」。

## 步骤

1. 备份后对目标库执行对应 `0035_oauth_access_tokens.sql`（或官方 migrate）。
2. 再滚动更新同版本 Proxy 与 Admin。

顺序有要求：新版 Proxy 写请求日志时会带上 `oauth_access_token_id`，列不存在时日志写入会失败。旧版 Proxy / Admin 配合已迁移的库没有问题。

## 回滚

先回退 Proxy / Admin，再按需删除：`DROP TABLE oauth_access_tokens`，以及 `ALTER TABLE api_key_request_logs DROP COLUMN oauth_access_token_id`（D1 需要 SQLite 3.35+，不方便时保留该列即可）。回滚后已签发的访问令牌全部失效，第三方客户端需要重新授权。
