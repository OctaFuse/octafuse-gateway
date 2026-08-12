-- Named Admin API keys and persistent console sessions.

CREATE TABLE IF NOT EXISTS admin_api_keys (
	id VARCHAR(128) PRIMARY KEY,
	name VARCHAR(255) NOT NULL UNIQUE,
	description TEXT,
	secret_key VARCHAR(767) NOT NULL UNIQUE,
	key_prefix VARCHAR(32) NOT NULL,
	permissions_json TEXT NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	last_used_at TIMESTAMP(6) NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	revoked_at TIMESTAMP(6) NULL,
	CONSTRAINT admin_api_keys_status_chk CHECK (status IN ('active', 'revoked')),
	INDEX idx_admin_api_keys_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
	token_hash VARCHAR(64) PRIMARY KEY,
	username VARCHAR(255) NOT NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	expires_at TIMESTAMP(6) NOT NULL,
	INDEX idx_admin_sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO admin_api_keys (
	id, name, description, secret_key, key_prefix, permissions_json, status
)
SELECT
	'legacy-master',
	'legacy-master',
	'Migrated from system_config.MASTER_KEY',
	value,
	LEFT(value, GREATEST(0, LEAST(12, CHAR_LENGTH(value) - 4))),
	'["*"]',
	'active'
FROM system_config
WHERE `key` = 'MASTER_KEY' AND TRIM(value) <> '';
