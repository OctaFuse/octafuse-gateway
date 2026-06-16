-- Provider API key pool: multiple upstream credentials per provider.
CREATE TABLE provider_api_keys (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  api_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  weight INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_provider_api_keys_provider_id ON provider_api_keys(provider_id);
CREATE INDEX idx_provider_api_keys_provider_active ON provider_api_keys(provider_id, status, priority DESC);

INSERT INTO provider_api_keys (id, provider_id, label, api_key, status, weight, priority)
SELECT
  'pkey_' || id,
  id,
  'default',
  api_key,
  'active',
  1,
  0
FROM providers;

ALTER TABLE api_key_request_logs ADD COLUMN provider_key_id TEXT DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN provider_key_label TEXT DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN provider_key_fingerprint TEXT DEFAULT NULL;
