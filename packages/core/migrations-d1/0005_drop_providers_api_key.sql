-- Retire legacy single-key column; keys live in provider_api_keys only.
-- Apply after code that no longer reads/writes providers.api_key is deployed.
ALTER TABLE providers DROP COLUMN api_key;
