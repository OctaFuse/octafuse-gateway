-- 访问令牌：由授权服务器（如 SoloEnt 门户）通过 Admin API 代表用户签发给第三方 MCP 客户端的凭证。
-- 与 api_keys 完全分开：前缀 oat_、只存 SHA-256 哈希、可过期、只能访问 /mcp*，不能调用模型接口。
-- 一行 = 一次授权（用户 x 应用）；刷新只轮换哈希与过期时间，id 不变；撤销为软删除（清空哈希，保留应用名供日志展示）。
-- 时间列沿用 ISO 文本（与 mcp_servers 一致）；token_hash 允许 NULL，唯一键对多个 NULL 不冲突。

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
	id VARCHAR(128) PRIMARY KEY,
	user_id VARCHAR(512) NOT NULL,
	client_id VARCHAR(255) NOT NULL,
	client_name VARCHAR(255) NOT NULL,
	token_hash CHAR(64) NULL,
	token_hint VARCHAR(16) NULL,
	scopes VARCHAR(255) NOT NULL DEFAULT '["mcp"]',
	expires_at VARCHAR(40) NULL,
	last_used_at VARCHAR(40) NULL,
	rotated_at VARCHAR(40) NULL,
	revoked_at VARCHAR(40) NULL,
	created_at VARCHAR(40) NOT NULL,
	updated_at VARCHAR(40) NOT NULL,
	UNIQUE KEY uk_oauth_access_tokens_hash (token_hash),
	INDEX idx_oauth_access_tokens_user (user_id),
	INDEX idx_oauth_access_tokens_client (client_id),
	CONSTRAINT fk_oauth_access_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 请求日志：来自访问令牌的调用写 oauth_access_token_id（此时 api_key_id 为空）。
ALTER TABLE api_key_request_logs ADD COLUMN oauth_access_token_id VARCHAR(128) NULL;
