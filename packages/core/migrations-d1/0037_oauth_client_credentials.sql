-- 内置 MCP OAuth：注册实例支持机密客户端（client_secret）、管理员手工签发的客户端与客户端元数据文档（CIMD）。
-- 对现有数据的影响：只新增列。已有注册实例的 token_endpoint_auth_method 取默认值 'none'（与之前的公开客户端行为一致），
-- client_secret_hash 与 metadata_fetched_at 为空。registration_method 列沿用，新增取值 'manual' / 'cimd'。

ALTER TABLE oauth_clients ADD COLUMN token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none';
ALTER TABLE oauth_clients ADD COLUMN client_secret_hash TEXT;
ALTER TABLE oauth_clients ADD COLUMN metadata_fetched_at TEXT;
