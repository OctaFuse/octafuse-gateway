-- Provider API key pool: multiple upstream credentials per provider.
CREATE TABLE provider_api_keys (
  id VARCHAR(512) PRIMARY KEY,
  provider_id VARCHAR(512) NOT NULL,
  label VARCHAR(512) NOT NULL,
  api_key TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  weight INT NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_provider_api_keys_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  CONSTRAINT chk_provider_api_keys_status CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX idx_provider_api_keys_provider_id ON provider_api_keys(provider_id);
CREATE INDEX idx_provider_api_keys_provider_active ON provider_api_keys(provider_id, status, priority DESC);

INSERT INTO provider_api_keys (id, provider_id, label, api_key, status, weight, priority)
SELECT
  CONCAT('pkey_', id),
  id,
  'default',
  api_key,
  'active',
  1,
  0
FROM providers;

ALTER TABLE api_key_request_logs ADD COLUMN provider_key_id VARCHAR(512) DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN provider_key_label VARCHAR(512) DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN provider_key_fingerprint VARCHAR(64) DEFAULT NULL;
