# 0036：内置 OAuth 授权服务器

三库脚本：`packages/core/migrations-{d1,postgres,mysql}/0036_oauth_authorization_server.sql`。Postgres 脚本会设置 `search_path` 为 `octafuse_gateway`。

## 变更

- 新增 `oauth_apps`（应用目录）、`oauth_clients`（动态注册实例）、`oauth_authorization_requests`（授权请求与一次性授权码）。
- `oauth_access_tokens` 增加可空列 `app_id`、`refresh_token_hash`（唯一）、`prev_refresh_token_hash`、`refresh_expires_at`。

只新增表和可空列。旧授权（由外部授权服务器经 Admin API 签发）保持原样：`app_id` 为空，后台显示为「未归属」；没有刷新令牌，状态按访问令牌过期时间判断。新模式默认不启用：`MCP_OAUTH_ISSUER` 为空时行为与升级前完全一致。

## 升级步骤

1. 备份后对目标库执行对应 `0036_oauth_authorization_server.sql`（或官方 migrate）。
2. 再滚动更新同版本 Proxy 与 Admin。旧版 Proxy / Admin 配合已迁移的库没有问题。

到这一步为止行为不变。接着决定是否把 OAuth 切到内置授权服务器。

## 切换到内置授权服务器（每个部署区单独执行）

1. 先发布门户的新同意页（接受授权请求 ID，调用 `oauth.consent` 接口），确认能同时处理新旧两种流程。
2. 在 Admin「MCP 服务」页「OAuth 访问令牌」区导入应用预设（ChatGPT、Claude、Codex、豆包、WorkBuddy），或手工添加应用。没有匹配应用的客户端无法注册。
3. 创建一个集成密钥，授予 `oauth.consent` 以及门户已在使用的用户与 Key 权限，配给门户。
4. 反向代理把 `/oauth/*` 与 `/.well-known/oauth-authorization-server` 转发到 Proxy（与 `/mcp` 同一公开域名）。
5. 在 OAuth 卡片选择「内置授权服务器」，填 issuer（本 Gateway 的公开源）与同意页地址（门户的同意页；留空则使用内置确认页），保存。
6. 用真实客户端（Codex、WorkBuddy、豆包、ChatGPT、Claude）逐一验收授权、刷新和撤销。

切换后，已有的旧授权会在访问令牌过期后失效，用户需要重新授权（客户端发现 401 后会重新走授权流程）。想立即清理，可在「未归属」分组里撤销。

## 回滚

清空 `MCP_OAUTH_ISSUER`（并按需保留 `MCP_OAUTH_AUTHORIZATION_SERVER` 指向原授权服务器）即可回到外部模式，立即生效，不需要回退代码或数据库。内置模式下发出的授权会在访问令牌过期后失效，客户端需要通过原授权服务器重新授权。

彻底回退库结构时，先回退 Proxy / Admin，再删除三张新表，并删除 `oauth_access_tokens` 新增的四列（D1 需要 SQLite 3.35+，不方便时保留这些列即可）。
