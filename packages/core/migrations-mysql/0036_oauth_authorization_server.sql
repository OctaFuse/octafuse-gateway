-- 内置 MCP OAuth 授权服务器：应用目录、动态注册实例、授权请求（含一次性授权码），以及访问令牌上的刷新令牌与应用归属。
-- 对现有数据的影响：只新增表和可空列；旧的 oauth_access_tokens 行（由外部授权服务器经 Admin API 签发）保持原样，
-- app_id 为空（后台显示为「未归属」），refresh_* 为空（按访问令牌过期时间判断状态）。
-- 时间列沿用 ISO 文本；JSON 列用 TEXT，由应用层写入，不依赖默认值。

CREATE TABLE IF NOT EXISTS oauth_apps (
	id VARCHAR(128) PRIMARY KEY,
	slug VARCHAR(64) NOT NULL,
	name VARCHAR(255) NOT NULL,
	redirect_uris TEXT NOT NULL,
	client_name_patterns TEXT NOT NULL,
	enabled INT NOT NULL DEFAULT 1,
	created_at VARCHAR(40) NOT NULL,
	updated_at VARCHAR(40) NOT NULL,
	UNIQUE KEY uk_oauth_apps_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_clients (
	client_id VARCHAR(255) PRIMARY KEY,
	app_id VARCHAR(128) NULL,
	client_name VARCHAR(255) NOT NULL,
	redirect_uris TEXT NOT NULL,
	registration_method VARCHAR(32) NOT NULL DEFAULT 'dcr',
	last_authorized_at VARCHAR(40) NULL,
	created_at VARCHAR(40) NOT NULL,
	INDEX idx_oauth_clients_app (app_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
	id_hash CHAR(64) PRIMARY KEY,
	client_id VARCHAR(255) NOT NULL,
	redirect_uri VARCHAR(2048) NOT NULL,
	code_challenge VARCHAR(128) NOT NULL,
	resource VARCHAR(2048) NULL,
	state VARCHAR(2048) NULL,
	scope VARCHAR(255) NOT NULL,
	user_id VARCHAR(512) NULL,
	code_hash CHAR(64) NULL,
	code_expires_at VARCHAR(40) NULL,
	used_at VARCHAR(80) NULL,
	decided_at VARCHAR(40) NULL,
	expires_at VARCHAR(40) NOT NULL,
	created_at VARCHAR(40) NOT NULL,
	UNIQUE KEY uk_oauth_authorization_requests_code (code_hash),
	INDEX idx_oauth_authorization_requests_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE oauth_access_tokens
	ADD COLUMN app_id VARCHAR(128) NULL,
	ADD COLUMN refresh_token_hash CHAR(64) NULL,
	ADD COLUMN prev_refresh_token_hash CHAR(64) NULL,
	ADD COLUMN refresh_expires_at VARCHAR(40) NULL,
	ADD UNIQUE KEY uk_oauth_access_tokens_refresh (refresh_token_hash),
	ADD INDEX idx_oauth_access_tokens_prev_refresh (prev_refresh_token_hash),
	ADD INDEX idx_oauth_access_tokens_app (app_id);
