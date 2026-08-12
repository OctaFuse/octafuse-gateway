-- Named Admin API keys and persistent console sessions.

CREATE TABLE IF NOT EXISTS admin_api_keys (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	description TEXT,
	secret_key TEXT NOT NULL UNIQUE,
	key_prefix TEXT NOT NULL,
	permissions_json TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
	last_used_at TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_api_keys_status ON admin_api_keys(status);

CREATE TABLE IF NOT EXISTS admin_sessions (
	token_hash TEXT PRIMARY KEY,
	username TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

-- Preserve the exact historical secret as an ordinary full-permission key.
INSERT OR IGNORE INTO admin_api_keys (
	id, name, description, secret_key, key_prefix, permissions_json, status
)
SELECT
	'legacy-master',
	'legacy-master',
	'Migrated from system_config.MASTER_KEY',
	value,
	SUBSTR(value, 1, MIN(12, MAX(0, LENGTH(value) - 4))),
	'["*"]',
	'active'
FROM system_config
WHERE key = 'MASTER_KEY' AND TRIM(value) <> '';
