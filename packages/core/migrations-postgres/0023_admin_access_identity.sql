-- Named Admin API keys and persistent console sessions.
SET search_path TO octafuse_gateway;

CREATE TABLE IF NOT EXISTS admin_api_keys (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	description TEXT,
	secret_key TEXT NOT NULL UNIQUE,
	key_prefix TEXT NOT NULL,
	permissions_json TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
	last_used_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_api_keys_status ON admin_api_keys(status);

CREATE TABLE IF NOT EXISTS admin_sessions (
	token_hash TEXT PRIMARY KEY,
	username TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

INSERT INTO admin_api_keys (
	id, name, description, secret_key, key_prefix, permissions_json, status
)
SELECT
	'legacy-master',
	'legacy-master',
	'Migrated from system_config.MASTER_KEY',
	value,
	LEFT(value, GREATEST(0, LEAST(12, LENGTH(value) - 4))),
	'["*"]',
	'active'
FROM system_config
WHERE key = 'MASTER_KEY' AND BTRIM(value) <> ''
ON CONFLICT DO NOTHING;
