-- 访问令牌：由授权服务器（如 SoloEnt 门户）通过 Admin API 代表用户签发给第三方 MCP 客户端的凭证。
-- 与 api_keys 完全分开：前缀 oat_、只存 SHA-256 哈希、可过期、只能访问 /mcp*，不能调用模型接口。
-- 一行 = 一次授权（用户 x 应用）；刷新只轮换哈希与过期时间，id 不变；撤销为软删除（清空哈希，保留应用名供日志展示）。

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	client_id TEXT NOT NULL,
	client_name TEXT NOT NULL,
	token_hash TEXT UNIQUE,
	token_hint TEXT,
	scopes TEXT NOT NULL DEFAULT '["mcp"]',
	expires_at TEXT,
	last_used_at TEXT,
	rotated_at TEXT,
	revoked_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_client ON oauth_access_tokens(client_id);

-- 请求日志：来自访问令牌的调用写 oauth_access_token_id（此时 api_key_id 为空）。
ALTER TABLE api_key_request_logs ADD COLUMN oauth_access_token_id TEXT;
