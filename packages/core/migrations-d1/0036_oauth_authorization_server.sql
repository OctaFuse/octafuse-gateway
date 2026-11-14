-- 内置 MCP OAuth 授权服务器：应用目录、动态注册实例、授权请求（含一次性授权码），以及访问令牌上的刷新令牌与应用归属。
-- 对现有数据的影响：只新增表和可空列；旧的 oauth_access_tokens 行（由外部授权服务器经 Admin API 签发）保持原样，
-- app_id 为空（后台显示为「未归属」），refresh_* 为空（按访问令牌过期时间判断状态）。

CREATE TABLE IF NOT EXISTS oauth_apps (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	redirect_uris TEXT NOT NULL,
	client_name_patterns TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_clients (
	client_id TEXT PRIMARY KEY,
	app_id TEXT,
	client_name TEXT NOT NULL,
	redirect_uris TEXT NOT NULL,
	registration_method TEXT NOT NULL DEFAULT 'dcr',
	last_authorized_at TEXT,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_app ON oauth_clients(app_id);

CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
	id_hash TEXT PRIMARY KEY,
	client_id TEXT NOT NULL,
	redirect_uri TEXT NOT NULL,
	code_challenge TEXT NOT NULL,
	resource TEXT,
	state TEXT,
	scope TEXT NOT NULL,
	user_id TEXT,
	code_hash TEXT UNIQUE,
	code_expires_at TEXT,
	used_at TEXT,
	decided_at TEXT,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_requests_expires ON oauth_authorization_requests(expires_at);

ALTER TABLE oauth_access_tokens ADD COLUMN app_id TEXT;
ALTER TABLE oauth_access_tokens ADD COLUMN refresh_token_hash TEXT;
ALTER TABLE oauth_access_tokens ADD COLUMN prev_refresh_token_hash TEXT;
ALTER TABLE oauth_access_tokens ADD COLUMN refresh_expires_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uk_oauth_access_tokens_refresh ON oauth_access_tokens(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_prev_refresh ON oauth_access_tokens(prev_refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_app ON oauth_access_tokens(app_id);
